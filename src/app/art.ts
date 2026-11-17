// 직접 그린 그림을 모아서 씬에 넘긴다.
// - 씬에는 "지금 보이는 집"의 그림만 넘긴다 (가까운 집의 마당/지붕 + 들어가 있는 집 안 + 꾸미는 중인 것).
// - 그림은 저장하면 바뀌지 않으므로(고치면 새 id) 한 번 받은 것은 이 화면이 끝날 때까지 들고 있는다.
// - 지붕 그림은 씬에 setRoofArt 가 생기면 그때부터 보인다 (tasks/페이블-5 요청). 없으면 건너뛴다.
import { houseSlot } from '../scene';
import type { Drawing } from '../shared/types';
import { fetchDrawings, fetchMyDrawings } from './net/api';
import { state } from './state';

/** 씬이 앞으로 가질 함수 (Fable 작업 5). 아직 없으면 지붕 그림은 화면(2D)에서만 보인다 */
export interface RoofArtScene {
  setRoofArt(items: Array<{ houseNo: number; drawingId: string; backId?: string }>): void;
}
export const sceneHasRoofArt = () => typeof (state.scene as unknown as Partial<RoofArtScene>).setRoofArt === 'function';

const cache = new Map<string, Drawing>();
/** 서버에 없는 그림 (지워진 그림). 다시 묻지 않는다 */
const gone = new Set<string>();
let mine: Drawing[] = [];
let mineLoaded = false;
/** 집 안, 꾸미는 중 등 지금 꼭 보여야 하는 그림 */
let pinned = new Set<string>();
let center: { x: number; z: number } | null = null;
const RADIUS = 46;

export const drawingById = (id: string) => cache.get(id) ?? null;
export const myDrawingList = () => mine;

export function rememberDrawing(d: Drawing, isMine = false) {
  cache.set(d.id, d);
  if (isMine && !mine.some((m) => m.id === d.id)) mine = [d, ...mine];
}
export function forgetMyDrawing(id: string) {
  mine = mine.filter((d) => d.id !== id);
}

export async function loadMyDrawings(force = false): Promise<Drawing[]> {
  if (!state.me) return [];
  if (mineLoaded && !force) return mine;
  try {
    const res = await fetchMyDrawings();
    mine = res.drawings;
    mine.forEach((d) => cache.set(d.id, d));
    mineLoaded = true;
  } catch {
    /* 그림 없이도 된다 */
  }
  return mine;
}

/** 지금 꼭 보여야 하는 그림 (집 안 아이템, 벽지/바닥, 꾸미는 중인 목록) */
export function pinDrawings(ids: Iterable<string | undefined | null>) {
  pinned = new Set([...ids].filter((v): v is string => !!v));
  syncArt();
}

/** 주변 그림을 모을 기준 위치 (걷는 중이면 내 고양이, 아니면 보고 있는 집) */
export function setArtCenter(x: number, z: number) {
  if (center && Math.hypot(center.x - x, center.z - z) < 6) return;
  center = { x, z };
  syncArt();
}

/** surface 값('drawing:id')에서 그림 id */
export const surfaceDrawing = (v: string | undefined | null) => (v && v.startsWith('drawing:') ? v.slice(8) : null);

let timer = 0;
let running = false;
/** 필요한 그림을 모아서 (없는 것은 받아서) 씬에 넘긴다. 짧게 모아서 한 번에 */
export function syncArt() {
  clearTimeout(timer);
  timer = window.setTimeout(run, 120);
}

/** 기준점에서 멀어도 가까운 순으로 이만큼은 그림을 보여 준다 (지도 화면에서 다른 동네 집도 보이게) */
const MIN_HOUSES = 40;

function nearHouses(): number[] {
  const consider = new Set<number>([...state.yards.keys(), ...state.roofArt.keys(), ...state.roofArtBack.keys()]);
  if (state.me) consider.add(state.me.houseNo);
  // 2026-11-17: 기준점이 없으면(입주 전 구경, 방금 입주) 아무 그림도 안 보이던 문제 → 내 집, 없으면 1번지 둘레를 기준으로
  const c = center ?? (state.me ? houseSlot(state.me.houseNo) : houseSlot(1));
  const byDist = [...consider]
    .map((no) => {
      const s = houseSlot(no);
      return { no, d: Math.hypot(s.x - c.x, s.z - c.z) };
    })
    .sort((a, b) => a.d - b.d);
  return byDist.filter((h, i) => h.d <= RADIUS || i < MIN_HOUSES).map((h) => h.no);
}

async function run() {
  if (running) return syncArt();
  running = true;
  try {
    const houses = nearHouses();
    const want = new Set<string>(pinned);
    const roofs: Array<{ houseNo: number; drawingId: string; backId?: string }> = [];
    for (const no of houses) {
      for (const it of state.yards.get(no) ?? []) if (it.drawingId) want.add(it.drawingId);
      const roof = state.roofArt.get(no);
      const back = state.roofArtBack.get(no);
      if (roof) want.add(roof);
      if (back) want.add(back);
      if (roof || back) roofs.push({ houseNo: no, drawingId: roof ?? '', ...(back ? { backId: back } : {}) });
    }
    const missing = [...want].filter((id) => !cache.has(id) && !gone.has(id));
    for (let i = 0; i < missing.length; i += 60) {
      const chunk = missing.slice(i, i + 60);
      try {
        const res = await fetchDrawings(chunk);
        res.drawings.forEach((d) => cache.set(d.id, d));
        chunk.filter((id) => !cache.has(id)).forEach((id) => gone.add(id));
      } catch {
        break; // 다음에 다시
      }
    }
    state.scene.setDrawings([...want].map((id) => cache.get(id)).filter((d): d is Drawing => !!d));
    if (sceneHasRoofArt()) (state.scene as unknown as RoofArtScene).setRoofArt(
        roofs
          .map((r) => ({ houseNo: r.houseNo, drawingId: cache.has(r.drawingId) ? r.drawingId : '', ...(r.backId && cache.has(r.backId) ? { backId: r.backId } : {}) }))
          .filter((r) => r.drawingId || r.backId),
      );
  } finally {
    running = false;
  }
}
