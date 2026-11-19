// 소통 (2026-11-15): 친구, 방명록, 마을 게시판.
// D1 무료 한도(하루 읽기 500만 행, 쓰기 10만 행)에 맞게 목록은 짧게(LIMIT), 게시판은 60초 캐시한다.
import { decorScore } from '../../src/shared/decorScore';
import { toDecor, type DecorRow } from '../lib/decor';
import { cleanChat } from '../../src/shared/handle';
import { BOARD_MAX, BOARD_PER_DAY, BOARD_SHOW, FRIEND_MAX, GUESTBOOK_MAX, GUESTBOOK_SHOW } from '../../src/shared/social';
import { houseCat } from '../../src/shared/catLook';
import type { CatLook } from '../../src/shared/types';
import type { Env } from '../env';
import { clientIp, error, json, readJson, utcDay } from '../http';
import { cachedJson, invalidate } from '../lib/cache';
import { houseByNo, publicHandle } from '../lib/houses';
import { allow } from '../lib/rateLimit';
import { sessionHouse } from '../lib/session';

const BOARD_KEY = 'board:v1';

export interface Person {
  houseNo: number;
  handle: string;
  cat: CatLook;
}
interface PersonRow {
  house_no: number;
  ig_handle: string;
  hide_handle: number;
  cat: string | null;
}
const person = (r: PersonRow): Person => ({ houseNo: r.house_no, handle: publicHandle(r), cat: houseCat(r.ig_handle, r.cat) });

