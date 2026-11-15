import { defaultRoofColor, encodeCat, parseCatChoice } from '../../src/shared/catLook';
import { FOUNDER_MAX } from '../../src/shared/config';
import { handleProblem, HANDLE_PROBLEM_TEXT, normalizeHandle } from '../../src/shared/handle';
import type { House, RegionId } from '../../src/shared/types';
import { maxPickableHouseNo } from '../../src/shared/zones';
import type { Env } from '../env';
import { clientIp, error, json, readJson, weekStartKst } from '../http';
import { invalidate } from '../lib/cache';
import { bumpRegion, HOUSE_COLS, isRegion, markZoneDirty, regionStats, toHouse, type HouseRow } from '../lib/houses';
import { allow } from '../lib/rateLimit';
import { createSession, isSecure, sessionCookie, sessionHouse } from '../lib/session';
import { loadWallet, saveWallet, walletView } from '../lib/wallet';
import { CURRENCY, RENAME_COST } from '../../src/shared/economy';
import { REGIONS_KEY } from './regions';
import { VILLAGE_KEY } from './village';
import { incomingCount } from './social';

export interface MoveInResponse {
  ok: true;
  house: House;
  hideHandle: boolean;
  founder: boolean;
  /** 화면 쪽 localStorage 에 두는 예비 로그인 표시 */
  token: string;
  region: { id: RegionId; rank: number; total: number; toFirst: number };
}

/** 빈 번지 중 가장 앞 번호 (1번이 비었으면 1). INSERT 안에서 바로 계산해서 동시에 들어와도 다시 시도하면 된다 */
const FIRST_EMPTY_NO = `CASE WHEN NOT EXISTS (SELECT 1 FROM houses WHERE house_no = 1) THEN 1
  ELSE (SELECT MIN(h.house_no) + 1 FROM houses h WHERE NOT EXISTS (SELECT 1 FROM houses x WHERE x.house_no = h.house_no + 1)) END`;

/**
 * POST /api/move-in {handle, region, hideHandle?, cat?, houseNo?} : 닉네임(handle) 입력만으로 입주(미인증, soft).
 * 화면이 먼저 운영 계정 팔로우를 요구하지만 팔로우 여부는 확인하지 않는다 (인스타 메시지 API 는 사업자 인증이 필요해서 못 씀).
 * cat: 고른 고양이 {pattern, fur, eyeColor} (CAT_CHOICES / EYE_CHOICES 안의 값). 없으면 아이디로 정해진 고양이.
 * houseNo: 고른 빈 집 번지 (열린 구역 안). 없으면 빈 번지 중 가장 앞 번호.
 */
export async function moveIn(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ handle?: unknown; region?: unknown; hideHandle?: unknown; cat?: unknown; houseNo?: unknown }>(request);
  if (!body || typeof body.handle !== 'string') return error(400, 'bad_request', '닉네임을 적어 주세요');
  const handle = normalizeHandle(body.handle);
  const problem = handleProblem(handle);
  if (problem) return error(400, `handle_${problem}`, HANDLE_PROBLEM_TEXT[problem]);
  if (!isRegion(body.region)) return error(400, 'bad_region', '사는 지역을 골라 주세요');
  const region = body.region;
  const cat = body.cat === undefined || body.cat === null ? null : parseCatChoice(body.cat);
  if (body.cat != null && !cat) return error(400, 'bad_cat', '고를 수 없는 고양이예요');
  const picked = body.houseNo === undefined || body.houseNo === null ? null : body.houseNo;
  if (picked !== null && !(typeof picked === 'number' && Number.isInteger(picked) && picked >= 1)) {
    return error(400, 'bad_house', '고를 수 없는 집이에요');
  }
  // 입력이 맞는 요청만 센다 (DB 를 건드리기 전에)
  if (!(await allow(env.RL_MOVE_IN, `move-in:${clientIp(request)}`, 5))) {
    return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  }

  // 이미 이 브라우저에 집이 있으면 새로 만들지 않는다
  const mine = await sessionHouse(env.DB, request);
  if (mine) return error(409, 'already_have_house', `이미 ${mine.house.house_no}번지에 살고 있어요`, { houseNo: mine.house.house_no });

  const [takenRes, countRes] = await env.DB.batch([
    env.DB.prepare('SELECT house_no FROM houses WHERE ig_handle = ?').bind(handle),
    // 입주 수는 미리 세어 둔 region_counts(최대 18행)로 센다 (houses 전체를 세지 않는다)
    env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS total, (SELECT MAX(house_no) FROM houses) AS max_no FROM region_counts WHERE week = 0'),
  ]);
  const taken = takenRes.results[0] as { house_no: number } | undefined;
  if (taken) return error(409, 'handle_taken', `${handle} 닉네임은 이미 ${taken.house_no}번지 고양이가 쓰고 있어요. 다른 닉네임을 써 주세요`, { houseNo: taken.house_no });
  if (picked !== null) {
    const c = countRes.results[0] as { total: number; max_no: number | null } | undefined;
    if (picked > maxPickableHouseNo(c?.total ?? 0, c?.max_no ?? 0)) return error(400, 'house_locked', '아직 열리지 않은 집이에요');
  }

  // 고른 집이 없으면 빈 번지 중 가장 앞 번호. 동시에 들어오면 UNIQUE 충돌이 나므로 몇 번 다시 시도한다
  let row: HouseRow | null = null;
  for (let attempt = 0; attempt < 4 && !row; attempt++) {
    try {
      const sql = `INSERT INTO houses (house_no, ig_handle, region, roof_color, hide_handle, cat)
         VALUES (${picked !== null ? '?' : FIRST_EMPTY_NO}, ?, ?, ?, ?, ?)
         RETURNING ${HOUSE_COLS}`;
      const args = [handle, region, defaultRoofColor(handle), body.hideHandle === true ? 1 : 0, cat ? encodeCat(cat) : null];
      row = await env.DB.prepare(sql)
        .bind(...(picked !== null ? [picked, ...args] : args))
        .first<HouseRow>();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ig_handle/i.test(msg)) return error(409, 'handle_taken', `${handle} 닉네임은 이미 쓰고 있는 고양이가 있어요. 다른 닉네임을 써 주세요`);
      if (!/UNIQUE/i.test(msg)) throw e;
      if (picked !== null) return error(409, 'house_taken', `${picked}번지는 방금 다른 고양이가 입주했어요. 다른 집을 골라 주세요`);
    }
  }
  if (!row) return error(503, 'busy', '입주하는 사람이 많아요. 잠시 후에 다시 해 주세요');

  const token = await createSession(env.DB, row.id);
  const week = weekStartKst();
  await env.DB.batch([...bumpRegion(env.DB, region, week), markZoneDirty(env.DB, row.house_no, 2)]);
  invalidate(VILLAGE_KEY, REGIONS_KEY);

  const stats = await regionStats(env.DB, week);
  const me = stats.find((s) => s.id === region)!;
  const first = Math.max(...stats.map((s) => s.total));
  const res: MoveInResponse = {
    ok: true,
    house: toHouse(row, true),
    hideHandle: row.hide_handle === 1,
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
  const friendRequests = await incomingCount(env.DB, mine.house.id).catch(() => 0);
  return json(
    { house: toHouse(mine.house, true), hideHandle: mine.house.hide_handle === 1, founder: mine.house.house_no <= FOUNDER_MAX, friendRequests },
    { headers },
  );
}

