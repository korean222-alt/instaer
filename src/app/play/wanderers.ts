// 산책하는 주민 고양이 (2026-11-19 사용자: "돌아다니는 주민 고양이도 있으면 좋겠어").
// 구역마다 세 마리가 마을 광장과 동네 몇 곳을 정해진 길로 천천히 돌아다닌다. 자리마다 잠깐 앉아 쉰다.
// 자리는 시계(Date.now)로 정해서 누가 보든 같은 곳에 있다 (서버 없이). 내 고양이가 가까이 가면 멈춰 기다려 준다
// (그만큼 이 화면에서만 조금 늦어진다). 걷는 길은 지도 길 안내와 같은 길 찾기(route.ts)로 만든다.
import { neighborhoodArea, townSquares, walkCost } from '../../scene';
import { NEIGHBORHOOD_SIZE, ZONE_CAPACITY } from '../../shared/config';
import { kstDay, normalizeWallet, wanderHasQuest } from '../../shared/economy';
import type { CatLook } from '../../shared/types';
import { state } from '../state';
import type { Npc } from './npcs';
import { findRoute, type Pt } from './route';

const PER_ZONE = 3;
/** 걷는 빠르기 (m/초), 자리마다 쉬는 시간 (초) */
const SPEED = 0.95;
const PAUSE = 9;
/** 내 고양이가 이만큼 가까우면 멈춰서 기다린다 */
const WAIT_NEAR = 3;

export const WANDER_NAMES = ['찹쌀', '도토리', '솜사탕', '마루', '깨비', '꼬미', '보송', '누룽지'] as const;
const LOOKS: CatLook[] = [
  { fur: '#f2d5a8', pattern: 'cheese', eyeColor: '#6fb7e8' },
  { fur: '#5b5560', pattern: 'gray', eyeColor: '#f2c94c' },
  { fur: '#fff4e6', pattern: 'calico', eyeColor: '#7ac36a' },
  { fur: '#2f2c33', pattern: 'tuxedo', eyeColor: '#9fd36a' },
  { fur: '#e6b17a', pattern: 'cheese', eyeColor: '#b48be0' },
  { fur: '#d8dbe2', pattern: 'white', eyeColor: '#f0b44a' },
];
export const WANDER_TALK = [
  '오늘은 저쪽 동네까지 걸어 볼 거다냥. 같이 걸을래냥?',
  '산책은 천천히 해야 제맛이다냥. 꽃 냄새도 맡고냥.',
  '광장에 가면 이장님이 새 소식을 알려 준다냥!',
  '어제는 연못에서 큰 물고기를 봤다냥. 낚시해 봤냥?',
  '이 섬은 넓어서 다 돌려면 하루가 걸린다냥. 지도를 보면 길을 잃지 않는다냥.',
  '새로 이사 온 이웃 집 마당이 정말 예쁘더라냥!',
];
export const wanderName = (i: number) => `산책냥 ${WANDER_NAMES[i % WANDER_NAMES.length]}`;
export const wanderLook = (i: number): CatLook => LOOKS[i % LOOKS.length];

interface Leg {
  pts: Pt[];
  /** 각 점까지 누적 거리 */
  acc: number[];
  len: number;
}
interface Walker {
  id: number;
  legs: Leg[];
  total: number;
  phase: number;
  /** 내가 붙잡아 둔 시간 (초) */
  lag: number;
  key: string;
}

let builtKey = '';
let walkers: Walker[] = [];
let lastTick = 0;

