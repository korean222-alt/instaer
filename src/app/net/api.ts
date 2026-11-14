// 서버 호출은 전부 여기서 한다. 씬은 서버를 모른다.

export interface Health {
  ok: boolean;
  db: 'ok' | 'no_schema' | 'error' | 'offline';
  houses?: number;
  message?: string;
}

async function getJson<T>(path: string, timeoutMs = 5000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 서버와 DB 가 살아 있는지. 실패하면 단독 모드로 쓴다 */
export async function fetchHealth(): Promise<Health> {
  try {
    return await getJson<Health>('/api/health');
  } catch (e) {
    return { ok: false, db: 'offline', message: e instanceof Error ? e.message : String(e) };
  }
}
