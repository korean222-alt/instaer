// 인스타 인증 (2026-11-17): 운영 설정, 내 게시물 댓글 읽기, 되찾기 확인.
// 사업자 등록이 없어서 Meta 앱은 "개발 모드" 그대로 쓴다. 개발 모드에서도 앱 관리자 본인 계정의
// 게시물 댓글은 읽을 수 있다 (Instagram API with Instagram Login, instagram_business_manage_comments).
// 토큰은 관리자 화면에서 넣으면 DB(app_settings.ig_token)에, 아니면 secret IG_TOKEN 을 쓴다.
import { flatCode, isAuthMode, RECLAIM_TTL_SEC, type AuthMode } from '../../src/shared/auth';
import type { Env } from '../env';
import { sha256 } from '../http';

const GRAPH = 'https://graph.instagram.com';
/** 손님이 기다리는 중에 댓글을 다시 읽을 수 있는 최소 간격 (모든 사람 공통) */
const SYNC_GAP_SEC = 20;
/** 최근 게시물 몇 개의 댓글을 읽을지 */
const MEDIA_LIMIT = 8;
const KEEP_COMMENTS_SEC = 7 * 24 * 3600;
/** 장기 토큰은 60일. 7일마다 새로 받는다 */
const REFRESH_EVERY_SEC = 7 * 24 * 3600;

const now = () => Math.floor(Date.now() / 1000);

export async function getSettings(db: D1Database, keys: string[]): Promise<Record<string, { value: string; at: number }>> {
  const { results } = await db
    .prepare(`SELECT key, value, updated_at FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys)
    .all<{ key: string; value: string; updated_at: number }>();
  return Object.fromEntries(results.map((r) => [r.key, { value: r.value, at: r.updated_at }]));
}

export const setSetting = (db: D1Database, key: string, value: string) =>
  db
    .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value);

export interface AuthConfig {
  mode: AuthMode;
  password: string;
}

/** 지금 입주 방식과 팔로워 암호. 설정이 없으면 예전 방식(off) */
export async function authConfig(env: Env): Promise<AuthConfig> {
  const s = await getSettings(env.DB, ['auth_mode', 'follower_pw']);
  const mode = s.auth_mode?.value;
  return { mode: isAuthMode(mode) ? mode : 'off', password: s.follower_pw?.value ?? '' };
}

/** 암호 비교: 띄어쓰기 무시, 대소문자 무시 */
export const samePassword = (a: string, b: string) => !!b && a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();

async function token(env: Env): Promise<string | null> {
  const s = await getSettings(env.DB, ['ig_token']);
  return s.ig_token?.value || env.IG_TOKEN || null;
}

interface Comment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
}

async function graph<T>(path: string, params: Record<string, string>, tk: string): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', tk);
  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || data.error) throw new Error(`instagram ${res.status}: ${data.error?.message ?? 'error'}`);
  return data;
}

export interface SyncResult {
  ran: boolean;
  added?: number;
  error?: string;
}

/**
 * 내 최근 게시물(릴스 포함)의 댓글을 읽어서 ig_comments 에 넣고, 기다리는 되찾기를 확인한다.
 * force 가 아니면 SYNC_GAP_SEC 안에 다시 부르면 건너뛴다 (여러 손님이 동시에 기다려도 API 를 한 번만 부른다).
 */
export async function syncComments(env: Env, force = false): Promise<SyncResult> {
  const tk = await token(env);
  if (!tk) return { ran: false, error: 'no_token' };
  if (!force) {
    // 먼저 시간을 찍고(조건부 UPDATE), 찍은 쪽만 읽으러 간다
    const r = await env.DB
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('ig_last_sync', '', unixepoch())
         ON CONFLICT (key) DO UPDATE SET updated_at = unixepoch() WHERE app_settings.updated_at <= unixepoch() - ?`,
      )
      .bind(SYNC_GAP_SEC)
      .run();
    if (!r.meta.changes) return { ran: false };
  } else {
    await setSetting(env.DB, 'ig_last_sync', '').run();
  }
  try {
    const media = await graph<{ data: Array<{ id: string }> }>('/me/media', { fields: 'id', limit: String(MEDIA_LIMIT) }, tk);
    const lists = await Promise.all(
      media.data.map((m) =>
        graph<{ data: Comment[] }>(`/${m.id}/comments`, { fields: 'id,text,username,timestamp', limit: '50' }, tk).then(
          (r) => r.data,
          () => [] as Comment[],
        ),
      ),
    );
    const comments = lists.flat().filter((c) => c.id && c.username);
    const stmts = comments.map((c) =>
      env.DB.prepare('INSERT OR IGNORE INTO ig_comments (id, username, text, at) VALUES (?, ?, ?, ?)').bind(
        c.id,
        c.username!.toLowerCase(),
        (c.text ?? '').slice(0, 300),
        c.timestamp ? Math.floor(Date.parse(c.timestamp) / 1000) || now() : now(),
      ),
    );
    let added = 0;
    for (let i = 0; i < stmts.length; i += 50) {
      const rs = await env.DB.batch(stmts.slice(i, i + 50));
      added += rs.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    }
    if (added) await checkReclaims(env.DB);
    await setSetting(env.DB, 'ig_sync_error', '').run();
    return { ran: true, added };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[insta] sync', msg);
    await setSetting(env.DB, 'ig_sync_error', msg.slice(0, 300)).run();
    return { ran: true, error: msg };
  }
}

