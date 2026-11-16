// 자유 배치 꾸미기 검사와 읽기.
import { decorItem, FLOORS, FREE_ROOM_MAX, FREE_YARD_MAX, ROOM_HALF, WALLPAPERS, YARD_HALF, YARD_HALF_BIG, YARD_ONLY_ITEMS } from '../../src/shared/config';
import { FREE_ROOM_MAX_BIG, ROOM_HALF_BIG } from '../../src/shared/economy';
import type { HouseDecor, PlacedItem } from '../../src/shared/types';

export const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const TAU = Math.PI * 2;

export interface DecorRow {
  yard: string;
  room: string;
  wallpaper: string;
  floor: string;
  roof_art: string | null;
}

export function parseItems(json: string | null | undefined): PlacedItem[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as PlacedItem[]) : [];
  } catch {
    return [];
  }
}

export function toDecor(houseNo: number, row: DecorRow | null): HouseDecor {
  return {
    houseNo,
    yard: parseItems(row?.yard),
    room: parseItems(row?.room),
    wallpaper: row?.wallpaper ?? 'cream',
    floor: row?.floor ?? 'wood',
    ...splitRoof(row?.roof_art ?? null),
  };
}

/** DB roof_art 칸: '앞' 또는 '앞|뒤' (2026-11-16 지붕 뒷면. 앞이 비면 '|뒤') */
export function splitRoof(v: string | null): { roofArt: string | null; roofArtBack: string | null } {
  if (!v) return { roofArt: null, roofArtBack: null };
  const [a, b] = v.split('|');
  return { roofArt: a || null, roofArtBack: b || null };
}
export const joinRoof = (front: string | null, back: string | null | undefined) => (back ? `${front ?? ''}|${back}` : front);

export const readDecor = (db: D1Database, houseId: number) =>
  db.prepare('SELECT yard, room, wallpaper, floor, roof_art FROM house_decor WHERE house_id = ?').bind(houseId).first<DecorRow>();

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 아이템 목록 검사. where: 마당(yard) 또는 집 안(room).
 * 문제가 있으면 이유, 없으면 정리된 목록과 쓰인 종류, 그림 id.
 * (겹침은 씬이 막으니 서버는 범위와 종류, 개수만 본다)
 */
export function cleanFree(raw: unknown, where: 'yard' | 'room', big = false): { items: PlacedItem[]; types: Set<string>; drawings: Set<string> } | { problem: string } {
  if (!Array.isArray(raw)) return { problem: '아이템 목록이 이상해요' };
  const max = where === 'yard' ? FREE_YARD_MAX : big ? FREE_ROOM_MAX_BIG : FREE_ROOM_MAX;
  if (raw.length > max) return { problem: `아이템은 ${max}개까지 놓을 수 있어요` };
  // big: 집 안이면 집 넓히기, 마당이면 마당 넓히기
  const half = (where === 'yard' ? (big ? YARD_HALF_BIG : YARD_HALF) : big ? ROOM_HALF_BIG : ROOM_HALF) + 0.01;
  const ids = new Set<string>();
  const types = new Set<string>();
  const drawings = new Set<string>();
  const items: PlacedItem[] = [];
  for (const it of raw as Array<Record<string, unknown>>) {
    const { id, type, x, z, rotY, drawingId } = it ?? {};
    if (typeof id !== 'string' || !ID_RE.test(id) || ids.has(id)) return { problem: '아이템 id 가 이상해요' };
    const def = typeof type === 'string' ? decorItem(type) : undefined;
    if (!def) return { problem: '없는 아이템이에요' };
    if (def.mount === 'wall' && where === 'yard') return { problem: `${def.label}은(는) 집 안에만 걸 수 있어요` };
    if (where === 'room' && YARD_ONLY_ITEMS.includes(def.type)) return { problem: `${def.label}은(는) 마당에만 놓을 수 있어요` };
    if (typeof x !== 'number' || typeof z !== 'number' || typeof rotY !== 'number' || ![x, z, rotY].every(Number.isFinite))
      return { problem: '위치가 이상해요' };
    if (Math.abs(x) > half || Math.abs(z) > half)
      return { problem: where === 'yard' ? (big ? '마당 밖에는 놓을 수 없어요' : '마당 밖에는 놓을 수 없어요. 마당 넓히기를 하면 더 넓게 놓을 수 있어요') : '방 밖에는 놓을 수 없어요' };
    const item: PlacedItem = { id, type: def.type, x: round(x, 2), z: round(z, 2), rotY: round(((rotY % TAU) + TAU) % TAU, 4) };
    if (drawingId !== undefined && drawingId !== null) {
      if (!def.art || typeof drawingId !== 'string' || !ID_RE.test(drawingId)) return { problem: '그림을 붙일 수 없는 아이템이에요' };
      item.drawingId = drawingId;
      drawings.add(drawingId);
    }
    ids.add(id);
    types.add(def.type);
    items.push(item);
  }
  return { items, types, drawings };
}

/** 벽지/바닥 값 검사. 그림이면 그림 id 도 돌려준다 */
export function cleanSurface(v: unknown, kind: 'wallpaper' | 'floor'): { value: string; drawing: string | null } | null {
  if (typeof v !== 'string') return null;
  const presets: readonly { id: string }[] = kind === 'wallpaper' ? WALLPAPERS : FLOORS;
  if (presets.some((p) => p.id === v)) return { value: v, drawing: null };
  if (HEX_RE.test(v)) return { value: v.toLowerCase(), drawing: null };
  const m = v.match(/^drawing:([A-Za-z0-9_-]{1,24})$/);
  return m ? { value: v, drawing: m[1] } : null;
}

/** 기본 마당(6m) 밖에 놓인 아이템이 있는지. 2026-11-16 전에 7.2m 마당에 놓았던 집은 마당 넓히기를 무료로 열어 준다 */
export const yardOutsideBase = (items: readonly PlacedItem[]) => items.some((it) => Math.abs(it.x) > YARD_HALF + 0.01 || Math.abs(it.z) > YARD_HALF + 0.01);