const hash = (n: number) => {
  let h = (n + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** 막힌 곳이면 둘레에서 걸을 수 있는 가장 가까운 자리 */
function openNear(p: Pt): Pt {
  const zones = state.unlockedZones;
  const has = (no: number) => state.houses.has(no);
  if (Number.isFinite(walkCost(p.x, p.z, zones, has))) return p;
  for (let r = 1; r <= 10; r++)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const q = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
      if (Number.isFinite(walkCost(q.x, q.z, zones, has))) return q;
    }
  return p;
}

/** 산책 고양이 한 마리가 들르는 자리: 마을 광장 → 동네 셋 (동네 가운데 큰 나무/연못 옆 빈터) */
function stopsOf(zone: number, k: number): Pt[] {
  const sq = townSquares(zone + 1)[zone];
  const a = k * 2.1 + 0.4;
  const out: Pt[] = [openNear({ x: sq.x + Math.sin(a) * sq.r * 0.55, z: sq.z + Math.cos(a) * sq.r * 0.55 })];
  const per = ZONE_CAPACITY / NEIGHBORHOOD_SIZE;
  for (const off of [0, 3, 6]) {
    const nb = neighborhoodArea(zone * per + ((k * 3 + 1 + off + (k === 2 ? 1 : 0)) % per));
    // 동네 가운데에서 광장 쪽으로 조금 나온 빈터
    const dx = sq.x - nb.x;
    const dz = sq.z - nb.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = Math.min(nb.rx, nb.rz) * 0.5;
    out.push(openNear({ x: nb.x + (dx / d) * r, z: nb.z + (dz / d) * r }));
  }
  return out;
}

function buildWalker(id: number): Walker | null {
  const zone = Math.floor(id / PER_ZONE);
  const stops = stopsOf(zone, id % PER_ZONE);
  const legs: Leg[] = [];
  for (let i = 0; i < stops.length; i++) {
    const from = stops[i];
    const to = stops[(i + 1) % stops.length];
    const pts = findRoute(from, to);
    if (!pts || pts.length < 2) return null;
    const acc = [0];
    for (let j = 1; j < pts.length; j++) acc.push(acc[j - 1] + Math.hypot(pts[j].x - pts[j - 1].x, pts[j].z - pts[j - 1].z));
    legs.push({ pts, acc, len: acc[acc.length - 1] });
  }
  const total = legs.reduce((s, l) => s + l.len / SPEED + PAUSE, 0);
  return { id, legs, total, phase: hash(id * 7 + 3) * total, lag: 0, key: '' };
}

/** 열린 구역이나 집 수가 바뀌면 길을 다시 만든다 (한 번에 한 마리씩: 길 찾기가 무거워서) */
function ensure(): Walker[] {
  const key = `${state.unlockedZones}|${state.houses.size}`;
  if (key !== builtKey) {
    builtKey = key;
    const old = new Map(walkers.map((w) => [w.id, w]));
    walkers = [];
    for (let id = 0; id < state.unlockedZones * PER_ZONE; id++) {
      const o = old.get(id);
      if (o) walkers.push({ ...o, key: '' });
    }
  }
  const count = Math.max(1, state.unlockedZones) * PER_ZONE;
  for (let id = 0; id < count; id++) {
    const w = walkers.find((v) => v.id === id);
    if (w && w.key === builtKey) continue;
    const nw = buildWalker(id);
    if (nw) {
      nw.lag = w?.lag ?? 0;
      nw.key = builtKey;
      if (w) walkers[walkers.indexOf(w)] = nw;
      else walkers.push(nw);
    } else if (w) w.key = builtKey;
    break;
  }
  return walkers;
}

function posOf(w: Walker, now: number): { x: number; z: number; rotY: number; moving: boolean } {
  let t = (((now / 1000 - w.lag + w.phase) % w.total) + w.total) % w.total;
  for (const leg of w.legs) {
    const walkT = leg.len / SPEED;
    if (t < walkT) {
      const d = t * SPEED;
      let j = 1;
      while (j < leg.acc.length - 1 && leg.acc[j] < d) j++;
      const a = leg.pts[j - 1];
      const b = leg.pts[j];
      const seg = leg.acc[j] - leg.acc[j - 1] || 1;
      const k = Math.min(1, Math.max(0, (d - leg.acc[j - 1]) / seg));
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, rotY: Math.atan2(b.x - a.x, b.z - a.z), moving: true };
    }
    t -= walkT;
    if (t < PAUSE) {
      const n = leg.pts.length;
      const a = leg.pts[n - 2];
      const b = leg.pts[n - 1];
      return { x: b.x, z: b.z, rotY: Math.atan2(b.x - a.x, b.z - a.z), moving: false };
    }
    t -= PAUSE;
  }
  const p = w.legs[0].pts[0];
  return { x: p.x, z: p.z, rotY: 0, moving: false };
}

/** 지금 산책 고양이들 (섬 좌표). me 를 주면 그 가까이의 고양이는 멈춰서 기다린다 */
export function wanderers(me?: Pt | null): Array<Npc & { moving: boolean }> {
  const now = Date.now();
  // 기다려 준 시간은 me 를 주는 쪽(걷기, 0.2초마다)에서만 센다. 지도는 me 없이 자리만 본다
  let dt = 0;
  if (me) {
    dt = lastTick ? Math.min(1, (now - lastTick) / 1000) : 0;
    lastTick = now;
  }
  const out: Array<Npc & { moving: boolean }> = [];
  // 줄 부탁이 남은 산책냥은 머리 위에 "!" (2026-11-19)
  const data = state.me && state.wallet ? normalizeWallet(state.wallet.data, kstDay()) : null;
  for (const w of ensure()) {
    let p = posOf(w, now);
    if (me && dt > 0 && Math.hypot(p.x - me.x, p.z - me.z) < WAIT_NEAR) {
      w.lag += dt;
      p = posOf(w, now);
      p.moving = false;
      p.rotY = Math.atan2(me.x - p.x, me.z - p.z);
    }
    out.push({ id: `walker-${w.id}`, role: 'wanderer', name: wanderName(w.id), x: p.x, z: p.z, rotY: p.rotY, cat: wanderLook(w.id), homeId: w.id, moving: p.moving, ...(data && wanderHasQuest(data, state.me!.houseNo, w.id) ? { mark: true } : {}) });
  }
  return out;
}
