import { NEIGHBORHOOD_SIZE, ZONE_CAPACITY } from '../shared/config';
import { hash01, mulberry32, valueNoise2 } from './util/rand';

/**
 * 집 번호(houseNo) → 위치. 위치는 DB에 저장하지 않고 항상 여기서 계산한다.
 *
 * 구조
 * - 구역(섬) 하나 = 동네 10개 = 집 100채. 1~100번은 1구역, 101~200번은 2구역 ...
 * - 동네 하나 = 집 10채. 동네 가운데에 광장 / 연못 / 큰 나무 중 하나가 있고,
 *   그 둘레에 집 10채가 느슨하게 둥글게 선다. 남쪽(화면 아래)은 틔워서 동네 입구로 쓴다.
 * - 집은 대체로 화면 쪽(+z)을 보되 동네 가운데 쪽으로 조금씩 몸을 튼다(rot).
 * - 동네는 3줄(3개, 4개, 3개)로 엇갈려 놓고, 줄마다 구불구불한 길이 동네 입구를 잇는다.
 * - 구역은 가운데에서 시작해 소용돌이 모양으로 늘어나고, 이웃 구역끼리 다리로 이어진다.
 *
 * 걷기에 필요한 것(걸을 수 있는 땅, 막힌 곳)도 여기서 계산해서 내보낸다.
 * 모든 구역이 같은 배치를 쓰므로 한 번만 계산한다.
 */

export { NEIGHBORHOOD_SIZE };
export const NEIGHBORHOODS_PER_ZONE = ZONE_CAPACITY / NEIGHBORHOOD_SIZE;

export const ZONE = {
  /** 섬(땅)의 절반 크기 */
  halfX: 100,
  halfZ: 91,
  /** 섬과 섬 사이 바다 폭 */
  gap: 18,
  /** 길 반폭 */
  pathR: 0.8,
  /** 동서 다리가 놓이는 z (구역 가운데 기준) */
  bridgeZ: 25.5,
  /** 남북 다리가 놓이는 x (구역 가운데 기준) */
  bridgeX: 23,
  /** 1구역 항구로 내려가는 길의 x */
  harborX: -23,
} as const;

/** 구역 가운데끼리의 간격 */
export const ZONE_PITCH_X = ZONE.halfX * 2 + ZONE.gap;
export const ZONE_PITCH_Z = ZONE.halfZ * 2 + ZONE.gap;

/** 마당 한 변 (YARD_SIZE 6칸 x 1) 의 절반 */
const YARD_HALF = 3;
/** 마당 가운데에서 집 가운데까지 (집은 마당 뒤쪽에 선다). world/constants.ts 의 HOUSE_OFFSET_Z 와 같은 값 */
const HOUSE_BACK = -1.3;
const DEG = Math.PI / 180;

export type FeatureKind = 'plaza' | 'pond' | 'tree';

export interface Neighborhood {
  /** 구역 안에서의 번호 (0~9). 구역 가운데에 가까운 동네부터 */
  index: number;
  /** 구역 가운데 기준 동네 가운데 */
  x: number;
  z: number;
  /** 집이 놓이는 타원의 반지름 */
  rx: number;
  rz: number;
  /** 동네 가운데에 있는 것 */
  feature: FeatureKind;
  /** 몇 번째 줄 (0~2) */
  row: number;
}

export interface LocalLot {
  /** 구역 가운데 기준 마당 한가운데 */
  x: number;
  z: number;
  /** 집이 몸을 튼 각도 (라디안, y축. 0이면 +z 를 본다) */
  rot: number;
  /** 구역 안 동네 번호 (0~9) */
  nb: number;
}

export interface PathSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** 길 반폭 */
  r: number;
}

/** 섬 장식 하나 (나무, 바위, 등불 ...). World 가 이 목록대로 그린다 */
export type SceneryKind =
  | 'plazaTree'
  | 'bigTree'
  | 'pond'
  | 'roundTree'
  | 'coneTree'
  | 'bush'
  | 'rock'
  | 'flowers'
  | 'tuft'
  | 'lantern'
  | 'bench';
export interface Scenery {
  kind: SceneryKind;
  x: number;
  z: number;
  rot: number;
  scale: number;
  seed: number;
}

