/** JSON 응답. 기본은 캐시하지 않는다 (목록/순위 API 는 각자 캐시 헤더를 준다) */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, code, message, ...extra }, { status });
}

/** 요청 본문 JSON. 너무 크거나 깨졌으면 null */
export async function readJson<T>(request: Request, maxBytes = 16_384): Promise<T | null> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 오늘 날짜 (UTC, 'YYYY-MM-DD'). D1 무료 한도도 UTC 자정에 초기화된다 */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** 이번 주 시작 (한국 시간 월요일 0시)의 unix 초 */
export function weekStartKst(now = Date.now()): number {
  const KST = 9 * 3600_000;
  const local = new Date(now + KST);
  const dow = (local.getUTCDay() + 6) % 7; // 월=0
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow) - KST;
  return Math.floor(start / 1000);
}
