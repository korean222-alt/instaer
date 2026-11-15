// 앱 전체가 같이 보는 상태 (내 집, 마을, 지역 순위) 와 씬 반영.
import type { IslandScene } from '../scene';
import { FOUNDER_MAX, REGIONS, ZONE_CAPACITY } from '../shared/config';
import type { House, PlacedItem, RegionId } from '../shared/types';
import { fetchRegions, fetchVillage, type Regions, type Village, type WalletView } from './net/api';
import { withEmptyLots } from './village';
import { openZoneCount } from '../shared/zones';

type Listener = () => void;

export interface AppState {
  scene: IslandScene;
  me: House | null;
  /** 내 아이디를 다른 사람에게 가려서 보여 주는지 */
  hideHandle: boolean;
  /** 입주한 집 (빈 집 제외), 번지 → 집 */
  houses: Map<number, House>;
  /** 번지 → 마당 자유 배치 아이템 */
  yards: Map<number, PlacedItem[]>;
  /** 번지 → 지붕 그림 id */
  roofArt: Map<number, string>;
  /** 내 지갑 (입주 전이나 서버가 안 되면 null) */
  wallet: WalletView | null;
  /** 지금 꾸미는 중인 마당 번지 (마을을 새로 받아도 이 집 마당은 덮어쓰지 않는다) */
  editingYard: number | null;
  todayTop: Village['todayTop'];
  unlockedZones: number;
  regions: Regions | null;
  /** 서버가 안 되어서 혼자 둘러보는 중 */
  offline: boolean;
  /** 씬에서 강조 중인 지역 */
  highlightedRegion: RegionId | null;
  /** 받은 친구 신청 수 (친구 탭 빨간 점) */
  friendRequests: number;
}

const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const emit = () => listeners.forEach((fn) => fn());

export let state: AppState;

export function initState(scene: IslandScene): AppState {
  state = {
    scene,
    me: null,
    hideHandle: false,
    houses: new Map(),
    yards: new Map(),
    roofArt: new Map(),
    wallet: null,
    editingYard: null,
    todayTop: null,
    unlockedZones: 1,
    regions: null,
    offline: false,
    highlightedRegion: null,
    friendRequests: 0,
  };
  return state;
}

export const regionLabel = (id: RegionId) => REGIONS.find((r) => r.id === id)?.label ?? '기타';
export const regionColor = (id: RegionId) => REGIONS.find((r) => r.id === id)?.color ?? '#9aa3ad';
export const isFounder = (houseNo: number) => houseNo <= FOUNDER_MAX;
export const totalHouses = () => state.houses.size;
/** 다음 섬이 열릴 때까지 남은 입주 수 */
export function toNextIsland(): number {
  // 집을 골라서 입주하므로 번지가 아니라 입주 수로 센다 (지금 열린 구역이 다 차면 다음 섬이 열린다)
  return Math.max(1, ZONE_CAPACITY * openZoneCount(state.houses.size, maxHouseNo()) - state.houses.size);
}
const maxHouseNo = () => Math.max(0, ...state.houses.keys());

// ── 씬 반영 ──
let houseTimer = 0;
/** 집 목록을 씬에 다시 넘긴다 (씬은 전체를 다시 만드므로 짧게 모아서 한 번에) */
export function pushHousesToScene(immediate = false) {
  const run = () => {
    const lived = [...state.houses.values()];
    state.scene.setUnlockedZones(state.unlockedZones);
    state.scene.setHouses(withEmptyLots(lived, state.unlockedZones));
  };
  clearTimeout(houseTimer);
  if (immediate) run();
  else houseTimer = window.setTimeout(run, 180);
}

/** 내 지붕 그림을 이 화면에서 바꾼 적이 있으면 (서버 캐시보다 새롭다) */
let myRoofKnown = false;
export function setMyRoofArt(id: string | null) {
  if (!state.me) return;
  myRoofKnown = true;
  if (id) state.roofArt.set(state.me.houseNo, id);
  else state.roofArt.delete(state.me.houseNo);
  emit();
}

export function applyVillage(v: Village) {
  state.houses = new Map(v.houses.map((h) => [h.houseNo, h]));
  // 내 집은 서버 캐시(최대 1분)보다 내가 아는 값이 더 새롭다
  if (state.me) state.houses.set(state.me.houseNo, state.me);
  const prevYards = state.yards;
  const prevRoof = state.roofArt;
  state.yards = new Map(Object.entries(v.yards ?? {}).map(([k, items]) => [Number(k), items]));
  state.roofArt = new Map(Object.entries(v.roofArt ?? {}).map(([k, id]) => [Number(k), id]));
  if (state.me) {
    const no = state.me.houseNo;
    // 내 집은 서버 캐시(최대 1분)보다 내가 아는 값이 더 새롭다
    if (prevYards.has(no)) state.yards.set(no, prevYards.get(no)!);
    if (myRoofKnown) {
      if (prevRoof.has(no)) state.roofArt.set(no, prevRoof.get(no)!);
      else state.roofArt.delete(no);
    }
  }
  // 마당이 비워진 집도 씬에서 지운다
  const cleared = [...prevYards.keys()].filter((no) => !state.yards.has(no));
  state.todayTop = v.todayTop;
  state.unlockedZones = Math.max(v.unlockedZones, openZoneCount(state.houses.size, maxHouseNo()));
  pushHousesToScene(true);
  for (const no of cleared) if (no !== state.editingYard) state.scene.setYardItemsFree(no, []);
  for (const [no, items] of state.yards) if (no !== state.editingYard) state.scene.setYardItemsFree(no, items);
  state.scene.highlightHouse(state.todayTop?.houseNo ?? null);
  emit();
}

export async function refreshVillage(): Promise<boolean> {
  try {
    applyVillage(await fetchVillage());
    state.offline = false;
    return true;
  } catch {
    state.offline = true;
    emit();
    return false;
  }
}

export async function refreshRegions(): Promise<Regions | null> {
  try {
    state.regions = await fetchRegions();
    emit();
  } catch {
    /* 순위는 없어도 된다 */
  }
  return state.regions;
}

export function setWallet(w: WalletView | null) {
  state.wallet = w;
  emit();
}

/** 내 집 정보가 바뀌었을 때 (입주, 지붕 색) */
export function setMe(house: House | null) {
  state.me = house;
  if (house) {
    state.houses.set(house.houseNo, house);
    state.unlockedZones = Math.max(state.unlockedZones, openZoneCount(state.houses.size, maxHouseNo()));
    pushHousesToScene();
  }
  emit();
}

export function setHighlightedRegion(id: RegionId | null) {
  state.highlightedRegion = id;
  state.scene.highlightRegion(id);
  emit();
}

/** 닉네임으로 집 찾기 (앞부분이 같은 것부터) */
export function searchHouses(query: string, limit = 8): House[] {
  const q = query.trim().replace(/^@+/, '').toLowerCase();
  if (!q) return [];
  const starts: House[] = [];
  const contains: House[] = [];
  for (const h of state.houses.values()) {
    const handle = h.igHandle ?? '';
    if (handle.includes('*')) continue; // 닉네임을 숨긴 집은 찾기에 안 나온다
    if (handle.startsWith(q)) starts.push(h);
    else if (handle.includes(q)) contains.push(h);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