/** 걷기를 막는 것. 원 또는 (돌아간) 네모 */
export interface Collider {
  /** 구역 가운데 기준 */
  x: number;
  z: number;
  /** 원이면 반지름, 네모면 0 */
  r: number;
  /** 네모의 절반 크기 (네모일 때만) */
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  /** 높이. 카메라를 가리는지 볼 때 쓴다 (낮은 울타리는 가리지 않는다) */
  h: number;
  /** 카메라를 가리는 범위: 원이면 반지름(나무는 잎이 줄기보다 넓다), 네모면 여유 폭. 0이면 가리지 않는다 */
  occ: number;
  /** 집에 딸린 것이면 구역 안 집 순번(0~99), 아니면 -1. 집이 없는 자리는 막지 않는다 */
  lot: number;
}

const rotX = (x: number, z: number, rot: number) => x * Math.cos(rot) + z * Math.sin(rot);
const rotZ = (x: number, z: number, rot: number) => -x * Math.sin(rot) + z * Math.cos(rot);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ───────────── 동네 ─────────────

const ROW_Z = [-54, 0, 54];
const ROW_X = [
  [-46, 0, 46],
  [-69, -23, 23, 69],
  [-46, 0, 46],
];
/** 동네 가운데에서 그 줄의 길까지 */
const ROAD_OFFSET = 25.5;
/** 동네 가운데를 도는 길의 반지름 */
const LOOP = { a: 7.2, b: 9 };
export const PLAZA_R = 5.2;
export const POND_R = 4.3;

/** 줄 길의 z (구불구불) */
const roadZ = (row: number, x: number) =>
  ROW_Z[row] + ROAD_OFFSET + 2.2 * Math.sin(x * 0.07 + row * 1.7) + 1.0 * Math.sin(x * 0.19 + row);

function buildNeighborhoods(): Neighborhood[] {
  const list: Array<Omit<Neighborhood, 'index' | 'feature'>> = [];
  ROW_X.forEach((xs, row) => {
    xs.forEach((x, i) => {
      const k = row * 7 + i;
      list.push({
        x: x + (hash01(k, 3) - 0.5) * 4,
        z: ROW_Z[row] + (hash01(k, 4) - 0.5) * 4,
        rx: 14.8 + hash01(k, 5) * 1.0,
        rz: 19.2 + hash01(k, 6) * 1.0,
        row,
      });
    });
  });
  // 구역 가운데에 가까운 동네부터 번호를 매긴다 (입주 초반에 마을이 가운데부터 차 보이게)
  list.sort((a, b) => Math.hypot(a.x, a.z * 1.1) - Math.hypot(b.x, b.z * 1.1) || a.x - b.x);
  const features: FeatureKind[] = ['plaza', 'pond', 'tree'];
  return list.map((n, index) => ({ ...n, index, feature: features[index % 3] }));
}

export const NEIGHBORHOODS: readonly Neighborhood[] = buildNeighborhoods();

/** 동네 타원 위의 점. theta 는 북쪽(-z)이 0, 시계 방향 */
const ringPoint = (theta: number, a: number, b: number) => ({ x: Math.sin(theta) * a, z: -Math.cos(theta) * b });

function buildLots(): LocalLot[] {
  const lots: LocalLot[] = [];
  for (const nb of NEIGHBORHOODS) {
    const rnd = mulberry32(nb.index * 977 + 31);
    const open = (rnd() - 0.5) * 0.3;
    const ring: Array<LocalLot & { key: number }> = [];
    for (let i = 0; i < NEIGHBORHOOD_SIZE; i++) {
      // 남쪽 80도는 비워서 동네 입구로 쓴다
      const theta = open + (-140 + (280 * i) / (NEIGHBORHOOD_SIZE - 1) + (rnd() - 0.5) * 4) * DEG;
      const off = (i % 2 ? 1.3 : -0.9) + (rnd() - 0.5) * 0.8;
      const p = ringPoint(theta, nb.rx + off, nb.rz + off);
      // 동네 가운데 쪽으로 몸을 조금 튼다 (완전히 돌리면 뒷모습만 보이는 집이 생긴다)
      const toCenter = Math.atan2(-p.x, -p.z);
      const rot = clamp(toCenter, -0.42, 0.42) + (rnd() - 0.5) * 0.12;
      ring.push({ x: nb.x + p.x, z: nb.z + p.z, rot, nb: nb.index, key: Math.abs(theta - open) + (i % 2) * 0.01 });
    }
    // 동네 안에서는 북쪽 가운데 집부터 번호를 매긴다
    ring.sort((a, b) => a.key - b.key);
    for (const { key: _key, ...lot } of ring) lots.push(lot);
  }
  return lots;
}

