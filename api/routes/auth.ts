// 인스타 인증 주변 (2026-11-17): 입주 방식 안내, 되찾기, 신고, 소원 비는 곳, 관리자.
import { CODE_CHARS, igIdProblem, isAuthMode, isReportKind, normalizeIgId, RECLAIM_CODE_LEN, RECLAIM_TTL_SEC, REPORT_MAX, WISH_MAX, WISH_PER_DAY, WISH_SHOW } from '../../src/shared/auth';
import { FOLLOW_HANDLE } from '../../src/shared/config';
import { cleanChat } from '../../src/shared/handle';
import type { Env } from '../env';
import { clientIp, error, json, readJson } from '../http';
import { cachedJson, invalidate } from '../lib/cache';
import { HOUSE_COLS, publicHandle, toHouse, type HouseRow } from '../lib/houses';
import { authConfig, getSettings, ipHash, newCode, setSetting, syncComments } from '../lib/insta';
import { allow } from '../lib/rateLimit';
import { createSession, isSecure, sessionCookie, sessionHouse } from '../lib/session';

/** GET /api/auth-info : 지금 입주 방식 (암호는 주지 않는다) */
export async function authInfo(env: Env): Promise<Response> {
  const { mode } = await authConfig(env);
  return json({ mode, followHandle: FOLLOW_HANDLE }, { headers: { 'cache-control': 'public, max-age=30' } });
}

// ── 되찾기 ──

/** POST /api/reclaim {igId} : 되찾기 코드 받기. 그 아이디로 댓글에 코드를 남기면 집을 돌려받는다 */
export async function reclaimStart(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ igId?: unknown }>(request);
  const igId = typeof body?.igId === 'string' ? normalizeIgId(body.igId) : '';
  const p = igIdProblem(igId);
  if (p) return error(400, 'bad_ig_id', p);
  if (!(await allow(env.RL_MOVE_IN, `reclaim:${clientIp(request)}`, 5))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const { mode } = await authConfig(env);
  if (mode !== 'comment') return error(400, 'not_ready', '지금은 되찾기를 쓸 수 없어요. 신고하기로 알려 주세요');
  const house = await env.DB.prepare('SELECT house_no FROM houses WHERE ig_id = ?').bind(igId).first<{ house_no: number }>();
  if (!house) return error(404, 'no_house', '이 인스타 아이디로 가입한 집이 없어요. 그냥 입주하면 돼요');
  const code = newCode(RECLAIM_CODE_LEN, CODE_CHARS);
  await env.DB.prepare('INSERT INTO reclaims (code, ig_id) VALUES (?, ?)').bind(code, igId).run();
  return json({ ok: true, code, igId, houseNo: house.house_no, expiresIn: RECLAIM_TTL_SEC });
}

/** GET /api/reclaim/:code : 확인됐으면 그 집으로 로그인 (다른 기기의 로그인은 모두 끊는다) */
export async function reclaimPoll(code: string, request: Request, env: Env): Promise<Response> {
  const row = await env.DB
    .prepare('SELECT code, ig_id, created_at, verified_at FROM reclaims WHERE code = ?')
    .bind(code)
    .first<{ code: string; ig_id: string; created_at: number; verified_at: number | null }>();
  if (!row || row.created_at < Date.now() / 1000 - RECLAIM_TTL_SEC) return error(404, 'expired', '코드가 지났어요. 처음부터 다시 해 주세요');
  if (!row.verified_at) {
    // 기다리는 동안 댓글을 다시 읽어 본다 (모든 사람 합쳐 20초에 한 번)
    const s = await syncComments(env);
    if (s.ran && !s.error) {
      const again = await env.DB.prepare('SELECT verified_at FROM reclaims WHERE code = ?').bind(code).first<{ verified_at: number | null }>();
      if (!again?.verified_at) return json({ ok: true, pending: true });
    } else return json({ ok: true, pending: true });
  }
  const house = await env.DB.prepare(`SELECT ${HOUSE_COLS} FROM houses WHERE ig_id = ?`).bind(row.ig_id).first<HouseRow>();
  if (!house) return error(404, 'no_house', '집을 찾지 못했어요');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE house_id = ?').bind(house.id),
    env.DB.prepare('DELETE FROM reclaims WHERE code = ?').bind(code),
    env.DB.prepare("UPDATE houses SET verified = 1 WHERE id = ?").bind(house.id),
    env.DB.prepare("INSERT INTO signup_log (house_no, ig_id, kind, ip_hash) VALUES (?, ?, 'reclaim', ?)").bind(house.house_no, row.ig_id, await ipHash(clientIp(request))),
  ]);
  const token = await createSession(env.DB, house.id);
  return json(
    { ok: true, pending: false, token, house: toHouse({ ...house, verified: 1 }, true), hideHandle: house.hide_handle === 1 },
    { headers: { 'set-cookie': sessionCookie(token, isSecure(request)) } },
  );
}

