/** JSON 응답. 기본은 캐시하지 않는다 (목록/순위 API 는 각자 캐시 헤더를 준다) */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, code: string, message: string): Response {
  return json({ ok: false, code, message }, { status });
}