/** 구역 안의 집 자리 100개 (번호 순서) */
export const LOCAL_SLOTS: readonly LocalLot[] = buildLots();

/** 마당 입구(대문 자리): 마당 앞 가장자리 가운데에서 dist 만큼 더 나간 곳 */
export function lotGate(lot: LocalLot, dist = 0): { x: number; z: number } {
  return { x: lot.x + rotX(0, YARD_HALF + dist, lot.rot), z: lot.z + rotZ(0, YARD_HALF + dist, lot.rot) };
}

// ───────────── 길 ─────────────

interface Pt {
  x: number;
  z: number;
}

function polyline(out: PathSeg[], pts: Pt[], r: number) {
  for (let i = 1; i < pts.length; i++) out.push({ ax: pts[i - 1].x, az: pts[i - 1].z, bx: pts[i].x, bz: pts[i].z, r });
}

/** 부드럽게 휘는 길 (2차 곡선) */
function bend(a: Pt, c: Pt, b: Pt, n = 6): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z });
  }
  return pts;
}

function buildPaths(): PathSeg[] {
  const out: PathSeg[] = [];
  const r = ZONE.pathR;

  // 줄마다 동네 입구를 잇는 길
  const rowSpan = [52, 77, 52];
  for (let row = 0; row < 3; row++) {
    const pts: Pt[] = [];
    for (let x = -rowSpan[row]; x <= rowSpan[row] + 0.01; x += 3.5) pts.push({ x, z: roadZ(row, x) });
    polyline(out, pts, r + 0.06);
  }
  // 줄과 줄을 잇는 길 (동네 사이 풀밭을 지난다)
  const link = (x: number, row0: number, row1: number, sway: number) => {
    const z0 = roadZ(row0, x);
    const z1 = roadZ(row1, x);
    const pts: Pt[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push({ x: x + Math.sin(t * Math.PI) * sway * Math.sin(t * 7 + x), z: z0 + (z1 - z0) * t });
    }
    polyline(out, pts, r);
  };
  link(0, 0, 1, 2.2);
  link(-23, 1, 2, 2);
  link(23, 1, 2, -2);

  for (const nb of NEIGHBORHOODS) {
    const rnd = mulberry32(nb.index * 613 + 7);
    // 동네 가운데를 도는 길
    const loop: Pt[] = [];
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      const k = 1 + 0.05 * Math.sin(th * 3 + nb.index * 1.3);
      const p = ringPoint(th, LOOP.a * k, LOOP.b * k);
      loop.push({ x: nb.x + p.x, z: nb.z + p.z });
    }
    polyline(out, loop, r);
    // 입구: 도는 길의 남쪽에서 줄 길까지
    const start = loop[Math.round(n / 2)];
    const endX = nb.x + (rnd() - 0.5) * 5;
    const end = { x: endX, z: roadZ(nb.row, endX) };
    const entrance = bend(start, { x: (start.x + end.x) / 2 + (rnd() - 0.5) * 5, z: (start.z + end.z) / 2 }, end, 8);
    polyline(out, entrance, r);
    // 집마다 대문에서 가까운 길까지 짧은 샛길
    const targets = [...loop, ...entrance.slice(1, 7)];
    for (const lot of LOCAL_SLOTS) {
      if (lot.nb !== nb.index) continue;
      const gate = lotGate(lot, 0.2);
      const out1 = lotGate(lot, 2.2);
      let best = targets[0];
      let bestD = Infinity;
      for (const t of targets) {
        const d = Math.hypot(t.x - out1.x, t.z - out1.z);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      polyline(out, bend(gate, out1, best, 5), r * 0.72);
    }
  }
  return out;
}

/** 구역 안의 길 (구역 가운데 기준, 다리로 가는 길은 빼고) */
export const ZONE_PATHS: readonly PathSeg[] = buildPaths();

