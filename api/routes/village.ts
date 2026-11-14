import { ZONE_CAPACITY } from '../../src/shared/config';
import type { House, YardItem } from '../../src/shared/types';
import type { Env } from '../env';
import { utcDay } from '../http';
import { cachedJson } from '../lib/cache';
import { HOUSE_COLS, toHouse, type HouseRow } from '../lib/houses';

export interface VillageResponse {
  houses: House[];
  /** 번지 → 마당 아이템 (아이템이 있는 집만) */
  yards: Record<number, YardItem[]>;
  total: number;
  /** 열린 구역 수 (집이 있는 구역 + 0채면 1) */
  unlockedZones: number;
  /** 오늘의 특이한 집: 오늘 예뻐요를 가장 많이 받은 집 (없으면 전체 예뻐요 1등) */
  todayTop: { houseNo: number; likesToday: number } | null;
  updatedAt: number;
}

export const VILLAGE_KEY = 'village-v1';

/** GET /api/village : 입주한 집 전체. 빈 번지(NPC)는 넣지 않는다 (화면이 채운다) */
export function village(env: Env, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(VILLAGE_KEY, ctx, async (): Promise<VillageResponse> => {
    const today = utcDay();
    const [houses, items, top] = await env.DB.batch([
      env.DB.prepare(`SELECT ${HOUSE_COLS} FROM houses ORDER BY house_no`),
      env.DB.prepare(
        'SELECT h.house_no AS house_no, y.item_type AS item_type, y.x AS x, y.y AS y, y.rotation AS rotation FROM yard_items y JOIN houses h ON h.id = y.house_id',
      ),
      env.DB.prepare(
        `SELECT h.house_no AS house_no, COUNT(*) AS n FROM likes_log l JOIN houses h ON h.id = l.house_id
         WHERE l.day = ? GROUP BY l.house_id ORDER BY n DESC, h.likes DESC LIMIT 1`,
      ).bind(today),
    ]);
    const rows = houses.results as unknown as HouseRow[];
    const yards: Record<number, YardItem[]> = {};
    for (const r of items.results as Array<{ house_no: number; item_type: YardItem['type']; x: number; y: number; rotation: YardItem['rotation'] }>) {
      (yards[r.house_no] ??= []).push({ type: r.item_type, x: r.x, y: r.y, rotation: r.rotation });
    }
    const topRow = (top.results as Array<{ house_no: number; n: number }>)[0];
    let todayTop: VillageResponse['todayTop'] = topRow ? { houseNo: topRow.house_no, likesToday: topRow.n } : null;
    if (!todayTop) {
      const best = rows.reduce<HouseRow | null>((a, b) => (b.likes > (a?.likes ?? 0) ? b : a), null);
      if (best) todayTop = { houseNo: best.house_no, likesToday: 0 };
    }
    const maxNo = rows.length ? rows[rows.length - 1].house_no : 0;
    return {
      houses: rows.map(toHouse),
      yards,
      total: rows.length,
      unlockedZones: Math.max(1, Math.ceil(maxNo / ZONE_CAPACITY)),
      todayTop,
      updatedAt: Date.now(),
    };
  });
}
