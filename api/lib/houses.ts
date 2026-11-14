import { catLook } from '../../src/shared/catLook';
import { REGIONS, ZONE_CAPACITY } from '../../src/shared/config';
import { maskHandle } from '../../src/shared/handle';
import type { House, RegionId } from '../../src/shared/types';

export interface HouseRow {
  id: number;
  house_no: number;
  ig_handle: string;
  verified: number;
  region: string;
  roof_color: string;
  likes: number;
  created_at: number;
  hide_handle: number;
}

export const HOUSE_COLS = 'id, house_no, ig_handle, verified, region, roof_color, likes, created_at, hide_handle';

const REGION_IDS = new Set<string>(REGIONS.map((r) => r.id));
export const isRegion = (v: unknown): v is RegionId => typeof v === 'string' && REGION_IDS.has(v);

/** 다른 사람에게 보여 줄 아이디 (숨기기를 켰으면 가린 아이디) */
export const publicHandle = (row: Pick<HouseRow, 'ig_handle' | 'hide_handle'>) => (row.hide_handle ? maskHandle(row.ig_handle) : row.ig_handle);

/** DB 한 줄 → 공통 House. 고양이는 저장하지 않고 진짜 아이디로 계산한다 (가려도 고양이는 같다) */
export function toHouse(row: HouseRow, owner = false): House {
  const look = catLook(row.ig_handle);
  return {
    houseNo: row.house_no,
    igHandle: owner ? row.ig_handle : publicHandle(row),
    roofColor: row.roof_color,
    region: isRegion(row.region) ? row.region : 'other',
    cat: { fur: look.fur, pattern: look.pattern, eyeColor: look.eyeColor },
    likes: row.likes,
    isNpc: false,
    verified: row.verified === 1,
  };
}

export async function houseByNo(db: D1Database, houseNo: number): Promise<HouseRow | null> {
  return db.prepare(`SELECT ${HOUSE_COLS} FROM houses WHERE house_no = ?`).bind(houseNo).first<HouseRow>();
}

export const zoneOfHouseNo = (houseNo: number) => Math.floor((houseNo - 1) / ZONE_CAPACITY);

/**
 * 그 구역의 미리 만든 목록을 "다시 만들어야 함"으로 표시한다 (쓰기 1행).
 * level 2: 집/마당/숨기기가 바뀜 → 다음 마을 요청에서 바로 다시 만든다
 * level 1: 예뻐요 수만 바뀜 → 15분에 한 번만 다시 만든다 (읽기 한도 아끼기)
 */
export function markZoneDirty(db: D1Database, houseNo: number, level: 1 | 2): D1PreparedStatement {
  return db.prepare('UPDATE zone_cache SET dirty = ? WHERE zone = ? AND dirty < ?').bind(level, zoneOfHouseNo(houseNo), level);
}

/** 지역별 입주 수와 이번 주 신규 입주 수, 순위 */
export interface RegionStat {
  id: RegionId;
  total: number;
  week: number;
  rankTotal: number;
  rankWeek: number;
}

/** 지역 순위. 미리 세어 둔 region_counts 만 읽는다 (최대 36행) */
export async function regionStats(db: D1Database, weekStart: number): Promise<RegionStat[]> {
  const { results } = await db
    .prepare('SELECT region, week, n FROM region_counts WHERE week IN (0, ?)')
    .bind(weekStart)
    .all<{ region: string; week: number; n: number }>();
  const total = new Map<string, number>();
  const week = new Map<string, number>();
  for (const r of results) (r.week === 0 ? total : week).set(r.region, r.n);
  const stats = REGIONS.map((r) => ({
    id: r.id as RegionId,
    total: total.get(r.id) ?? 0,
    week: week.get(r.id) ?? 0,
    rankTotal: 0,
    rankWeek: 0,
  }));
  // 같은 수면 같은 순위 (1, 2, 2, 4 ...)
  const rank = (key: 'total' | 'week', out: 'rankTotal' | 'rankWeek') => {
    const sorted = [...stats].sort((a, b) => b[key] - a[key]);
    sorted.forEach((s, i) => {
      s[out] = i > 0 && sorted[i - 1][key] === s[key] ? sorted[i - 1][out] : i + 1;
    });
  };
  rank('total', 'rankTotal');
  rank('week', 'rankWeek');
  return stats;
}

/** 입주할 때 지역 수 더하기 (전체 + 이번 주) */
export function bumpRegion(db: D1Database, region: RegionId, weekStart: number): D1PreparedStatement[] {
  const sql = 'INSERT INTO region_counts (region, week, n) VALUES (?, ?, 1) ON CONFLICT (region, week) DO UPDATE SET n = n + 1';
  return [db.prepare(sql).bind(region, 0), db.prepare(sql).bind(region, weekStart)];
}
