// 앱 전체가 같이 보는 상태 (내 집, 마을, 지역 순위) 와 씬 반영.
import type { IslandScene } from '../scene';
import { FOUNDER_MAX, REGIONS, ZONE_CAPACITY } from '../shared/config';
import type { House, RegionId, YardItem } from '../shared/types';
import { fetchRegions, fetchVillage, type Regions, type Village } from './net/api';
import { withEmptyLots } from './village';

type Listener = () => void;

export interface AppState {
  scene: IslandScene;
  me: House | null;
  /** 입주한 집 (빈 집 제외), 번지 → 집 */
  houses: Map<number, House>;
  yards: Map<number, YardItem[]>;
  todayTop: Village['todayTop'];
  unlockedZones: number;
  regions: Regions | null;
  /** 서버가 안 되어서 혼자 둘러보는 중 */
  offline: boolean;
  /** 씬에서 강조 중인 지역 */
  highlightedRegion: RegionId | null;
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
    houses: new Map(),
    yards: new Map(),
    todayTop: null,
    unlockedZones: 1,
    regions: null,
    offline: false,
    highlightedRegion: null,
  };
  return state;
}

export const regionLabel = (id: RegionId) => REGIONS.find((r) => r.id === id)?.label ?? '기타';
export const regionColor = (id: RegionId) => REGIONS.find((r) => r.id === id)?.color ?? '#9aa3ad';
export const isFounder = (houseNo: number) => houseNo <= FOUNDER_MAX;
export const totalHouses = () => state.houses.size;
/** 다음 섬이 열릴 때까지 남은 입주 수 */
export function toNextIsland(): number {
  const maxNo = Math.max(0, ...state.houses.keys());
  return ZONE_CAPACITY * Math.max(1, Math.ceil(maxNo / ZONE_CAPACITY)) - maxNo || ZONE_CAPACITY;
}

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

export function applyVillage(v: Village) {
  state.houses = new Map(v.houses.map((h) => [h.houseNo, h]));
  // 내 집은 서버 캐시(최대 1분)보다 내가 아는 값이 더 새롭다
  if (state.me) state.houses.set(state.me.houseNo, state.me);
  const prevYards = state.yards;
  state.yards = new Map(Object.entries(v.yards).map(([k, items]) => [Number(k), items]));
  if (state.me && prevYards.has(state.me.houseNo)) state.yards.set(state.me.houseNo, prevYards.get(state.me.houseNo)!);
  state.todayTop = v.todayTop;
  const maxNo = Math.max(0, ...state.houses.keys());
  state.unlockedZones = Math.max(v.unlockedZones, Math.ceil(maxNo / ZONE_CAPACITY), 1);
  pushHousesToScene(true);
  for (const [no, items] of state.yards) state.scene.setYardItems(no, items);
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

/** 내 집 정보가 바뀌었을 때 (입주, 지붕 색) */
export function setMe(house: House | null) {
  state.me = house;
  if (house) {
    state.houses.set(house.houseNo, house);
    state.unlockedZones = Math.max(state.unlockedZones, Math.ceil(house.houseNo / ZONE_CAPACITY));
  }
  emit();
}

export function setHighlightedRegion(id: RegionId | null) {
  state.highlightedRegion = id;
  state.scene.highlightRegion(id);
  emit();
}

/** 아이디로 집 찾기 (앞부분이 같은 것부터) */
export function searchHouses(query: string, limit = 8): House[] {
  const q = query.trim().replace(/^@+/, '').toLowerCase();
  if (!q) return [];
  const starts: House[] = [];
  const contains: House[] = [];
  for (const h of state.houses.values()) {
    const handle = h.igHandle ?? '';
    if (handle.startsWith(q)) starts.push(h);
    else if (handle.includes(q)) contains.push(h);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
