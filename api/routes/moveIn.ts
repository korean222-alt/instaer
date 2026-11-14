import { defaultRoofColor } from '../../src/shared/catLook';
import { FOUNDER_MAX } from '../../src/shared/config';
import { handleProblem, HANDLE_PROBLEM_TEXT, normalizeHandle } from '../../src/shared/handle';
import type { House, RegionId } from '../../src/shared/types';
import type { Env } from '../env';
import { clientIp, error, json, readJson, weekStartKst } from '../http';
import { invalidate } from '../lib/cache';
import { HOUSE_COLS, isRegion, regionStats, toHouse, type HouseRow } from '../lib/houses';
import { allow } from '../lib/rateLimit';
import { createSession, isSecure, sessionCookie, sessionHouse } from '../lib/session';
import { REGIONS_KEY } from './regions';
import { VILLAGE_KEY } from './village';

export interface MoveInResponse {
  ok: true;
  house: House;
  founder: boolean;
  /** 화면 쪽 localStorage 에 두는 예비 로그인 표시 */
  token: string;
  region: { id: RegionId; rank: number; total: number; toFirst: number };
}

/** POST /api/move-in {handle, region} : 지금은 아이디 입력만으로 입주(미인증). 나중에 DM 코드 인증으로 바꾼다 */
export async function moveIn(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ handle?: unknown; region?: unknown }>(request);
  if (!body || typeof body.handle !== 'string') return error(400, 'bad_request', '아이디를 적어 주세요');
  const handle = normalizeHandle(body.handle);
  const problem = handleProblem(handle);
  if (problem) return error(400, `handle_${problem}`, HANDLE_PROBLEM_TEXT[problem]);
  if (!isRegion(body.region)) return error(400, 'bad_region', '사는 지역을 골라 주세요');
  const region = body.region;
  // 입력이 맞는 요청만 센다 (DB 를 건드리기 전에)
  if (!(await allow(env.RL_MOVE_IN, `move-in:${clientIp(request)}`, 5))) {
    return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  }

  // 이미 이 브라우저에 집이 있으면 새로 만들지 않는다
  const mine = await sessionHouse(env.DB, request);
  if (mine) return error(409, 'already_have_house', `이미 ${mine.house.house_no}번지에 살고 있어요`, { houseNo: mine.house.house_no });

  const taken = await env.DB.prepare('SELECT house_no FROM houses WHERE ig_handle = ?').bind(handle).first<{ house_no: number }>();
  if (taken) return error(409, 'handle_taken', `@${handle} 은 이미 ${taken.house_no}번지에 입주했어요`, { houseNo: taken.house_no });

  // 번지는 빈 번호 중 다음 번호. 동시에 들어오면 UNIQUE 충돌이 나므로 몇 번 다시 시도한다
  let row: HouseRow | null = null;
  for (let attempt = 0; attempt < 4 && !row; attempt++) {
    try {
      row = await env.DB.prepare(
        `INSERT INTO houses (house_no, ig_handle, region, roof_color)
         VALUES ((SELECT COALESCE(MAX(house_no), 0) + 1 FROM houses), ?, ?, ?)
         RETURNING ${HOUSE_COLS}`,
      )
        .bind(handle, region, defaultRoofColor(handle))
        .first<HouseRow>();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ig_handle/i.test(msg)) return error(409, 'handle_taken', `@${handle} 은 이미 입주했어요`);
      if (!/UNIQUE/i.test(msg)) throw e;
    }
  }
  if (!row) return error(503, 'busy', '입주하는 사람이 많아요. 잠시 후에 다시 해 주세요');

  const token = await createSession(env.DB, row.id);
  invalidate(VILLAGE_KEY, REGIONS_KEY);

  const stats = await regionStats(env.DB, weekStartKst());
  const me = stats.find((s) => s.id === region)!;
  const first = Math.max(...stats.map((s) => s.total));
  const res: MoveInResponse = {
    ok: true,
    house: toHouse(row),
    founder: row.house_no <= FOUNDER_MAX,
    token,
    region: { id: region, rank: me.rankTotal, total: me.total, toFirst: Math.max(0, first - me.total) },
  };
  return json(res, { status: 201, headers: { 'set-cookie': sessionCookie(token, isSecure(request)) } });
}

/** GET /api/me : 이 브라우저의 내 집 (없으면 house: null) */
export async function me(request: Request, env: Env): Promise<Response> {
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return json({ house: null });
  // 쿠키가 지워졌고 헤더로 왔으면 쿠키를 다시 심는다
  const hadCookie = (request.headers.get('cookie') ?? '').includes('ci_s=');
  const headers: HeadersInit = hadCookie ? {} : { 'set-cookie': sessionCookie(mine.token, isSecure(request)) };
  return json({ house: toHouse(mine.house), founder: mine.house.house_no <= FOUNDER_MAX }, { headers });
}