/** PUT /api/me/privacy {hideHandle} : 다른 사람에게 내 아이디를 가려서 보여 줄지 */
export async function setPrivacy(request: Request, env: Env): Promise<Response> {
  if (!(await allow(env.RL_WRITE, `write:${clientIp(request)}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주한 사람만 바꿀 수 있어요');
  const body = await readJson<{ hideHandle?: unknown }>(request);
  if (!body || typeof body.hideHandle !== 'boolean') return error(400, 'bad_request', '내용이 이상해요');
  const v = body.hideHandle ? 1 : 0;
  if (v !== mine.house.hide_handle) {
    await env.DB.batch([
      env.DB.prepare('UPDATE houses SET hide_handle = ? WHERE id = ?').bind(v, mine.house.id),
      markZoneDirty(env.DB, mine.house.house_no, 2),
    ]);
    invalidate(VILLAGE_KEY);
  }
  return json({ ok: true, hideHandle: body.hideHandle });
}

/**
 * POST /api/me/rename {handle} : 닉네임(= 고양이 이름) 바꾸기. RENAME_COST 츄르 (2026-11-15).
 * 닉네임 규칙과 중복 검사는 입주와 같다. 지갑과 집 이름을 한 번에(batch) 바꾼다.
 */
export async function rename(request: Request, env: Env): Promise<Response> {
  if (!(await allow(env.RL_WRITE, `write:${clientIp(request)}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주한 사람만 바꿀 수 있어요');
  const body = await readJson<{ handle?: unknown }>(request);
  if (!body || typeof body.handle !== 'string') return error(400, 'bad_request', '새 닉네임을 적어 주세요');
  const handle = normalizeHandle(body.handle);
  const problem = handleProblem(handle);
  if (problem) return error(400, `handle_${problem}`, HANDLE_PROBLEM_TEXT[problem]);
  if (handle === mine.house.ig_handle) return error(400, 'same', '지금 닉네임과 같아요');
  const taken = await env.DB.prepare('SELECT house_no FROM houses WHERE ig_handle = ?').bind(handle).first<{ house_no: number }>();
  if (taken) return error(409, 'handle_taken', `${handle} 닉네임은 이미 다른 고양이가 쓰고 있어요`);
  const w = await loadWallet(env.DB, mine.house.id);
  if (w.coins < RENAME_COST) return error(400, 'no_coins', `${CURRENCY}가 ${RENAME_COST - w.coins}개 모자라요`);
  w.coins -= RENAME_COST;
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE houses SET ig_handle = ? WHERE id = ?').bind(handle, mine.house.id),
      saveWallet(env.DB, mine.house.id, w),
      markZoneDirty(env.DB, mine.house.house_no, 2),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|ig_handle/i.test(msg)) return error(409, 'handle_taken', `${handle} 닉네임은 이미 다른 고양이가 쓰고 있어요`);
    throw e;
  }
  invalidate(VILLAGE_KEY);
  const house = toHouse({ ...mine.house, ig_handle: handle }, true);
  return json({ ok: true, house, wallet: walletView(w, mine.house.house_no) });
}