/** 다리/항구로 이어지는 길 (구역 가운데 기준). 다리가 놓인 방향만 그린다 */
export function linkPaths(links: { e: boolean; w: boolean; n: boolean; s: boolean }, harbor: boolean): PathSeg[] {
  const out: PathSeg[] = [];
  const r = ZONE.pathR;
  for (const [on, sign] of [
    [links.e, 1],
    [links.w, -1],
  ] as Array<[boolean, number]>) {
    if (!on) continue;
    const pts: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = sign * (77 + (ZONE.halfX - 0.6 - 77) * t);
      pts.push({ x, z: roadZ(1, x) * (1 - t) + ZONE.bridgeZ * t });
    }
    polyline(out, pts, r + 0.06);
  }
  if (links.n) {
    const x = ZONE.bridgeX;
    polyline(out, bend({ x, z: roadZ(0, x) }, { x: x + 1.6, z: -62 }, { x, z: -ZONE.halfZ + 0.6 }, 12), r);
  }
  if (links.s) {
    const x = ZONE.bridgeX;
    polyline(out, [{ x, z: roadZ(2, x) }, { x, z: ZONE.halfZ - 0.6 }], r);
  }
  if (harbor) {
    const x = ZONE.harborX;
    polyline(out, [{ x, z: roadZ(2, x) }, { x, z: ZONE.halfZ + 0.4 }], r);
  }
  return out;
}

function segDist(px: number, pz: number, s: PathSeg): number {
  const vx = s.bx - s.ax;
  const vz = s.bz - s.az;
  const wx = px - s.ax;
  const wz = pz - s.az;
  const t = clamp((wx * vx + wz * vz) / Math.max(1e-6, vx * vx + vz * vz), 0, 1);
  return Math.hypot(wx - vx * t, wz - vz * t) - s.r;
}

// ───────────── 땅 모양 ─────────────