async function writeGate(request: Request, env: Env) {
  if (!(await allow(env.RL_WRITE, `write:${clientIp(request)}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주한 고양이만 할 수 있어요');
  return mine;
}

// ── 마을 게시판 ──

/** GET /api/board : 최근 글 (60초 캐시) */
export function getBoard(env: Env, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(BOARD_KEY, ctx, async () => {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.text, p.created_at, h.house_no, h.ig_handle, h.hide_handle, h.cat
       FROM board_posts p JOIN houses h ON h.id = p.house_id ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
    )
      .bind(BOARD_SHOW)
      .all<PersonRow & { id: number; text: string; created_at: number }>();
    return { posts: results.map((r) => ({ id: r.id, text: r.text, at: r.created_at, ...person(r) })) };
  });
}

/** POST /api/board {text} */
export async function postBoard(request: Request, env: Env): Promise<Response> {
  const mine = await writeGate(request, env);
  if (mine instanceof Response) return mine;
  const body = await readJson<{ text?: unknown }>(request, 2048);
  const text = typeof body?.text === 'string' ? cleanChat(body.text, BOARD_MAX) : '';
  if (!text) return error(400, 'bad_text', '쓸 수 없는 글이에요');
  const day = utcDay();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE house_id = ? AND day = ?').bind(mine.house.id, day).first<{ n: number }>();
  if ((n?.n ?? 0) >= BOARD_PER_DAY) return error(400, 'limit', `게시판에는 하루 ${BOARD_PER_DAY}번까지 쓸 수 있어요`);
  await env.DB.prepare('INSERT INTO board_posts (house_id, text, day) VALUES (?, ?, ?)').bind(mine.house.id, text, day).run();
  invalidate(BOARD_KEY);
  return json({ ok: true });
}

/** DELETE /api/board/:id : 내 글만 */
export async function deleteBoard(id: number, request: Request, env: Env): Promise<Response> {
  const mine = await writeGate(request, env);
  if (mine instanceof Response) return mine;
  const r = await env.DB.prepare('DELETE FROM board_posts WHERE id = ? AND house_id = ?').bind(id, mine.house.id).run();
  if (!r.meta.changes) return error(404, 'no_post', '지울 수 없는 글이에요');
  invalidate(BOARD_KEY);
  return json({ ok: true });
}

// ── 친구 ──

type FriendState = 'self' | 'none' | 'friends' | 'sent' | 'received';

async function pairOf(db: D1Database, me: number, other: number) {
  return db
    .prepare('SELECT a, b, status FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)')
    .bind(me, other, other, me)
    .first<{ a: number; b: number; status: number }>();
}
const stateOf = (me: number, row: { a: number; status: number } | null): FriendState =>
  !row ? 'none' : row.status === 1 ? 'friends' : row.a === me ? 'sent' : 'received';

/** GET /api/friends : 내 친구, 받은 신청, 보낸 신청 */
export async function getFriends(request: Request, env: Env): Promise<Response> {
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주하면 친구를 사귈 수 있어요');
  const id = mine.house.id;
  const { results } = await env.DB.prepare(
    `SELECT f.a, f.b, f.status, h.house_no, h.ig_handle, h.hide_handle, h.cat FROM friends f
     JOIN houses h ON h.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
     WHERE f.a = ? OR f.b = ? ORDER BY f.created_at DESC LIMIT 300`,
  )
    .bind(id, id, id)
    .all<PersonRow & { a: number; b: number; status: number }>();
  const friends: Person[] = [];
  const incoming: Person[] = [];
  const outgoing: Person[] = [];
  for (const r of results) (r.status === 1 ? friends : r.a === id ? outgoing : incoming).push(person(r));
  return json({ friends, incoming, outgoing });
}

/** POST /api/friends/:houseNo {action: 'request' | 'accept' | 'decline' | 'remove'} */
export async function friendAction(houseNo: number, request: Request, env: Env): Promise<Response> {
  const mine = await writeGate(request, env);
  if (mine instanceof Response) return mine;
  const body = await readJson<{ action?: unknown }>(request, 512);
  const action = body?.action;
  const other = await houseByNo(env.DB, houseNo);
  if (!other) return error(404, 'no_house', '빈 집이에요');
  const me = mine.house.id;
  if (other.id === me) return error(400, 'self', '나와는 이미 친구예요');
  const row = await pairOf(env.DB, me, other.id);
  const st = stateOf(me, row);
  const db = env.DB;
  const del = () => db.prepare('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').bind(me, other.id, other.id, me).run();
  if (action === 'request') {
    if (st === 'friends') return json({ ok: true, state: 'friends' });
    if (st === 'sent') return json({ ok: true, state: 'sent' });
    if (st === 'received') {
      await db.prepare('UPDATE friends SET status = 1 WHERE a = ? AND b = ?').bind(other.id, me).run();
      return json({ ok: true, state: 'friends' });
    }
    const cnt = await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE a = ? OR b = ?').bind(me, me).first<{ n: number }>();
    if ((cnt?.n ?? 0) >= FRIEND_MAX * 2) return error(400, 'limit', `친구와 신청은 합쳐서 ${FRIEND_MAX * 2}명까지예요`);
    await db.prepare('INSERT OR IGNORE INTO friends (a, b, status) VALUES (?, ?, 0)').bind(me, other.id).run();
    return json({ ok: true, state: 'sent' });
  }
  if (action === 'accept') {
    if (st !== 'received') return error(400, 'no_request', '받은 친구 신청이 없어요');
    await db.prepare('UPDATE friends SET status = 1 WHERE a = ? AND b = ?').bind(other.id, me).run();
    return json({ ok: true, state: 'friends' });
  }
  if (action === 'decline' || action === 'remove') {
    if (st !== 'none') await del();
    return json({ ok: true, state: 'none' });
  }
  return error(400, 'bad_action', '알 수 없는 요청이에요');
}

// ── 집 프로필: 방명록 + 친구 상태 ──

/** GET /api/house/:no/social : 방명록, 나와의 친구 상태, 친구 수 */
export async function houseSocial(houseNo: number, request: Request, env: Env): Promise<Response> {
  const house = await houseByNo(env.DB, houseNo);
  if (!house) return error(404, 'no_house', '빈 집이에요');
  const mine = await sessionHouse(env.DB, request);
  const [gb, cnt, dec] = await env.DB.batch([
    env.DB.prepare(
      `SELECT g.id, g.text, g.created_at, h.house_no, h.ig_handle, h.hide_handle, h.cat FROM guestbook g
       JOIN houses h ON h.id = g.author_id WHERE g.house_id = ? ORDER BY g.created_at DESC, g.id DESC LIMIT ?`,
    ).bind(house.id, GUESTBOOK_SHOW),
    env.DB.prepare('SELECT COUNT(*) AS n FROM friends WHERE (a = ? OR b = ?) AND status = 1').bind(house.id, house.id),
    env.DB.prepare('SELECT yard, room, wallpaper, floor, roof_art FROM house_decor WHERE house_id = ?').bind(house.id),
  ]);
  // 꾸미기 점수 (2026-11-18): 프로필에서만 보인다
  const score = decorScore(toDecor(houseNo, (dec.results[0] as DecorRow | undefined) ?? null));
  let state: FriendState = 'none';
  if (mine) state = mine.house.id === house.id ? 'self' : stateOf(mine.house.id, await pairOf(env.DB, mine.house.id, house.id));
  const guestbook = (gb.results as Array<PersonRow & { id: number; text: string; created_at: number }>).map((r) => ({
    id: r.id,
    text: r.text,
    at: r.created_at,
    ...person(r),
  }));
  return json({ guestbook, friendState: state, friendCount: (cnt.results[0] as { n: number } | undefined)?.n ?? 0, decorScore: score });
}

/** POST /api/house/:no/guestbook {text} : 입주한 누구나 (2026-11-19: 친구가 아니어도) */
export async function postGuestbook(houseNo: number, request: Request, env: Env): Promise<Response> {
  const mine = await writeGate(request, env);
  if (mine instanceof Response) return mine;
  const house = await houseByNo(env.DB, houseNo);
  if (!house) return error(404, 'no_house', '빈 집이에요');
  const body = await readJson<{ text?: unknown }>(request, 2048);
  const text = typeof body?.text === 'string' ? cleanChat(body.text, GUESTBOOK_MAX) : '';
  if (!text) return error(400, 'bad_text', '쓸 수 없는 글이에요');
  const since = Math.floor(Date.now() / 1000) - 86400;
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM guestbook WHERE author_id = ? AND house_id = ? AND created_at > ?').bind(mine.house.id, house.id, since).first<{ n: number }>();
  if ((n?.n ?? 0) >= 3) return error(400, 'limit', '한 집에는 하루 3번까지 쓸 수 있어요');
  await env.DB.prepare('INSERT INTO guestbook (house_id, author_id, text) VALUES (?, ?, ?)').bind(house.id, mine.house.id, text).run();
  return json({ ok: true });
}

/** DELETE /api/guestbook/:id : 쓴 사람이나 집 주인 */
export async function deleteGuestbook(id: number, request: Request, env: Env): Promise<Response> {
  const mine = await writeGate(request, env);
  if (mine instanceof Response) return mine;
  const r = await env.DB.prepare('DELETE FROM guestbook WHERE id = ? AND (author_id = ? OR house_id = ?)').bind(id, mine.house.id, mine.house.id).run();
  if (!r.meta.changes) return error(404, 'no_post', '지울 수 없는 글이에요');
  return json({ ok: true });
}

/**
 * GET /api/me/guestbook?after=ID : 내 집 방명록에 다른 사람이 남긴 새 글 (2026-11-19 알림창).
 * 어디까지 봤는지는 화면이 이 브라우저에 기억한다 (DB 쓰기 없음). after 가 없으면 최근 14일 글 중 마지막 5개.
 */
export async function myGuestbookNew(request: Request, env: Env): Promise<Response> {
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return json({ posts: [], latest: 0 });
  const after = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get('after')) || 0));
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.text, g.created_at, h.house_no, h.ig_handle, h.hide_handle, h.cat FROM guestbook g
     JOIN houses h ON h.id = g.author_id
     WHERE g.house_id = ? AND g.author_id != ? AND g.id > ? AND g.created_at > ?
     ORDER BY g.id DESC LIMIT 5`,
  )
    .bind(mine.house.id, mine.house.id, after, since)
    .all<PersonRow & { id: number; text: string; created_at: number }>();
  const posts = results.map((r) => ({ id: r.id, text: r.text, at: r.created_at, ...person(r) }));
  return json({ posts, latest: posts[0]?.id ?? after });
}

/** 받은 친구 신청 수 (/api/me 에 붙인다) */
export async function incomingCount(db: D1Database, houseId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE b = ? AND status = 0').bind(houseId).first<{ n: number }>();
  return r?.n ?? 0;
}
