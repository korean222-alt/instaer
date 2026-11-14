// 서버 호출은 전부 여기서 한다. 씬은 서버를 모른다.
import type { House, RegionId, YardItem } from '../../shared/types';

export interface Health {
  ok: boolean;
  db: 'ok' | 'no_schema' | 'error' | 'offline';
  houses?: number;
  message?: string;
}

export interface Village {
  houses: House[];
  yards: Record<number, YardItem[]>;
  total: number;
  unlockedZones: number;
  todayTop: { houseNo: number; likesToday: number } | null;
  updatedAt: number;
}

export interface RegionStat {
  id: RegionId;
  total: number;
  week: number;
  rankTotal: number;
  rankWeek: number;
}

export interface Regions {
  regions: RegionStat[];
  total: number;
  weekStart: number;
  updatedAt: number;
}

export interface MoveInResult {
  ok: true;
  house: House;
  hideHandle: boolean;
  founder: boolean;
  token: string;
  region: { id: RegionId; rank: number; total: number; toFirst: number };
}

/** 서버가 돌려준 실패 (화면에 message 를 그대로 보여 줘도 된다) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// 인스타 앱 안 브라우저가 쿠키를 지우는 경우를 대비한 예비 로그인 표시
const TOKEN_KEY = 'ci_token';
export function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 저장이 막힌 브라우저 */
  }
}
export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = loadToken();
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) throw new ApiError(res.status, 'offline', '서버에 연결할 수 없어요');
    const data = (await res.json()) as T & { ok?: boolean; code?: string; message?: string };
    if (!res.ok) {
      const { ok: _ok, code, message, ...extra } = data;
      throw new ApiError(res.status, code ?? 'error', message ?? '잠시 문제가 생겼어요', extra);
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'offline', '서버에 연결할 수 없어요');
  } finally {
    clearTimeout(timer);
  }
}

/** 서버와 DB 가 살아 있는지. 실패하면 단독 모드로 쓴다 */
export async function fetchHealth(): Promise<Health> {
  try {
    return await call<Health>('GET', '/api/health', undefined, 5000);
  } catch (e) {
    return { ok: false, db: 'offline', message: e instanceof Error ? e.message : String(e) };
  }
}

export const fetchVillage = () => call<Village>('GET', '/api/village');
export const fetchRegions = () => call<Regions>('GET', '/api/regions');
export const fetchMe = () => call<{ house: House | null; founder?: boolean; hideHandle?: boolean }>('GET', '/api/me');
export const moveIn = (handle: string, region: RegionId, hideHandle: boolean) =>
  call<MoveInResult>('POST', '/api/move-in', { handle, region, hideHandle });
export const setPrivacy = (hideHandle: boolean) => call<{ ok: true; hideHandle: boolean }>('PUT', '/api/me/privacy', { hideHandle });
export const saveYard = (houseNo: number, items: YardItem[], roofColor: string) =>
  call<{ ok: true; items: YardItem[]; roofColor: string }>('PUT', `/api/yard/${houseNo}`, { items, roofColor });
export const like = (houseNo: number) =>
  call<{ ok: boolean; likes: number; code?: string; message?: string }>('POST', `/api/like/${houseNo}`);