// ── 신고 ──

/** POST /api/report {kind, houseNo?, igId?, contact?, text} : 입주 안 한 사람도 할 수 있다 (도용당한 사람) */
export async function report(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ kind?: unknown; houseNo?: unknown; igId?: unknown; contact?: unknown; text?: unknown }>(request, 4096);
  if (!body || !isReportKind(body.kind)) return error(400, 'bad_request', '신고 종류를 골라 주세요');
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, REPORT_MAX) : '';
  const igId = typeof body.igId === 'string' && body.igId.trim() ? normalizeIgId(body.igId) : null;
  if (igId && igIdProblem(igId)) return error(400, 'bad_ig_id', igIdProblem(igId)!);
  if (body.kind === 'stolen' && !igId) return error(400, 'bad_ig_id', '내 인스타 아이디를 적어 주세요');
  if (body.kind !== 'stolen' && text.length < 2) return error(400, 'bad_text', '무엇이 문제인지 적어 주세요');
  const houseNo = typeof body.houseNo === 'number' && Number.isInteger(body.houseNo) && body.houseNo > 0 ? body.houseNo : null;
  const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 60) : '';
  if (!(await allow(env.RL_WRITE, `report:${clientIp(request)}`, 5))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const ip = await ipHash(clientIp(request));
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created_at > unixepoch() - 86400').bind(ip).first<{ n: number }>();
  if ((n?.n ?? 0) >= 10) return error(429, 'limit', '오늘은 신고를 더 보낼 수 없어요. 고양이섬 인스타로 DM 을 보내 주세요');
  const mine = await sessionHouse(env.DB, request);
  await env.DB
    .prepare('INSERT INTO reports (kind, house_no, ig_id, contact, text, reporter, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(body.kind, houseNo, igId, contact || null, text, mine?.house.house_no ?? null, ip)
    .run();
  return json({ ok: true });
}

// ── 소원 비는 곳 ──
const WISH_KEY = 'wishes:v1';

/** GET /api/wishes : 최근 소원 (60초 캐시) */
export function getWishes(env: Env, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(WISH_KEY, ctx, async () => {
    const { results } = await env.DB
      .prepare(
        `SELECT w.id, w.text, w.created_at, h.house_no, h.ig_handle, h.hide_handle
         FROM wishes w LEFT JOIN houses h ON h.id = w.house_id WHERE w.hidden = 0 ORDER BY w.created_at DESC, w.id DESC LIMIT ?`,
      )
      .bind(WISH_SHOW)
      .all<{ id: number; text: string; created_at: number; house_no: number | null; ig_handle: string | null; hide_handle: number | null }>();
    return {
      wishes: results.map((r) => ({
        id: r.id,
        text: r.text,
        at: r.created_at,
        houseNo: r.house_no,
        handle: r.ig_handle ? publicHandle({ ig_handle: r.ig_handle, hide_handle: r.hide_handle ?? 0 }) : null,
      })),
    };
  });
}

/** POST /api/wishes {text} : 누구나 (하루 WISH_PER_DAY 번) */
export async function postWish(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ text?: unknown }>(request, 2048);
  const text = typeof body?.text === 'string' ? cleanChat(body.text, WISH_MAX) : '';
  if (!text) return error(400, 'bad_text', '쓸 수 없는 글이에요');
  if (!(await allow(env.RL_WRITE, `wish:${clientIp(request)}`, 10))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const ip = await ipHash(clientIp(request));
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM wishes WHERE ip_hash = ? AND created_at > unixepoch() - 86400').bind(ip).first<{ n: number }>();
  if ((n?.n ?? 0) >= WISH_PER_DAY) return error(400, 'limit', `소원은 하루 ${WISH_PER_DAY}번까지 빌 수 있어요`);
  const mine = await sessionHouse(env.DB, request);
  await env.DB.prepare('INSERT INTO wishes (house_id, text, ip_hash) VALUES (?, ?, ?)').bind(mine?.house.id ?? null, text, ip).run();
  invalidate(WISH_KEY);
  return json({ ok: true });
}

// ── 관리자 (secret ADMIN_KEY 를 x-admin-key 헤더로) ──

async function adminGate(request: Request, env: Env): Promise<Response | null> {
  if (!env.ADMIN_KEY) return error(404, 'not_found', '없는 API 예요');
  if (!(await allow(env.RL_MOVE_IN, `admin:${clientIp(request)}`, 20))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const key = request.headers.get('x-admin-key') ?? '';
  if (key.length < 8 || key !== env.ADMIN_KEY) return error(401, 'no_admin', '관리자 키가 틀렸어요');
  return null;
}

/** GET /api/admin : 설정, 토큰 상태, 새 신고, 최근 가입, 소원 */
export async function adminState(request: Request, env: Env): Promise<Response> {
  const bad = await adminGate(request, env);
  if (bad) return bad;
  const s = await getSettings(env.DB, ['auth_mode', 'follower_pw', 'ig_token', 'ig_last_sync', 'ig_sync_error', 'ig_token_refreshed']);
  const [reports, signups, wishes, comments] = await env.DB.batch([
    env.DB.prepare('SELECT id, kind, house_no, ig_id, contact, text, reporter, status, created_at FROM reports ORDER BY status, created_at DESC LIMIT 50'),
    env.DB.prepare('SELECT house_no, ig_id, kind, device, ip_hash, at FROM signup_log ORDER BY at DESC LIMIT 40'),
    env.DB.prepare('SELECT id, text, hidden, created_at FROM wishes ORDER BY created_at DESC LIMIT 60'),
    env.DB.prepare('SELECT COUNT(*) AS n, MAX(at) AS last FROM ig_comments'),
  ]);
  return json({
    mode: isAuthMode(s.auth_mode?.value) ? s.auth_mode!.value : 'off',
    password: s.follower_pw?.value ?? '',
    passwordAt: s.follower_pw?.at ?? null,
    token: s.ig_token?.value ? 'db' : env.IG_TOKEN ? 'secret' : 'none',
    tokenAt: s.ig_token?.at ?? null,
    tokenRefresh: s.ig_token_refreshed ? { ok: s.ig_token_refreshed.value !== 'fail', at: s.ig_token_refreshed.at } : null,
    lastSync: s.ig_last_sync?.at ?? null,
    syncError: s.ig_sync_error?.value || null,
    comments: comments.results[0] ?? null,
    reports: reports.results,
    signups: signups.results,
    wishes: wishes.results,
  });
}

/** POST /api/admin {action, ...} */
export async function adminAction(request: Request, env: Env): Promise<Response> {
  const bad = await adminGate(request, env);
  if (bad) return bad;
  const b = await readJson<Record<string, unknown>>(request, 8192);
  if (!b || typeof b.action !== 'string') return error(400, 'bad_request', '내용이 이상해요');
  switch (b.action) {
    case 'settings': {
      const stmts: D1PreparedStatement[] = [];
      if (b.mode !== undefined) {
        if (!isAuthMode(b.mode)) return error(400, 'bad_mode', '방식이 이상해요');
        stmts.push(setSetting(env.DB, 'auth_mode', b.mode));
      }
      if (typeof b.password === 'string') {
        const pw = b.password.trim();
        if (pw.length < 3 || pw.length > 30) return error(400, 'bad_pw', '암호는 3~30자로 해 주세요');
        stmts.push(setSetting(env.DB, 'follower_pw', pw));
      }
      if (typeof b.token === 'string') {
        const tk = b.token.trim();
        if (tk && !/^[A-Za-z0-9_\-.|]{20,600}$/.test(tk)) return error(400, 'bad_token', '토큰 모양이 이상해요');
        stmts.push(tk ? setSetting(env.DB, 'ig_token', tk) : env.DB.prepare("DELETE FROM app_settings WHERE key = 'ig_token'"));
        stmts.push(env.DB.prepare("DELETE FROM app_settings WHERE key = 'ig_token_refreshed'"));
      }
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true });
    }
    case 'sync':
      return json({ ok: true, result: await syncComments(env, true) });
    case 'resolve':
      await env.DB.prepare('UPDATE reports SET status = 1 WHERE id = ?').bind(Number(b.id)).run();
      return json({ ok: true });
    case 'hide-wish':
      await env.DB.prepare('UPDATE wishes SET hidden = 1 - hidden WHERE id = ?').bind(Number(b.id)).run();
      invalidate(WISH_KEY);
      return json({ ok: true });
    case 'free-ig': {
      // 도용 처리: 그 집의 인스타 아이디를 비우고 로그인을 모두 끊는다. 진짜 주인이 다시 가입할 수 있다
      const no = Number(b.houseNo);
      const h = await env.DB.prepare('SELECT id FROM houses WHERE house_no = ?').bind(no).first<{ id: number }>();
      if (!h) return error(404, 'no_house', '없는 번지예요');
      await env.DB.batch([
        env.DB.prepare('UPDATE houses SET ig_id = NULL, verified = 0 WHERE id = ?').bind(h.id),
        env.DB.prepare('DELETE FROM sessions WHERE house_id = ?').bind(h.id),
      ]);
      return json({ ok: true });
    }
    default:
      return error(400, 'bad_action', '모르는 일이에요');
  }
}
