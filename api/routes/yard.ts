import { HOUSE_CELLS, ROOF_COLORS, YARD_ITEM_MAX, YARD_ITEMS, YARD_SIZE } from '../../src/shared/config';
import type { YardItem } from '../../src/shared/types';
import type { Env } from '../env';
import { clientIp, error, json, readJson } from '../http';
import { invalidate } from '../lib/cache';
import { houseByNo } from '../lib/houses';
import { allow } from '../lib/rateLimit';
import { sessionHouse } from '../lib/session';
import { VILLAGE_KEY } from './village';

const ITEM_TYPES = new Set<string>(YARD_ITEMS.map((i) => i.type));
const ROTATIONS = new Set([0, 90, 180, 270]);

export const inHouseCell = (x: number, y: number) =>
  x >= HOUSE_CELLS.x0 && x <= HOUSE_CELLS.x1 && y >= HOUSE_CELLS.y0 && y <= HOUSE_CELLS.y1;

/** 아이템 목록 검사. 문제가 있으면 이유, 없으면 정리된 목록 */
export function cleanItems(raw: unknown): { items: YardItem[] } | { problem: string } {
  if (!Array.isArray(raw)) return { problem: '아이템 목록이 이상해요' };
  if (raw.length > YARD_ITEM_MAX) return { problem: `아이템은 ${YARD_ITEM_MAX}개까지 놓을 수 있어요` };
  const used = new Set<string>();
  const items: YardItem[] = [];
  for (const it of raw as Array<Record<string, unknown>>) {
    const { type, x, y, rotation } = it ?? {};
    if (typeof type !== 'string' || !ITEM_TYPES.has(type)) return { problem: '없는 아이템이에요' };
    if (!Number.isInteger(x) || !Number.isInteger(y)) return { problem: '칸 위치가 이상해요' };
    const cx = x as number;
    const cy = y as number;
    if (cx < 0 || cy < 0 || cx >= YARD_SIZE || cy >= YARD_SIZE) return { problem: '마당 밖에는 놓을 수 없어요' };
    if (inHouseCell(cx, cy)) return { problem: '집이 있는 칸에는 놓을 수 없어요' };
    if (!ROTATIONS.has(rotation as number)) return { problem: '방향이 이상해요' };
    const key = `${cx},${cy}`;
    if (used.has(key)) return { problem: '한 칸에는 하나만 놓을 수 있어요' };
    used.add(key);
    items.push({ type: type as YardItem['type'], x: cx, y: cy, rotation: rotation as YardItem['rotation'] });
  }
  return { items };
}

/** GET /api/yard/:houseNo */
export async function getYard(houseNo: number, env: Env): Promise<Response> {
  const house = await houseByNo(env.DB, houseNo);
  if (!house) return error(404, 'no_house', '빈 집이에요');
  const { results } = await env.DB.prepare('SELECT item_type, x, y, rotation FROM yard_items WHERE house_id = ?')
    .bind(house.id)
    .all<{ item_type: YardItem['type']; x: number; y: number; rotation: YardItem['rotation'] }>();
  return json({
    houseNo,
    roofColor: house.roof_color,
    items: results.map((r) => ({ type: r.item_type, x: r.x, y: r.y, rotation: r.rotation })),
  });
}

/** PUT /api/yard/:houseNo {items, roofColor} : 내 집만 바꿀 수 있다. 전체를 한 번에 바꾼다 */
export async function putYard(houseNo: number, request: Request, env: Env): Promise<Response> {
  if (!(await allow(env.RL_WRITE, `write:${clientIp(request)}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주한 사람만 꾸밀 수 있어요');
  if (mine.house.house_no !== houseNo) return error(403, 'not_yours', '내 집만 꾸밀 수 있어요');

  const body = await readJson<{ items?: unknown; roofColor?: unknown }>(request);
  if (!body) return error(400, 'bad_request', '내용이 이상해요');
  const checked = cleanItems(body.items ?? []);
  if ('problem' in checked) return error(400, 'bad_items', checked.problem);
  const roof = body.roofColor ?? mine.house.roof_color;
  if (typeof roof !== 'string' || !(ROOF_COLORS as readonly string[]).includes(roof)) return error(400, 'bad_roof', '없는 지붕 색이에요');

  const id = mine.house.id;
  const stmts = [env.DB.prepare('DELETE FROM yard_items WHERE house_id = ?').bind(id)];
  if (checked.items.length) {
    const values = checked.items.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const args = checked.items.flatMap((i) => [id, i.type, i.x, i.y, i.rotation]);
    stmts.push(env.DB.prepare(`INSERT INTO yard_items (house_id, item_type, x, y, rotation) VALUES ${values}`).bind(...args));
  }
  if (roof !== mine.house.roof_color) stmts.push(env.DB.prepare('UPDATE houses SET roof_color = ? WHERE id = ?').bind(roof, id));
  await env.DB.batch(stmts);
  invalidate(VILLAGE_KEY);
  return json({ ok: true, houseNo, roofColor: roof, items: checked.items });
}
