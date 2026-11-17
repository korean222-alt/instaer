import type { Env } from '../env';
import { clientIp, error, json, sha256, utcDay } from '../http';
import { invalidate } from '../lib/cache';
import { houseByNo, markZoneDirty } from '../lib/houses';
import { allow } from '../lib/rateLimit';
import { readToken } from '../lib/session';
import { bumpDaily } from '../lib/wallet';
import { VILLAGE_KEY } from './village';

const VOTER_COOKIE = 'ci_v';
/** 같은 IP 에서 한 집에 하루 몇 번까지 (통신사 공유 IP 때문에 1번으로 막지 않는다) */
const PER_IP_PER_HOUSE = 5;

function voterId(request: Request): string | null {
  const m = (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)ci_v=([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : null;
}

/** POST /api/like/:houseNo : 같은 브라우저는 한 집에 하루 1번 */
export async function like(houseNo: number, request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  if (!(await allow(env.RL_WRITE, `write:${ip}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 눌러 주세요');

  const house = await houseByNo(env.DB, houseNo);
  if (!house) return error(404, 'no_house', '빈 집이에요');

  // 브라우저 구분: 로그인 표시가 있으면 그것, 없으면 예뻐요용 쿠키를 새로 만든다
  const token = readToken(request);
  let voter = token ? `s:${await sha256(token)}` : null;
  let newVoter: string | null = null;
  if (!voter) {
    const v = voterId(request) ?? (newVoter = crypto.randomUUID().replace(/-/g, ''));
    voter = `c:${v}`;
  }
  /** 누른 사람의 집 (입주했으면). 오늘의 퀘스트 "예뻐요 2번" 에 센다 */
  let voterHouse: number | null = null;
  if (token) {
    const s = await env.DB.prepare('SELECT house_id FROM sessions WHERE token_hash = ?').bind(voter.slice(2)).first<{ house_id: number }>();
    if (s?.house_id === house.id) return error(400, 'own_house', '내 집에는 예뻐요를 누를 수 없어요');
    voterHouse = s?.house_id ?? null;
  }

  const day = utcDay();
  const ipHash = (await sha256(`ip:${ip}`)).slice(0, 24);
  const [already, ipCount] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('SELECT COUNT(*) AS n FROM likes_log WHERE house_id = ? AND voter_key = ? AND day = ?').bind(house.id, voter, day),
    env.DB.prepare('SELECT COUNT(*) AS n FROM likes_log WHERE house_id = ? AND day = ? AND ip_hash = ?').bind(house.id, day, ipHash),
  ]);
  const headers: HeadersInit = newVoter
    ? { 'set-cookie': `${VOTER_COOKIE}=${newVoter}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` }
    : {};
  if ((already.results[0]?.n ?? 0) > 0) return json({ ok: false, code: 'already', message: '오늘은 이미 눌렀어요', likes: house.likes }, { status: 200, headers });
  if ((ipCount.results[0]?.n ?? 0) >= PER_IP_PER_HOUSE) return json({ ok: false, code: 'ip_limit', message: '오늘은 더 누를 수 없어요', likes: house.likes }, { status: 200, headers });

  const [, updated] = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO likes_log (house_id, voter_key, day, ip_hash) VALUES (?, ?, ?, ?)').bind(house.id, voter, day, ipHash),
    env.DB.prepare(
      `UPDATE houses SET likes = likes + 1,
         likes_today = CASE WHEN likes_day = ? THEN likes_today + 1 ELSE 1 END, likes_day = ?
       WHERE id = ? RETURNING likes`,
    ).bind(day, day, house.id),
    markZoneDirty(env.DB, houseNo, 1),
  ]);
  invalidate(VILLAGE_KEY);
  if (voterHouse !== null) await bumpDaily(env.DB, voterHouse, (w) => void (w.daily.like += 1));
  const likes = (updated.results[0] as { likes: number } | undefined)?.likes ?? house.likes + 1;
  return json({ ok: true, likes }, { headers });
}
