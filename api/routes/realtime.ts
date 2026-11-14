import { catLook } from '../../src/shared/catLook';
import { isBlockedText } from '../../src/shared/handle';
import { gameRoomName, ROOM_ID_RE, RT_PROTOCOL, zoneRoomName } from '../../src/shared/realtime';
import type { Env } from '../env';
import { clientIp, error } from '../http';
import { allow } from '../lib/rateLimit';
import { houseByToken, readToken } from '../lib/session';
import type { RtUser } from '../realtime/RealtimeRoom';

function roomName(kind: string, id: string): string | null {
  if (kind === 'zone') {
    const n = Number(id);
    return Number.isInteger(n) && n >= 0 && n < 10_000 ? zoneRoomName(n) : null;
  }
  if (kind === 'room') return ROOM_ID_RE.test(id) ? gameRoomName(id) : null;
  return null;
}

/** GET /api/rt/zone/:n, /api/rt/room/:id (WebSocket) : 입주한 유저만 접속할 수 있다 */
export async function realtimeConnect(kind: string, id: string, request: Request, env: Env): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return error(426, 'websocket_only', 'WebSocket 으로 접속해 주세요');
  // 다른 사이트에서 몰래 여는 접속은 막는다
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return error(403, 'bad_origin', '허용되지 않은 접속이에요');
  const protocols = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  if (!protocols.includes(RT_PROTOCOL)) return error(400, 'bad_protocol', '버전이 맞지 않아요');
  const name = roomName(kind, decodeURIComponent(id));
  if (!name) return error(400, 'bad_room', '없는 방이에요');

  let user: RtUser | null = null;
  const lt = env.LOADTEST_KEY ? protocols.includes(`lt.${env.LOADTEST_KEY}`) : false;
  if (lt) {
    // 부하 시험용 가짜 유저 (LOADTEST_KEY 는 로컬 .dev.vars 에만 둔다)
    const u = new URL(request.url).searchParams.get('u') ?? crypto.randomUUID().slice(0, 6);
    const look = catLook(`bot_${u}`);
    user = { uid: `lt:${u}`, h: `bot_${u}`, n: null, c: [look.fur, look.pattern, look.eyeColor] };
  } else {
    if (!(await allow(env.RL_CONNECT, `rt:${clientIp(request)}`, 20))) return error(429, 'rate_limited', '잠시 후에 다시 접속해 주세요');
    const token = readToken(request) ?? protocols.find((p) => p.startsWith('tok.'))?.slice(4) ?? null;
    const mine = token ? await houseByToken(env.DB, token) : null;
    if (!mine) return error(401, 'no_session', '입주한 사람만 함께 걸을 수 있어요');
    const h = mine.house.ig_handle;
    if (isBlockedText(h)) return error(403, 'blocked', '이 아이디로는 함께 걸을 수 없어요');
    const look = catLook(h);
    user = { uid: `h:${mine.house.id}`, h, n: mine.house.house_no, c: [look.fur, look.pattern, look.eyeColor] };
  }

  const headers = new Headers(request.headers);
  headers.set('x-ci-user', JSON.stringify(user));
  headers.set('x-ci-room', name);
  const stub = env.REALTIME.get(env.REALTIME.idFromName(name));
  try {
    return await stub.fetch(new Request(request.url, { method: 'GET', headers }));
  } catch (e) {
    console.error('[rt]', name, e instanceof Error ? e.message : e);
    // 무료 한도를 넘었거나 객체가 바쁘면 실패한다. 화면은 단독 모드로 넘어간다
    return error(503, 'realtime_unavailable', '지금은 함께 걷기를 쓸 수 없어요');
  }
}

/** GET /api/rt/usage/:kind/:id : 그 방의 오늘 사용량 (확인용) */
export async function realtimeUsage(kind: string, id: string, env: Env): Promise<Response> {
  const name = roomName(kind, id);
  if (!name) return error(400, 'bad_room', '없는 방이에요');
  const stub = env.REALTIME.get(env.REALTIME.idFromName(name));
  return stub.fetch('https://rt/usage', { headers: { 'x-ci-usage': '1' } });
}