/** 기다리는 되찾기 중 코드가 그 아이디의 댓글에 있으면 확인 표시 */
export async function checkReclaims(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT r.code, c.text FROM reclaims r JOIN ig_comments c ON c.username = r.ig_id AND c.at >= r.created_at - 60
       WHERE r.verified_at IS NULL AND r.created_at > unixepoch() - ?`,
    )
    .bind(RECLAIM_TTL_SEC)
    .all<{ code: string; text: string }>();
  const ok = [...new Set(results.filter((r) => flatCode(r.text).includes(r.code)).map((r) => r.code))];
  if (ok.length) await db.batch(ok.map((code) => db.prepare('UPDATE reclaims SET verified_at = unixepoch() WHERE code = ?').bind(code)));
}

/** 이 아이디가 최근 댓글을 달았는지 */
export async function hasRecentComment(db: D1Database, igId: string, windowSec: number): Promise<boolean> {
  const r = await db.prepare('SELECT 1 AS y FROM ig_comments WHERE username = ? AND at > unixepoch() - ? LIMIT 1').bind(igId, windowSec).first();
  return !!r;
}

/** 5분마다 (Cron): 댓글 읽기, 오래된 것 지우기, 토큰 새로 받기 */
export async function cron(env: Env): Promise<void> {
  const { mode } = await authConfig(env);
  if (mode === 'comment') await syncComments(env, true);
  await checkReclaims(env.DB);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ig_comments WHERE at < unixepoch() - ?').bind(KEEP_COMMENTS_SEC),
    env.DB.prepare('DELETE FROM reclaims WHERE created_at < unixepoch() - ?').bind(RECLAIM_TTL_SEC * 2),
  ]);
  const s = await getSettings(env.DB, ['ig_token', 'ig_token_refreshed']);
  const tk = s.ig_token?.value || env.IG_TOKEN;
  const last = s.ig_token_refreshed?.at ?? s.ig_token?.at ?? 0;
  if (tk && now() - last > REFRESH_EVERY_SEC) {
    try {
      const r = await graph<{ access_token: string }>('/refresh_access_token', { grant_type: 'ig_refresh_token' }, tk);
      if (r.access_token) await env.DB.batch([setSetting(env.DB, 'ig_token', r.access_token), setSetting(env.DB, 'ig_token_refreshed', '1')]);
    } catch (e) {
      console.error('[insta] refresh', e instanceof Error ? e.message : e);
      await setSetting(env.DB, 'ig_token_refreshed', 'fail').run();
    }
  }
}

export function newCode(len: number, chars: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

/** ip 는 그대로 두지 않고 해시 앞부분만 */
export const ipHash = async (ip: string) => (await sha256(`ci:${ip}`)).slice(0, 16);
