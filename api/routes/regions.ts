import type { Env } from '../env';
import { weekStartKst } from '../http';
import { cachedJson } from '../lib/cache';
import { regionStats, type RegionStat } from '../lib/houses';

export interface RegionsResponse {
  regions: RegionStat[];
  total: number;
  weekStart: number;
  updatedAt: number;
}

export const REGIONS_KEY = 'regions-v1';

/** GET /api/regions : 지역별 전체 입주 수, 이번 주(한국 시간 월요일부터) 신규 입주 수, 순위 */
export function regions(env: Env, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(REGIONS_KEY, ctx, async (): Promise<RegionsResponse> => {
    const weekStart = weekStartKst();
    const stats = await regionStats(env.DB, weekStart);
    return { regions: stats, total: stats.reduce((n, s) => n + s.total, 0), weekStart, updatedAt: Date.now() };
  });
}