function smoothUnion(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

const capsule = (x: number, z: number, ax: number, az: number, bx: number, bz: number, r: number) =>
  -segDist(x, z, { ax, az, bx, bz, r });

/** 땅을 이루는 굵은 띠 (길이 지나는 자리와 다리로 나가는 곶) */
const LAND_BANDS: Array<[number, number, number, number, number]> = [
  [-52, ROW_Z[0] + ROAD_OFFSET, 52, ROW_Z[0] + ROAD_OFFSET, 8],
  [-80, ROW_Z[1] + ROAD_OFFSET, 80, ROW_Z[1] + ROAD_OFFSET, 8],
  [-52, ROW_Z[2] + ROAD_OFFSET, 52, ROW_Z[2] + ROAD_OFFSET, 7.5],
  [0, ROW_Z[0] + ROAD_OFFSET, 0, ROW_Z[1] + ROAD_OFFSET, 7],
  [-23, ROW_Z[1] + ROAD_OFFSET, -23, ROW_Z[2] + ROAD_OFFSET, 7],
  [23, ROW_Z[1] + ROAD_OFFSET, 23, ROW_Z[2] + ROAD_OFFSET, 7],
  [76, ZONE.bridgeZ, ZONE.halfX - 4, ZONE.bridgeZ, 6],
  [-76, ZONE.bridgeZ, -ZONE.halfX + 4, ZONE.bridgeZ, 6],
  [ZONE.bridgeX, ROW_Z[0] + ROAD_OFFSET, ZONE.bridgeX, -ZONE.halfZ + 5, 6.5],
  [ZONE.bridgeX, ROW_Z[2] + ROAD_OFFSET, ZONE.bridgeX, ZONE.halfZ - 5, 6.5],
  [ZONE.harborX, ROW_Z[2] + ROAD_OFFSET, ZONE.harborX, ZONE.halfZ - 5, 6.5],
];

/**
 * 구역의 매끈한 땅 모양 (해안 굴곡을 넣기 전): 안쪽이 +, 바다가 -.
 * 동네마다 둥근 땅덩이가 있고 그것들이 이어져서 올록볼록한 섬이 된다.
 */
export function zoneBaseLand(lx: number, lz: number): number {
  let d = -100;
  for (const nb of NEIGHBORHOODS) {
    const a = nb.rx + 12.5;
    const b = nb.rz + 14;
    const q = Math.hypot((lx - nb.x) / a, (lz - nb.z - 2) / b);
    if (q > 1.6) continue;
    d = smoothUnion(d, (1 - q) * a, 6);
  }
  for (const [ax, az, bx, bz, r] of LAND_BANDS) {
    const c = capsule(lx, lz, ax, az, bx, bz, r);
    if (c > -6) d = smoothUnion(d, c, 6);
  }
  // 구역 범위를 넘지 않게 한다
  return Math.min(d, ZONE.halfX - Math.abs(lx), ZONE.halfZ - Math.abs(lz));
}

/** 1구역 항구 (구역 가운데 기준) */
export const HARBOR = { x: ZONE.harborX, r: 5.6, dockLength: 6.2 };

/** 구역의 해안 모양 (구역 가운데 기준). 구역마다 굴곡이 다르다 */
export function zoneLandLocal(zone: number, lx: number, lz: number): number {
  let d = zoneBaseLand(lx, lz);
  if (d < -9) return d;
  if (zone === 0) d = smoothUnion(d, HARBOR.r - Math.hypot(lx - HARBOR.x, lz - (ZONE.halfZ + 0.8)), 3.5);
  d += (valueNoise2(lx * 0.085 + zone * 17.3 + 50, lz * 0.085 + zone * 7.1 + 50, 5) - 0.5) * 2.6;
  d += (valueNoise2(lx * 0.3 + zone * 3.7 + 9, lz * 0.3 + 9, 9) - 0.5) * 0.7;
  return d;
}

// ───────────── 장식과 막힌 곳 ─────────────

function buildScenery(): Scenery[] {
  const out: Scenery[] = [];
  const rnd = mulberry32(2026);
  const seed = () => Math.floor(rnd() * 1e6);
  const add = (kind: SceneryKind, x: number, z: number, rot = 0, scale = 1) => out.push({ kind, x, z, rot, scale, seed: seed() });

  for (const nb of NEIGHBORHOODS) {
    const around = (count: number, radius: number, start: number, fn: (x: number, z: number, a: number) => void) => {
      for (let i = 0; i < count; i++) {
        const a = start + (i / count) * Math.PI * 2;
        fn(nb.x + Math.sin(a) * radius, nb.z + Math.cos(a) * radius, a);
      }
    };
    if (nb.feature === 'plaza') {
      add('plazaTree', nb.x, nb.z, 0, 1.15);
      around(4, 3.7, Math.PI / 4, (x, z, a) => add('bench', x, z, a + Math.PI));
      around(4, 4.7, 0, (x, z) => add('lantern', x, z));
    } else if (nb.feature === 'pond') {
      add('pond', nb.x, nb.z, rnd() * 6, 1);
      around(5, POND_R + 0.5, rnd() * 6, (x, z) => (rnd() > 0.4 ? add('rock', x, z, rnd() * 6, 0.9) : add('bush', x, z, rnd() * 6, 1)));
      add('bench', nb.x - 1.2, nb.z + POND_R + 1.5, Math.PI);
      add('bench', nb.x + 1.6, nb.z - POND_R - 1.5, 0);
      add('lantern', nb.x + 2.8, nb.z + POND_R + 1.4);
      add('lantern', nb.x - 3.2, nb.z - POND_R - 1.3);
      around(7, POND_R + 1.2, 0.4, (x, z) => add('flowers', x, z, rnd() * 6, 1.2));
    } else {
      add('bigTree', nb.x, nb.z, rnd() * 6, 1);
      around(9, 2.9, 0, (x, z) => add('flowers', x + (rnd() - 0.5), z + (rnd() - 0.5), rnd() * 6, 1.25));
      around(3, 4.6, 0.9, (x, z) => add('bush', x, z, rnd() * 6, 1.1));
      add('bench', nb.x, nb.z + 3.6, 0);
      add('rock', nb.x - 3.8, nb.z - 2.2, rnd() * 6, 1);
      add('lantern', nb.x + 3.6, nb.z + 3.4);
      add('lantern', nb.x - 3.6, nb.z + 3.4);
    }
  }
  // 줄 길을 따라 등불
  for (let row = 0; row < 3; row++) {
    const span = row === 1 ? 72 : 48;
    for (let x = -span; x <= span; x += 24) add('lantern', x + 3, roadZ(row, x + 3) - 1.5);
  }

  // 나머지 풀밭: 마당, 길, 동네 가운데를 피해서 흩뿌린다
  const taken: Array<[number, number, number]> = out.map((s) => [s.x, s.z, 0.8]);
  const isFree = (x: number, z: number, margin: number) => {
    if (zoneBaseLand(x, z) < 4.6 + margin) return false;
    if (Math.abs(x - ZONE.harborX) < 1.8 + margin && z > 76) return false;
    if (Math.abs(x - ZONE.bridgeX) < 1.8 + margin && Math.abs(z) > 28) return false;
    if (Math.abs(z - ZONE.bridgeZ) < 3.2 + margin && Math.abs(x) > 74) return false;
    for (const nb of NEIGHBORHOODS) if (Math.hypot(x - nb.x, z - nb.z) < 6.2 + margin) return false;
    for (const l of LOCAL_SLOTS) if (Math.hypot(x - l.x, z - l.z) < 4.7 + margin) return false;
    for (const s of ZONE_PATHS) if (segDist(x, z, s) < 0.55 + margin) return false;
    return true;
  };
  const scatter = (kind: SceneryKind, count: number, margin: number, gap: number, scale: [number, number]) => {
    let placed = 0;
    let tries = 0;
    while (placed < count && tries++ < 9000) {
      const x = (rnd() - 0.5) * ZONE.halfX * 2;
      const z = (rnd() - 0.5) * ZONE.halfZ * 2;
      if (!isFree(x, z, margin)) continue;
      if (taken.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + gap)) continue;
      taken.push([x, z, gap]);
      add(kind, x, z, rnd() * Math.PI * 2, scale[0] + rnd() * (scale[1] - scale[0]));
      placed++;
    }
  };
  scatter('roundTree', 74, 0.5, 1.5, [1.0, 1.45]);
  scatter('coneTree', 50, 0.4, 1.3, [0.95, 1.35]);
  scatter('rock', 30, 0.1, 0.8, [0.7, 1.15]);
  scatter('bush', 84, 0.0, 0.8, [0.9, 1.3]);
  scatter('flowers', 150, -0.2, 0.4, [1.0, 1.3]);
  scatter('tuft', 170, -0.3, 0.3, [0.8, 1.3]);
  return out;
}

