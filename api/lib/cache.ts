// 목록/순위처럼 모두에게 같은 응답을 짧게 캐시한다.
// 1) Worker 메모리(같은 인스턴스 안에서 60초). workers.dev 에서도 동작한다.
// 2) Cache API (데이터센터 단위). 내 도메인을 연결했을 때만 효과가 있고 workers.dev 에서는 아무 일도 안 한다.
// 쓰기(입주, 꾸미기, 예뻐요)가 있으면 그 인스턴스의 메모리 캐시는 바로 비운다. 다른 인스턴스는 최대 60초 늦게 바뀐다.

const TTL_MS = 60_000;
const mem = new Map<string, { at: number; body: string }>();

export function invalidate(...keys: string[]): void {
  for (const k of keys) mem.delete(k);
}

export async function cachedJson(
  key: string,
  ctx: ExecutionContext,
  build: () => Promise<unknown>,
): Promise<Response> {
  const now = Date.now();
  const hit = mem.get(key);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=30',
  };
  if (hit && now - hit.at < TTL_MS) return new Response(hit.body, { headers: { ...headers, 'x-cache': 'mem' } });

  const cacheReq = new Request(`https://cache.cat-island.internal/${key}`);
  const edge = typeof caches !== 'undefined' ? caches.default : null;
  if (edge) {
    const res = await edge.match(cacheReq).catch(() => undefined);
    if (res) {
      const body = await res.text();
      mem.set(key, { at: now, body });
      return new Response(body, { headers: { ...headers, 'x-cache': 'edge' } });
    }
  }

  const body = JSON.stringify(await build());
  mem.set(key, { at: now, body });
  if (edge) {
    const stored = new Response(body, { headers: { ...headers, 'cache-control': 'public, s-maxage=60' } });
    ctx.waitUntil(edge.put(cacheReq, stored).catch(() => undefined));
  }
  return new Response(body, { headers: { ...headers, 'x-cache': 'miss' } });
}
