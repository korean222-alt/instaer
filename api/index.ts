// 고양이섬 Worker 입구.
// /api/* 만 여기로 들어오고(wrangler.jsonc 의 run_worker_first), 나머지는 dist 정적 파일이 바로 나간다.
import type { Env } from './env';
import { error } from './http';
import { health } from './routes/health';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (path.startsWith('/api')) {
      if (path === '/api/health' && request.method === 'GET') return health(env);
      // 단계 A 에서 추가: /api/village, /api/move-in, /api/yard/:houseNo, /api/like/:houseNo, /api/regions
      return error(404, 'not_found', '없는 API 예요');
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