/** 구역 하나의 장식 (구역 가운데 기준). 모든 구역이 같은 배치를 쓴다 */
export const ZONE_SCENERY: readonly Scenery[] = buildScenery();

function buildColliders(): Collider[] {
  const out: Collider[] = [];
  const circle = (x: number, z: number, r: number, h: number, occ = 0) => out.push({ x, z, r, hx: 0, hz: 0, cos: 1, sin: 0, h, occ, lot: -1 });
  const box = (x: number, z: number, hx: number, hz: number, rot: number, h: number, lot = -1, occ = 0) =>
    out.push({ x, z, r: 0, hx, hz, cos: Math.cos(rot), sin: Math.sin(rot), h, occ, lot });

  LOCAL_SLOTS.forEach((lot, i) => {
    const at = (lx: number, lz: number, hx: number, hz: number, h: number, occ = 0) =>
      box(lot.x + rotX(lx, lz, lot.rot), lot.z + rotZ(lx, lz, lot.rot), hx, hz, lot.rot, h, i, occ);
    // 집 몸체
    at(0, HOUSE_BACK, 1.5, 1.2, 3.4, 0.3);
    // 울타리: 뒤와 양옆 (앞쪽은 열려 있다)
    const e = YARD_HALF - 0.12;
    at(0, -e, e, 0.1, 0.5);
    const sideEnd = e * 0.38;
    for (const sx of [-e, e]) at(sx, (-e + sideEnd) / 2, 0.1, (e + sideEnd) / 2, 0.5);
  });
  for (const s of ZONE_SCENERY) {
    if (s.kind === 'plazaTree') circle(s.x, s.z, 1.25 * s.scale, 5.2, 2.3 * s.scale);
    else if (s.kind === 'bigTree') circle(s.x, s.z, 1.0 * s.scale, 7, 3.3 * s.scale);
    else if (s.kind === 'pond') circle(s.x, s.z, POND_R * s.scale + 0.15, 0);
    else if (s.kind === 'roundTree') circle(s.x, s.z, 0.34 * s.scale, 2.5 * s.scale, 1.0 * s.scale);
    else if (s.kind === 'coneTree') circle(s.x, s.z, 0.5 * s.scale, 2.4 * s.scale, 0.75 * s.scale);
    else if (s.kind === 'rock') circle(s.x, s.z, 0.5 * s.scale, 0.4);
    else if (s.kind === 'lantern') circle(s.x, s.z, 0.2, 0.4);
    else if (s.kind === 'bench') box(s.x, s.z, 0.78, 0.26, s.rot, 0.5);
  }
  return out;
}

/** 구역 하나의 막힌 곳 (구역 가운데 기준) */
export const ZONE_COLLIDERS: readonly Collider[] = buildColliders();

