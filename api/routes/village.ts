import { ZONE_CAPACITY } from '../../src/shared/config';
import type { House, PlacedItem } from '../../src/shared/types';
import type { Env } from '../env';
import { utcDay } from '../http';
import { cachedJson } from '../lib/cache';
import { parseItems } from '../lib/decor';
import { HOUSE_COLS, toHouse, type HouseRow } from '../lib/houses';
import { openZoneCount } from '../../src/shared/zones';

export interface VillageResponse {
  houses: House[];
  /** 번지 → 마당 자유 배치 아이템 (아이템이 있는 집만) */
  yards: Record<number, PlacedItem[]>;
  /** 번지 → 지붕 그림 id (그림을 붙인 집만). 그림 내용은 /api/drawings 로 받는다 */
  roofArt: Record<number, string>;
  total: number;
  /** 열린 구역 수 (집이 있는 구역 + 0채면 1) */
  unlockedZones: number;
  /** 오늘의 특이한 집: 오늘 예뻐요를 가장 많이 받은 집 (없으면 전체 예뻐요 1등) */
  todayTop: { houseNo: number; likesToday: number } | null;
  updatedAt: number;
}

interface ZoneData {
  houses: House[];
  yards: Record<number, PlacedItem[]>;
  roofArt?: Record<number, string>;
}

export const VILLAGE_KEY = 'village-v3';
/** 집/마당이 바뀐 구역은 이 시간이 지나면 다시 만든다 (여러 요청이 한꺼번에 다시 만들지 않게) */
const REBUILD_STRUCT_SEC = 20;
/** 예뻐요 수만 바뀐 구역은 15분에 한 번 */
const REBUILD_LIKES_SEC = 900;

/** 구역 하나의 목록을 DB 에서 새로 만든다 (그 구역 집 100채 + 꾸미기 100줄만 읽는다) */
async function buildZone(db: D1Database, zone: number): Promise<ZoneData> {
  const lo = zone * ZONE_CAPACITY + 1;
  const hi = lo + ZONE_CAPACITY - 1;
  const [houses, decor] = await db.batch([
    db.prepare(`SELECT ${HOUSE_COLS} FROM houses WHERE house_no BETWEEN ? AND ? ORDER BY house_no`).bind(lo, hi),
    db
      .prepare(
        `SELECT h.house_no AS house_no, d.yard AS yard, d.roof_art AS roof_art
         FROM houses h JOIN house_decor d ON d.house_id = h.id WHERE h.house_no BETWEEN ? AND ?`,
      )
      .bind(lo, hi),
  ]);
  const yards: Record<number, PlacedItem[]> = {};
  const roofArt: Record<number, string> = {};
  for (const r of decor.results as Array<{ house_no: number; yard: string; roof_art: string | null }>) {
    const items = parseItems(r.yard);
    if (items.length) yards[r.house_no] = items;
    if (r.roof_art) roofArt[r.house_no] = r.roof_art;
  }
  return { houses: (houses.results as unknown as HouseRow[]).map((h) => toHouse(h)), yards, roofArt };
}

/**
 * GET /api/village : 입주한 집 전체. 빈 번지(NPC)는 넣지 않는다 (화면이 채운다).
 * 사람이 많아져도 D1 읽기 한도를 넘지 않게, 구역마다 미리 만든 JSON(zone_cache)만 읽고
 * 바뀐 구역만 다시 만든다. 그 위에 Worker 메모리 60초 캐시가 한 번 더 있다.
 */
export function village(env: Env, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(VILLAGE_KEY, ctx, async (): Promise<VillageResponse> => {
    const db = env.DB;
    const now = Math.floor(Date.now() / 1000);
    const [cacheRes, maxRes, topRes] = await db.batch([
      db.prepare('SELECT zone, json, built_at, dirty FROM zone_cache ORDER BY zone'),
      db.prepare('SELECT MAX(house_no) AS m FROM houses'),
      db.prepare('SELECT house_no, likes_today FROM houses WHERE likes_day = ? ORDER BY likes_today DESC LIMIT 1').bind(utcDay()),
    ]);
    const cached = new Map((cacheRes.results as Array<{ zone: number; json: string; built_at: number; dirty: number }>).map((r) => [r.zone, r]));
    const maxNo = (maxRes.results[0] as { m: number | null } | undefined)?.m ?? 0;
    const zoneCount = Math.ceil(maxNo / ZONE_CAPACITY);

    const zones: ZoneData[] = [];
    const writes: D1PreparedStatement[] = [];
    for (let z = 0; z < zoneCount; z++) {
      const c = cached.get(z);
      const age = c ? now - c.built_at : Infinity;
      const stale = !c || (c.dirty === 2 && age >= REBUILD_STRUCT_SEC) || (c.dirty === 1 && age >= REBUILD_LIKES_SEC);
      if (!stale) {
        zones.push(JSON.parse(c.json) as ZoneData);
        continue;
      }
      const data = await buildZone(db, z);
      zones.push(data);
      writes.push(
        db
          .prepare(
            `INSERT INTO zone_cache (zone, json, built_at, dirty) VALUES (?, ?, ?, 0)
             ON CONFLICT (zone) DO UPDATE SET json = excluded.json, built_at = excluded.built_at,
               dirty = CASE WHEN zone_cache.dirty <= ? THEN 0 ELSE zone_cache.dirty END`,
          )
          .bind(z, JSON.stringify(data), now, c?.dirty ?? 0),
      );
    }
    if (writes.length) ctx.waitUntil(db.batch(writes).catch((e) => console.error('[village] zone_cache', e)));

    const houses = zones.flatMap((d) => d.houses);
    const yards = Object.assign({}, ...zones.map((d) => d.yards)) as Record<number, PlacedItem[]>;
    const roofArt = Object.assign({}, ...zones.map((d) => d.roofArt ?? {})) as Record<number, string>;
    const topRow = topRes.results[0] as { house_no: number; likes_today: number } | undefined;
    let todayTop: VillageResponse['todayTop'] = topRow ? { houseNo: topRow.house_no, likesToday: topRow.likes_today } : null;
    if (!todayTop && houses.length) {
      const best = houses.reduce((a, b) => (b.likes > a.likes ? b : a));
      if (best.likes > 0) todayTop = { houseNo: best.houseNo, likesToday: 0 };
    }
    return {
      houses,
      yards,
      roofArt,
      total: houses.length,
      unlockedZones: openZoneCount(houses.length, maxNo),
      todayTop,
      updatedAt: Date.now(),
    };
  });
}
