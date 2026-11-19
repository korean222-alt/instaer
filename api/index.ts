// 고양이섬 Worker 입구.
// /api/* 만 여기로 들어오고(wrangler.jsonc 의 run_worker_first), 나머지는 dist 정적 파일이 바로 나간다.
import type { Env } from './env';
import { error } from './http';
import { health, newcomer, series } from './routes/health';
import { like } from './routes/like';
import { me, moveHouse, moveIn, rename, setPrivacy } from './routes/moveIn';
import { regions } from './routes/regions';
import { village } from './routes/village';
import { realtimeConnect, realtimeUsage } from './routes/realtime';
import { deleteDrawing, getDecor, getDrawings, getWallet, myDrawings, postDrawing, putDecor } from './routes/decor';
import { adminAction, adminState, authInfo, getWishes, postWish, reclaimPoll, reclaimStart, report } from './routes/auth';
import { cron } from './lib/insta';
import { accept, arcade, buy, claim, fish, mine, openMail, sell, visit } from './routes/game';
import { deleteBoard, deleteGuestbook, friendAction, getBoard, getFriends, houseSocial, postBoard, postGuestbook } from './routes/social';

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
  if (method === 'GET' && path === '/api/newcomer') return newcomer(env);
  if (method === 'GET' && path === '/api/series') return series(env);
  if (method === 'GET' && path === '/api/village') return village(env, ctx);
  if (method === 'GET' && path === '/api/regions') return regions(env, ctx);
  if (method === 'GET' && path === '/api/me') return me(request, env);
  if (method === 'POST' && path === '/api/move-in') return moveIn(request, env);
  if (method === 'GET' && path === '/api/auth-info') return authInfo(env);
  if (method === 'POST' && path === '/api/reclaim') return reclaimStart(request, env);
  if (method === 'POST' && path === '/api/report') return report(request, env);
  if (method === 'GET' && path === '/api/wishes') return getWishes(env, ctx);
  if (method === 'POST' && path === '/api/wishes') return postWish(request, env);
  if (method === 'GET' && path === '/api/admin') return adminState(request, env);
  if (method === 'POST' && path === '/api/admin') return adminAction(request, env);
  {
    const rc = path.match(/^\/api\/reclaim\/([A-Z0-9]{4,10})$/);
    if (rc && method === 'GET') return reclaimPoll(rc[1], request, env);
  }
  if (method === 'PUT' && path === '/api/me/privacy') return setPrivacy(request, env);

  if (method === 'GET' && path === '/api/wallet') return getWallet(request, env);
  if (method === 'GET' && path === '/api/me/drawings') return myDrawings(request, env);
  if (method === 'GET' && path === '/api/drawings') return getDrawings(url, env);
  if (method === 'POST' && path === '/api/drawings') return postDrawing(request, env);
  if (method === 'POST' && path === '/api/shop/buy') return buy(request, env);
  if (method === 'POST' && path === '/api/mail/open') return openMail(request, env);
  if (method === 'POST' && path === '/api/quest/claim') return claim(request, env);
  if (method === 'POST' && path === '/api/quest/accept') return accept(request, env);
  if (method === 'POST' && path === '/api/shop/sell') return sell(request, env);
  if (method === 'POST' && path === '/api/game/mine') return mine(request, env);
  if (method === 'POST' && path === '/api/me/rename') return rename(request, env);
  if (method === 'POST' && path === '/api/me/move') return moveHouse(request, env);
  if (method === 'POST' && path === '/api/game/fish') return fish(request, env);
  if (method === 'POST' && path === '/api/game/arcade') return arcade(request, env);
  if (method === 'POST' && path === '/api/game/visit') return visit(request, env);

  if (method === 'GET' && path === '/api/board') return getBoard(env, ctx);
  if (method === 'POST' && path === '/api/board') return postBoard(request, env);
  if (method === 'GET' && path === '/api/friends') return getFriends(request, env);

  let m = path.match(/^\/api\/rt\/(zone|room)\/([A-Za-z0-9%-]{1,64})$/);
  if (m && method === 'GET') return realtimeConnect(m[1], m[2], request, env);
  m = path.match(/^\/api\/rt\/usage\/(zone|room)\/([a-z0-9-]{1,32})$/);
  if (m && method === 'GET') return realtimeUsage(m[1], m[2], env);

  m = path.match(/^\/api\/house\/(\d+)$/);
  if (m) {
    const no = houseNoOf(m[1]);
    if (!no) return error(400, 'bad_house', '번지가 이상해요');
    if (method === 'GET') return getDecor(no, env);
    if (method === 'PUT') return putDecor(no, request, env);
  }
  m = path.match(/^\/api\/house\/(\d+)\/(social|guestbook)$/);
  if (m) {
    const no = houseNoOf(m[1]);
    if (!no) return error(400, 'bad_house', '번지가 이상해요');
    if (m[2] === 'social' && method === 'GET') return houseSocial(no, request, env);
    if (m[2] === 'guestbook' && method === 'POST') return postGuestbook(no, request, env);
  }
  m = path.match(/^\/api\/friends\/(\d+)$/);
  if (m && method === 'POST') {
    const no = houseNoOf(m[1]);
    if (!no) return error(400, 'bad_house', '번지가 이상해요');
    return friendAction(no, request, env);
  }
  m = path.match(/^\/api\/(board|guestbook)\/(\d{1,12})$/);
  if (m && method === 'DELETE') return m[1] === 'board' ? deleteBoard(Number(m[2]), request, env) : deleteGuestbook(Number(m[2]), request, env);
  m = path.match(/^\/api\/drawings\/([A-Za-z0-9_-]{1,24})$/);
  if (m && method === 'DELETE') return deleteDrawing(m[1], request, env);
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
  // 5분마다 (wrangler.jsonc triggers): 인스타 댓글 읽기, 토큰 갱신
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cron(env).catch((e) => console.error('[cron]', e instanceof Error ? e.message : e)));
  },
} satisfies ExportedHandler<Env>;
