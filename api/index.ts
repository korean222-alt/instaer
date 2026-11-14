// 고양이섬 Worker 입구.
// /api/* 만 여기로 들어오고(wrangler.jsonc 의 run_worker_first), 나머지는 dist 정적 파일이 바로 나간다.
import type { Env } from './env';
import { error } from './http';
import { health } from './routes/health';
import { like } from './routes/like';
import { me, moveIn, setPrivacy } from './routes/moveIn';
import { regions } from './routes/regions';
import { village } from './routes/village';
import { realtimeConnect, realtimeUsage } from './routes/realtime';
import { getYard, putYard } from './routes/yard';

export { RealtimeRoom } from './realtime/RealtimeRoom';

const houseNoOf = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : null;
};

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // 쓰기 요청은 같은 사이트에서 온 것만 받는다 (다른 사이트가 몰래 보내는 요청 막기)
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return error(403, 'bad_origin', '허용되지 않은 요청이에요');
  }

  if (method === 'GET' && path === '/api/health') return health(env);
  if (method === 'GET' && path === '/api/village') return village(env, ctx);
  if (method === 'GET' && path === '/api/regions') return regions(env, ctx);
  if (method === 'GET' && path === '/api/me') return me(request, env);
  if (method === 'POST' && path === '/api/move-in') return moveIn(request, env);
  if (method === 'PUT' && path === '/api/me/privacy') return setPrivacy(request, env);

  let m = path.match(/^\/api\/rt\/(zone|room)\/([A-Za-z0-9%-]{1,64})$/);
  if (m && method === 'GET') return realtimeConnect(m[1], m[2], request, env);
  m = path.match(/^\/api\/rt\/usage\/(zone|room)\/([a-z0-9-]{1,32})$/);
  if (m && method === 'GET') return realtimeUsage(m[1], m[2], env);

  m = path.match(/^\/api\/yard\/(\d+)$/);
  if (m) {
    const no = houseNoOf(m[1]);
    if (!no) return error(400, 'bad_house', '번지가 이상해요');
    if (method === 'GET') return getYard(no, env);
    if (method === 'PUT') return putYard(no, request, env);
  }
  m = path.match(/^\/api\/like\/(\d+)$/);
  if (m && method === 'POST') {
    const no = houseNoOf(m[1]);
    if (!no) return error(400, 'bad_house', '번지가 이상해요');
    return like(no, request, env);
  }
  if (path.startsWith('/api')) return error(404, 'not_found', '없는 API 예요');
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[api]', request.method, new URL(request.url).pathname, message);
      // D1 무료 한도를 넘으면 그날(UTC 자정까지) 쿼리가 실패한다
      if (/exceeded.*(limit|free tier)/i.test(message)) return error(503, 'quota', '오늘은 사람이 너무 많아요. 내일 다시 만나요');
      return error(500, 'server_error', '잠시 문제가 생겼어요');
    }
  },
} satisfies ExportedHandler<Env>;
