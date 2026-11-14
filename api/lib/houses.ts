import { catLook } from '../../src/shared/catLook';
import { REGIONS } from '../../src/shared/config';
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
}

export const HOUSE_COLS = 'id, house_no, ig_handle, verified, region, roof_color, likes, created_at';

const REGION_IDS = new Set<string>(REGIONS.map((r) => r.id));
export const isRegion = (v: unknown): v is RegionId => typeof v === 'string' && REGION_IDS.has(v);

/** DB 한 줄 → 공통 House. 고양이는 저장하지 않고 아이디로 계산한다 */
export function toHouse(row: HouseRow): House {
  const look = catLook(row.ig_handle);
  return {
    houseNo: row.house_no,
    igHandle: row.ig_handle,
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

/** 지역별 입주 수와 이번 주 신규 입주 수, 순위 */
export interface RegionStat {
  id: RegionId;
  total: number;
  week: number;
  rankTotal: number;
  rankWeek: number;
}

export async function regionStats(db: D1Database, weekStart: number): Promise<RegionStat[]> {
  const { results } = await db
    .prepare(
      `SELECT region, COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week
       FROM houses GROUP BY region`,
    )
    .bind(weekStart)
    .all<{ region: string; total: number; week: number }>();
  const byId = new Map(results.map((r) => [r.region, r]));
  const stats = REGIONS.map((r) => ({
    id: r.id as RegionId,
    total: byId.get(r.id)?.total ?? 0,
    week: byId.get(r.id)?.week ?? 0,
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
