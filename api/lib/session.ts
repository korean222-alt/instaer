// 로그인 표시. 입주하면 브라우저에 쿠키를 남겨서 다음부터 내 집이 자동으로 열린다.
// 인스타 앱 안 브라우저가 쿠키를 지우는 경우가 있어서, 같은 토큰을 화면 쪽 localStorage 에도 두고
// 쿠키가 없을 때 Authorization 헤더로 보낼 수 있게 한다.
import { sha256, utcDay } from '../http';
import { HOUSE_COLS, type HouseRow } from './houses';

export const COOKIE = 'ci_s';
const MAX_AGE = 60 * 60 * 24 * 365;

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function readToken(request: Request): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,64})`));
  if (m) return m[1];
  const auth = request.headers.get('authorization') ?? '';
  const b = auth.match(/^Bearer\s+([A-Za-z0-9_-]{20,64})$/);
  return b ? b[1] : null;
}

export async function createSession(db: D1Database, houseId: number): Promise<string> {
  const token = newToken();
  await db.prepare('INSERT INTO sessions (token_hash, house_id, seen_day) VALUES (?, ?, ?)').bind(await sha256(token), houseId, utcDay()).run();
  return token;
}

/** 요청(쿠키 또는 헤더) → 내 집. 없거나 틀리면 null */
export async function sessionHouse(db: D1Database, request: Request): Promise<{ house: HouseRow; token: string } | null> {
  const token = readToken(request);
  if (!token) return null;
  return houseByToken(db, token);
}

/** 토큰 → 내 집 */
export async function houseByToken(db: D1Database, token: string): Promise<{ house: HouseRow; token: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const hash = await sha256(token);
  const house = await db
    .prepare(`SELECT ${HOUSE_COLS.split(', ').map((c) => `h.${c}`).join(', ')}, s.seen_day AS seen_day
              FROM sessions s JOIN houses h ON h.id = s.house_id WHERE s.token_hash = ?`)
    .bind(hash)
    .first<HouseRow & { seen_day: string | null }>();
  if (!house) return null;
  // 마지막 접속일은 하루에 한 번만 쓴다 (쓰기 한도 아끼기)
  const today = utcDay();
  if (house.seen_day !== today) await db.prepare('UPDATE sessions SET seen_day = ? WHERE token_hash = ?').bind(today, hash).run();
  return { house, token };
}

export const isSecure = (request: Request) => new URL(request.url).protocol === 'https:';