const GRID = 8;
const gridKey = (gx: number, gz: number) => (gx + 64) * 256 + (gz + 64);
const colliderGrid = new Map<number, Collider[]>();
for (const c of ZONE_COLLIDERS) {
  const reach = c.r > 0 ? c.r : Math.hypot(c.hx, c.hz);
  for (let gx = Math.floor((c.x - reach) / GRID); gx <= Math.floor((c.x + reach) / GRID); gx++) {
    for (let gz = Math.floor((c.z - reach) / GRID); gz <= Math.floor((c.z + reach) / GRID); gz++) {
      const k = gridKey(gx, gz);
      let list = colliderGrid.get(k);
      if (!list) colliderGrid.set(k, (list = []));
      list.push(c);
    }
  }
}

/**
 * 구역 가운데 기준 (lx, lz) 둘레 reach 안에 걸칠 수 있는 막힌 곳을 out 에 담는다.
 * (걷기에서 매 프레임 부르므로 새 배열을 만들지 않는다. 같은 것이 두 번 들어갈 수 있다)
 */
export function collidersNear(lx: number, lz: number, reach: number, out: Collider[]): Collider[] {
  out.length = 0;
  for (let gx = Math.floor((lx - reach) / GRID); gx <= Math.floor((lx + reach) / GRID); gx++) {
    for (let gz = Math.floor((lz - reach) / GRID); gz <= Math.floor((lz + reach) / GRID); gz++) {
      const list = colliderGrid.get(gridKey(gx, gz));
      if (list) for (const c of list) out.push(c);
    }
  }
  return out;
}

// ───────────── 구역 위치: 가운데에서 시작하는 네모 소용돌이 ─────────────

const zoneGrid: Array<{ gx: number; gz: number }> = [{ gx: 0, gz: 0 }];
const zoneByGrid = new Map<string, number>([['0,0', 0]]);
function growZones(count: number) {
  // 동 → 북 → 서 → 남 순서로 1,1,2,2,3,3... 칸씩
  const dirs = [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ];
  while (zoneGrid.length < count) {
    let gx = 0;
    let gz = 0;
    let n = 1;
    let len = 1;
    let d = 0;
    zoneGrid.length = 1;
    outer: for (;;) {
      for (let rep = 0; rep < 2; rep++) {
        for (let s = 0; s < len; s++) {
          gx += dirs[d][0];
          gz += dirs[d][1];
          zoneGrid[n] = { gx, gz };
          zoneByGrid.set(`${gx},${gz}`, n);
          n++;
          if (n >= count + 16) break outer;
        }
        d = (d + 1) % 4;
      }
      len++;
    }
  }
}

/** 구역 가운데의 세계 좌표 (zone 은 0부터) */
export function zoneCenter(zone: number): { x: number; z: number } {
  if (zone >= zoneGrid.length) growZones(zone + 1);
  const g = zoneGrid[zone];
  return { x: g.gx * ZONE_PITCH_X, z: g.gz * ZONE_PITCH_Z };
}

/** 구역 k 와 바로 앞 구역(k-1)을 잇는 다리의 방향. 'x' 는 동서, 'z' 는 남북 */
export function zoneLink(zone: number): { from: number; to: number; axis: 'x' | 'z'; sign: number } | null {
  if (zone <= 0) return null;
  zoneCenter(zone);
  const a = zoneGrid[zone - 1];
  const b = zoneGrid[zone];
  if (b.gx !== a.gx) return { from: zone - 1, to: zone, axis: 'x', sign: Math.sign(b.gx - a.gx) };
  return { from: zone - 1, to: zone, axis: 'z', sign: Math.sign(b.gz - a.gz) };
}

/** 다리가 섬 위로 걸치는 길이 */
export const BRIDGE_OVERLAP = 4.3;
export const BRIDGE = { length: ZONE.gap + BRIDGE_OVERLAP * 2, width: 2.3, rise: 0.85 };

/** 구역 k 와 k-1 을 잇는 다리의 가운데 (세계 좌표) */
export function bridgeOf(zone: number): { x: number; z: number; axis: 'x' | 'z' } | null {
  const l = zoneLink(zone);
  if (!l) return null;
  const a = zoneCenter(l.from);
  const b = zoneCenter(l.to);
  if (l.axis === 'x') return { x: (a.x + b.x) / 2, z: a.z + ZONE.bridgeZ, axis: 'x' };
  return { x: a.x + ZONE.bridgeX, z: (a.z + b.z) / 2, axis: 'z' };
}

// ───────────── 집 번호 ↔ 위치 ─────────────

