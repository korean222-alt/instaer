// 서버 호출은 전부 여기서 한다. 씬은 서버를 모른다.
import type { AuthMode, ReportKind } from '../../shared/auth';
import type { WalletData } from '../../shared/economy';
import type { CatLook, Drawing, House, HouseDecor, PlacedItem, RegionId } from '../../shared/types';

export interface Health {
  ok: boolean;
  db: 'ok' | 'no_schema' | 'error' | 'offline';
  houses?: number;
  message?: string;
}

export interface Village {
  houses: House[];
  /** 번지 → 마당 자유 배치 아이템 */
  yards: Record<number, PlacedItem[]>;
  /** 번지 → 지붕 그림 id */
  roofArt: Record<number, string>;
  roofArtBack?: Record<number, string>;
  /** 마당을 넓힌 집 번지 (2026-11-16) */
  bigYards?: number[];
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

function call<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  return callWith<T>(method, path, body, {}, timeoutMs);
}

async function callWith<T>(method: string, path: string, body: unknown, extraHeaders: Record<string, string>, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers: Record<string, string> = { accept: 'application/json', ...extraHeaders };
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
export const fetchMe = () => call<{ house: House | null; founder?: boolean; hideHandle?: boolean; friendRequests?: number }>('GET', '/api/me');
/** cat: 고른 고양이 (CAT_CHOICES / EYE_CHOICES 안의 값). houseNo: 고른 빈 집 (null 이면 빈 집 중 앞 번호) */
export const moveIn = (
  handle: string,
  region: RegionId,
  hideHandle: boolean,
  cat: CatLook,
  houseNo: number | null = null,
  auth: { igId: string; password: string } | null = null,
) => call<MoveInResult>('POST', '/api/move-in', { handle, region, hideHandle, cat, houseNo, ...(auth ?? {}), device: deviceId() }, 15000);

/** 이 폰의 표시 (기기 하나에 집 하나). 저장이 막힌 브라우저면 보내지 않는다 */
export function deviceId(): string | undefined {
  try {
    let d = localStorage.getItem('ci_dev');
    if (!d) {
      d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('ci_dev', d);
    }
    return d;
  } catch {
    return undefined;
  }
}

// ── 인스타 인증, 되찾기, 신고, 소원 (2026-11-17) ──
export const fetchAuthInfo = () => call<{ mode: AuthMode; followHandle: string }>('GET', '/api/auth-info');
export const reclaimStart = (igId: string) => call<{ ok: true; code: string; igId: string; houseNo: number; expiresIn: number }>('POST', '/api/reclaim', { igId });
export const reclaimPoll = (code: string) =>
  call<{ ok: true; pending: boolean; token?: string; house?: House; hideHandle?: boolean }>('GET', `/api/reclaim/${encodeURIComponent(code)}`, undefined, 15000);
export const sendReport = (r: { kind: ReportKind; houseNo?: number | null; igId?: string; contact?: string; text: string }) =>
  call<{ ok: true }>('POST', '/api/report', r);
export interface Wish {
  id: number;
  text: string;
  at: number;
  houseNo: number | null;
  handle: string | null;
}
export const fetchWishes = () => call<{ wishes: Wish[] }>('GET', '/api/wishes');
export const postWish = (text: string) => call<{ ok: true }>('POST', '/api/wishes', { text });
export const adminCall = <T>(key: string, body?: Record<string, unknown>) => callWith<T>(body ? 'POST' : 'GET', '/api/admin', body, { 'x-admin-key': key });
export const setPrivacy = (hideHandle: boolean) => call<{ ok: true; hideHandle: boolean }>('PUT', '/api/me/privacy', { hideHandle });

/** 지갑 (츄르, 가진 아이템, 퀘스트 진행) */
export interface WalletView {
  coins: number;
  data: WalletData;
  /** 오늘 주민들이 주는 부탁 id (주민마다 하나) */
  daily: string[];
}
type WithWallet<T> = T & { ok: true; wallet: WalletView };

export const fetchDecor = (houseNo: number) => call<HouseDecor & { roofColor: string }>('GET', `/api/house/${houseNo}`);
export type DecorPatch = Partial<Pick<HouseDecor, 'yard' | 'room' | 'wallpaper' | 'floor' | 'roofArt' | 'roofArtBack'>> & { roofColor?: string };
export const saveDecor = (houseNo: number, patch: DecorPatch) =>
  call<WithWallet<{ decor: HouseDecor; roofColor: string }>>('PUT', `/api/house/${houseNo}`, patch);

export const fetchMyDrawings = () => call<{ drawings: Drawing[] }>('GET', '/api/me/drawings');
export const fetchDrawings = (ids: string[]) => call<{ drawings: Drawing[] }>('GET', `/api/drawings?ids=${ids.map(encodeURIComponent).join(',')}`);
export const saveDrawing = (pixels: string, palette: string[]) => call<{ ok: true; drawing: Drawing }>('POST', '/api/drawings', { pixels, palette });
export const deleteDrawing = (id: string) => call<{ ok: true }>('DELETE', `/api/drawings/${encodeURIComponent(id)}`);

export const fetchWallet = () => call<{ wallet: WalletView }>('GET', '/api/wallet');
export const buyItem = (type: string) => call<WithWallet<{ bought: string }>>('POST', '/api/shop/buy', { type });
/** 우편함 편지 읽기 (든 츄르를 받는다) */
export const openMail = (id: string) => call<WithWallet<{ coins: number; item?: string | null }>>('POST', '/api/mail/open', { id });
export const claimQuest = (id: string) => call<WithWallet<{ coins: number; item?: string }>>('POST', '/api/quest/claim', { id });
export const acceptQuest = (id: string) => call<WithWallet<{ accepted: string }>>('POST', '/api/quest/accept', { id });
export const reportFish = (catches: Array<{ id: string; cm: number }>) =>
  call<WithWallet<{ counted: number; coins: number; full?: boolean }>>('POST', '/api/game/fish', { catches });
export const reportMine = (ores: Array<{ id: string; level: number }>) =>
  call<WithWallet<{ counted: number; full?: boolean }>>('POST', '/api/game/mine', { ores });
export const sellItems = (items: Record<string, number>) =>
  call<WithWallet<{ sold: number; coins: number; capped: boolean }>>('POST', '/api/shop/sell', { items });
export const renameMe = (handle: string) => call<WithWallet<{ house: House }>>('POST', '/api/me/rename', { handle });
/** 이사 (2026-11-18): 열린 구역 안의 빈 집으로 */
export const moveMyHouse = (houseNo: number) => call<WithWallet<{ house: House; from: number; cost: number }>>('POST', '/api/me/move', { houseNo });
export const reportArcade = (score: number, ms: number) =>
  call<WithWallet<{ score: number; coins: number; prize: string | null; morePaid: number }>>('POST', '/api/game/arcade', { score, ms });
export const reportVisit = (home: number) =>
  call<WithWallet<{ coins: number; already?: boolean; full?: boolean }>>('POST', '/api/game/visit', { home });
export const like = (houseNo: number) =>
  call<{ ok: boolean; likes: number; code?: string; message?: string }>('POST', `/api/like/${houseNo}`);

// ── 소통 (2026-11-15): 게시판, 친구, 방명록 ──
export interface Person {
  houseNo: number;
  handle: string;
  cat: CatLook;
}
export interface Post extends Person {
  id: number;
  text: string;
  /** unix 초 */
  at: number;
}
export type FriendState = 'self' | 'none' | 'friends' | 'sent' | 'received';
export const fetchBoard = () => call<{ posts: Post[] }>('GET', '/api/board');
export const postBoard = (text: string) => call<{ ok: true }>('POST', '/api/board', { text });
export const deleteBoardPost = (id: number) => call<{ ok: true }>('DELETE', `/api/board/${id}`);
export const fetchFriends = () => call<{ friends: Person[]; incoming: Person[]; outgoing: Person[] }>('GET', '/api/friends');
export const friendAction = (houseNo: number, action: 'request' | 'accept' | 'decline' | 'remove') =>
  call<{ ok: true; state: FriendState }>('POST', `/api/friends/${houseNo}`, { action });
export const fetchHouseSocial = (houseNo: number) =>
  call<{ guestbook: Post[]; friendState: FriendState; friendCount: number; decorScore?: number }>('GET', `/api/house/${houseNo}/social`);
export const postGuestbook = (houseNo: number, text: string) => call<{ ok: true }>('POST', `/api/house/${houseNo}/guestbook`, { text });
export const deleteGuestbook = (id: number) => call<{ ok: true }>('DELETE', `/api/guestbook/${id}`);