/** 집 번호가 속한 구역 (0부터) */
export const zoneOfHouse = (houseNo: number) => Math.floor((Math.max(1, Math.floor(houseNo)) - 1) / ZONE_CAPACITY);

/**
 * 집 번호 → 마당 한가운데의 세계 좌표.
 * - zone: 구역 번호 (0부터. 1~100번지가 zone 0)
 * - neighborhood: 동네 번호 (0부터, 섬 전체에서 이어서 센다. 1~10번지가 0, 11~20번지가 1 ...)
 * - rot: 집이 몸을 튼 각도 (라디안)
 */
export function houseSlot(houseNo: number): { x: number; z: number; zone: number; neighborhood: number; rot: number } {
  const n = Math.max(1, Math.floor(houseNo));
  const zone = zoneOfHouse(n);
  const lot = LOCAL_SLOTS[(n - 1) % ZONE_CAPACITY];
  const c = zoneCenter(zone);
  return { x: c.x + lot.x, z: c.z + lot.z, zone, neighborhood: zone * NEIGHBORHOODS_PER_ZONE + lot.nb, rot: lot.rot };
}

/** 동네 번호(섬 전체 기준) → 동네 가운데의 세계 좌표와 모양 */
export function neighborhoodArea(neighborhood: number): { x: number; z: number; rx: number; rz: number; feature: FeatureKind; zone: number } {
  const zone = Math.floor(neighborhood / NEIGHBORHOODS_PER_ZONE);
  const nb = NEIGHBORHOODS[((neighborhood % NEIGHBORHOODS_PER_ZONE) + NEIGHBORHOODS_PER_ZONE) % NEIGHBORHOODS_PER_ZONE];
  const c = zoneCenter(zone);
  return { x: c.x + nb.x, z: c.z + nb.z, rx: nb.rx, rz: nb.rz, feature: nb.feature, zone };
}

/** 세계 좌표가 속한 구역. 구역 사이 바다면 -1 */
export function zoneAt(x: number, z: number): number {
  const gx = Math.round(x / ZONE_PITCH_X);
  const gz = Math.round(z / ZONE_PITCH_Z);
  const zone = zoneByGrid.get(`${gx},${gz}`);
  if (zone === undefined) return -1;
  if (Math.abs(x - gx * ZONE_PITCH_X) > ZONE.halfX + 8 || Math.abs(z - gz * ZONE_PITCH_Z) > ZONE.halfZ + 8) return -1;
  return zone;
}

/** 세계 좌표에서 가장 가까운 동네 번호(섬 전체 기준). 바다 한가운데면 -1 */
export function neighborhoodAt(x: number, z: number): number {
  const zone = zoneAt(x, z);
  if (zone < 0) return -1;
  const c = zoneCenter(zone);
  let best = 0;
  let bestD = Infinity;
  for (const nb of NEIGHBORHOODS) {
    const d = Math.hypot(x - c.x - nb.x, z - c.z - nb.z);
    if (d < bestD) {
      bestD = d;
      best = nb.index;
    }
  }
  return zone * NEIGHBORHOODS_PER_ZONE + best;
}

/** 해안까지의 거리 (세계 좌표, 안쪽 +). 구역 밖은 깊은 바다 */
export function landAt(x: number, z: number): number {
  const zone = zoneAt(x, z);
  if (zone < 0) return -10;
  const c = zoneCenter(zone);
  return zoneLandLocal(zone, x - c.x, z - c.z);
}

/** 세계 좌표가 어느 집 마당 위인지. 없으면 null. (탭한 집 찾기용) */
export function houseNoAt(x: number, z: number, margin = 0.3): number | null {
  const zone = zoneAt(x, z);
  if (zone < 0) return null;
  const c = zoneCenter(zone);
  const lx = x - c.x;
  const lz = z - c.z;
  for (let i = 0; i < LOCAL_SLOTS.length; i++) {
    const lot = LOCAL_SLOTS[i];
    const dx = lx - lot.x;
    const dz = lz - lot.z;
    if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
    // 마당 기준 좌표로 돌려서 본다
    const ux = dx * Math.cos(lot.rot) - dz * Math.sin(lot.rot);
    const uz = dx * Math.sin(lot.rot) + dz * Math.cos(lot.rot);
    if (Math.abs(ux) <= YARD_HALF + margin && Math.abs(uz) <= YARD_HALF + margin) return zone * ZONE_CAPACITY + i + 1;
  }
  return null;
}
