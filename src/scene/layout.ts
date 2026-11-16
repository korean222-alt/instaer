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

/** 마당 한 변의 절반 (2026-11-16: 6m → 7.2m 로 넓혔다. world/constants 의 YARD_WORLD 와 같다) */
export const YARD_HALF = 3.6;
/** 우편함 자리 (마당 가운데 기준, 앞 오른쪽 대문 옆) */
export const MAILBOX_LOCAL = { x: 1.75, z: YARD_HALF - 0.3 };
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
  | 'bench'
  | 'npcHome'
  | 'caveHill'
  | 'hill'
  | 'townBoard'
  | 'stall';
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
        rx: 16.3 + hash01(k, 5) * 1.0,
        rz: 20.7 + hash01(k, 6) * 1.0,
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

// ───────────── 섬 모서리: 주민 집, 동굴 산, 바위 언덕 (2026-11-15) ─────────────

/** 주민 집 하나 (구역 가운데 기준). rot 은 집이 보는 쪽 (0 이면 +z) */
export interface HomeSpot {
  x: number;
  z: number;
  rot: number;
  /** 모서리 번호 (CORNERS) */
  corner: number;
}
/** 구역마다 같은 자리에 있는 주민 집 8채. 순서가 곧 주민 집 번호 (앱이 역할을 붙인다) */
export const HOME_SPOTS: readonly HomeSpot[] = [
  { x: -71, z: -57, rot: 0.25, corner: 0 },
  { x: -92, z: -56, rot: 0.15, corner: 0 },
  { x: 72, z: -61, rot: -0.2, corner: 1 },
  { x: 86, z: -55, rot: -0.35, corner: 1 },
  { x: -76, z: 60, rot: 0.3, corner: 2 },
  { x: -90, z: 70, rot: 0.2, corner: 2 },
  { x: 76, z: 60, rot: -0.3, corner: 3 },
  { x: 90, z: 70, rot: -0.2, corner: 3 },
];
/** 주민 집 몸체의 절반 크기와 문 앞 거리 (몸체 가운데 기준) */
export const HOME_HALF = { x: 1.75, z: 1.45 };
export const HOME_DOOR = 2.1;
export const homeDoor = (h: HomeSpot, dist = HOME_DOOR) => ({ x: h.x + Math.sin(h.rot) * dist, z: h.z + Math.cos(h.rot) * dist });

/** 북서쪽 동굴 산 (구역 가운데 기준). mouth 는 동굴 입구 앞 (여기 가까이 가면 들어갈 수 있다) */
export const CAVE_HILL = { x: -83, z: -73, r: 8.2, rot: 0.55 };
export const CAVE_MOUTH = { x: CAVE_HILL.x + Math.sin(CAVE_HILL.rot) * (CAVE_HILL.r + 0.9), z: CAVE_HILL.z + Math.cos(CAVE_HILL.rot) * (CAVE_HILL.r + 0.9) };
/** 바위 언덕 (올라갈 수 없는 큰 바위산). 섬을 덜 밋밋하게 */
export const HILLS: ReadonlyArray<{ x: number; z: number; r: number; h: number; seed: number }> = [
  { x: -91, z: -63, r: 2.6, h: 2.6, seed: 11 },
  { x: 88, z: -71, r: 4.6, h: 3.8, seed: 12 },
  { x: 75, z: -74, r: 2.6, h: 2.4, seed: 13 },
  { x: -92, z: 58, r: 3.0, h: 2.8, seed: 14 },
  { x: -84, z: 78, r: 2.4, h: 2.0, seed: 15 },
  { x: 93, z: 57, r: 3.2, h: 3.0, seed: 16 },
  { x: 84, z: 79, r: 2.2, h: 1.8, seed: 17 },
];

// ───────────── 마을 광장 (2026-11-15): 섬 한가운데 큰길과 갈림길이 만나는 곳 ─────────────

/**
 * 마을 광장 (구역 가운데 기준). 마을 게시판, 이장, 장터 가판대 둘(잡화점, 오락실), 벤치.
 * 1줄 큰길과 2줄로 내려가는 갈림길(x = -23)이 만나는 자리라 어디서든 찾아오기 쉽다.
 */
export const TOWN_SQUARE = {
  x: -24,
  z: 22.5,
  r: 7.4,
  /** 마을 게시판 (앞이 +z) */
  board: { x: -24, z: 17.2, rot: 0 },
  /** 이장이 서 있는 자리 */
  mayor: { x: -21.3, z: 18.9 },
  /** 장터 가판대: 0 잡화점, 1 오락실. rot 은 가판대 앞이 보는 쪽 */
  stalls: [
    { x: -30.2, z: 20.5, rot: 0.6, kind: 'shop' as const },
    { x: -17.8, z: 20.5, rot: -0.6, kind: 'arcade' as const },
  ],
  benches: [
    { x: -27.6, z: 29.8, rot: Math.PI },
    { x: -20.4, z: 29.8, rot: Math.PI },
  ],
  lanterns: [
    [-28.5, 16.5],
    [-18.8, 17.6],
    [-30.6, 27.2],
    [-17.4, 27.2],
  ] as Array<[number, number]>,
} as const;
/** 가판대 앞 (주인이 서는 자리) */
export const stallFront = (st: { x: number; z: number; rot: number }, dist = 1.55) => ({ x: st.x + Math.sin(st.rot) * dist, z: st.z + Math.cos(st.rot) * dist });

function buildCornerPaths(base: PathSeg[]): PathSeg[] {
  const out: PathSeg[] = [];
  const r = ZONE.pathR * 0.9;
  const door = (i: number) => homeDoor(HOME_SPOTS[i], HOME_DOOR + 0.6);
  // 북서: 1줄 길 서쪽 끝에서 동굴 입구까지, 가는 길에 주민 집 두 채
  polyline(out, [...bend({ x: -52, z: roadZ(0, -52) }, { x: -64, z: -36 }, { x: -68, z: -50 }, 8), ...bend({ x: -68, z: -50 }, { x: -72, z: -56 }, CAVE_MOUTH, 6).slice(1)], r);
  polyline(out, bend(door(0), { x: door(0).x - 2, z: door(0).z + 1 }, { x: -68, z: -50 }, 4), r * 0.8);
  polyline(out, bend(door(1), { x: -85, z: -53 }, { x: -77, z: -57 }, 5), r * 0.8);
  // 북동: 1줄 길 동쪽 끝에서
  polyline(out, bend({ x: 52, z: roadZ(0, 52) }, { x: 64, z: -36 }, { x: 68, z: -52 }, 8), r);
  polyline(out, bend({ x: 68, z: -52 }, { x: 70, z: -56 }, door(2), 4), r * 0.8);
  polyline(out, bend({ x: 68, z: -52 }, { x: 80, z: -50 }, door(3), 5), r * 0.8);
  // 남서, 남동: 3줄 길 끝에서
  for (const sign of [-1, 1]) {
    const a = sign < 0 ? 4 : 6;
    const b = a + 1;
    polyline(out, bend({ x: sign * 52, z: roadZ(2, sign * 52) }, { x: sign * 62, z: 80 }, { x: sign * 70, z: 66 }, 8), r);
    polyline(out, bend({ x: sign * 70, z: 66 }, { x: sign * 72, z: 64 }, door(a), 3), r * 0.8);
    polyline(out, bend({ x: sign * 70, z: 66 }, { x: sign * 80, z: 70 }, door(b), 5), r * 0.8);
  }
  void base;
  return out;
}

/** 구역 안의 길 (구역 가운데 기준, 다리로 가는 길은 빼고) */
const BASE_PATHS = buildPaths();
export const ZONE_PATHS: readonly PathSeg[] = [...BASE_PATHS, ...buildCornerPaths(BASE_PATHS)];

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
 * 섬 네 모서리에 붙인 땅 (2026-11-15). 주민들의 집, 동굴 산, 바위 언덕이 있다.
 * 0: 북서(동굴 산), 1: 북동(장터), 2: 남서(바닷가), 3: 남동(정원)
 */
export const CORNERS: ReadonlyArray<{ x: number; z: number; rx: number; rz: number }> = [
  { x: -79, z: -65, rx: 19, rz: 17 },
  { x: 79, z: -65, rx: 19, rz: 17 },
  { x: -79, z: 65, rx: 19, rz: 17 },
  { x: 79, z: 65, rx: 19, rz: 17 },
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
  for (const c of CORNERS) {
    const q = Math.hypot((lx - c.x) / c.rx, (lz - c.z) / c.rz);
    if (q < 1.8) d = smoothUnion(d, (1 - q) * Math.min(c.rx, c.rz), 7);
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
  // 섬 모서리: 주민 집 (seed = 집 번호), 동굴 산, 바위 언덕, 집 앞 등불
  HOME_SPOTS.forEach((h, i) => {
    out.push({ kind: 'npcHome', x: h.x, z: h.z, rot: h.rot, scale: 1, seed: i });
    const d = homeDoor(h, 2.6);
    add('lantern', d.x + Math.cos(h.rot) * 1.6, d.z - Math.sin(h.rot) * 1.6);
  });
  out.push({ kind: 'caveHill', x: CAVE_HILL.x, z: CAVE_HILL.z, rot: CAVE_HILL.rot, scale: 1, seed: 7 });
  add('lantern', CAVE_MOUTH.x + Math.cos(CAVE_HILL.rot) * 2.2, CAVE_MOUTH.z - Math.sin(CAVE_HILL.rot) * 2.2);
  add('lantern', CAVE_MOUTH.x - Math.cos(CAVE_HILL.rot) * 2.2, CAVE_MOUTH.z + Math.sin(CAVE_HILL.rot) * 2.2);
  for (const hl of HILLS) out.push({ kind: 'hill', x: hl.x, z: hl.z, rot: hl.seed * 1.7, scale: hl.r, seed: hl.seed });
  // 마을 광장
  {
    const T = TOWN_SQUARE;
    out.push({ kind: 'townBoard', x: T.board.x, z: T.board.z, rot: T.board.rot, scale: 1, seed: 1 });
    T.stalls.forEach((st, i) => out.push({ kind: 'stall', x: st.x, z: st.z, rot: st.rot, scale: 1, seed: i }));
    for (const b of T.benches) add('bench', b.x, b.z, b.rot);
    for (const [lx, lz] of T.lanterns) add('lantern', lx, lz);
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
    for (const h of HOME_SPOTS) if (Math.hypot(x - h.x, z - h.z) < 3.6 + margin) return false;
    if (Math.hypot(x - CAVE_HILL.x, z - CAVE_HILL.z) < CAVE_HILL.r + 1.2 + margin) return false;
    if (Math.hypot(x - CAVE_MOUTH.x, z - CAVE_MOUTH.z) < 2.6 + margin) return false;
    for (const hl of HILLS) if (Math.hypot(x - hl.x, z - hl.z) < hl.r + 0.6 + margin) return false;
    if (Math.hypot(x - TOWN_SQUARE.x, z - TOWN_SQUARE.z) < TOWN_SQUARE.r + 1.6 + margin) return false;
    for (const l of LOCAL_SLOTS) if (Math.hypot(x - l.x, z - l.z) < 5.4 + margin) return false;
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
    // 우편함
    at(MAILBOX_LOCAL.x, MAILBOX_LOCAL.z, 0.2, 0.2, 1.1);
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
    else if (s.kind === 'npcHome') box(s.x, s.z, HOME_HALF.x, HOME_HALF.z, s.rot, 3.4, -1, 0.3);
    else if (s.kind === 'caveHill') {
      // 산은 둥근 몸통 여러 개로 막는다 (입구 쪽은 앱이 "동굴 들어가기" 로 안으로 보낸다)
      circle(s.x, s.z, CAVE_HILL.r, 7, CAVE_HILL.r * 0.7);
      for (let k = 0; k < 5; k++) {
        const a = s.rot + Math.PI + (k - 2) * 0.7;
        circle(s.x + Math.sin(a) * 4, s.z + Math.cos(a) * 4, CAVE_HILL.r * 0.6, 6, 0);
      }
    } else if (s.kind === 'hill') circle(s.x, s.z, s.scale * 0.95, 3, s.scale * 0.6);
    else if (s.kind === 'townBoard') box(s.x, s.z, 1.95, 0.32, s.rot, 2.6, -1, 0.2);
    else if (s.kind === 'stall') box(s.x, s.z, 1.35, 0.75, s.rot, 2.4, -1, 0.2);
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

// ───────────── 부두와 낚시터 (작업 5) ─────────────

/** 1구역 부두의 절반 폭과 상판 높이 (바다 수면이 0) */
export const DOCK_HALF_W = 0.95;
export const DOCK_DECK_Y = 0.5;
/** 부두가 섬에서 시작하는 z (구역 가운데 기준). World 가 부두를 놓는 자리와 같다 */
export const DOCK_START_Z = ZONE.halfZ + 3.4;

/** 1구역 부두의 범위 (세계 좌표). z0 이 섬 쪽, z1 이 바다 쪽 끝 */
export function dockArea(): { x: number; z0: number; z1: number } {
  const c = zoneCenter(0);
  return { x: c.x + HARBOR.x, z0: c.z + DOCK_START_Z, z1: c.z + DOCK_START_Z + HARBOR.dockLength };
}

/** (x, z) 가 부두 상판 위인가 (걸어 다닐 수 있는 곳) */
export function onDock(x: number, z: number): boolean {
  const d = dockArea();
  return Math.abs(x - d.x) <= DOCK_HALF_W && z >= d.z0 - 0.3 && z <= d.z1;
}

/** 낚시할 수 있는 자리. (x, z) 는 찌를 던질 물 위의 자리 */
export interface FishingSpot {
  kind: 'pond' | 'pier';
  x: number;
  z: number;
}

/** 연못 가장자리에서 이 거리 안이면 낚시할 수 있다 */
export const POND_FISH_REACH = 2.3;
/** 부두에서 낚시할 수 있는 곳: 섬 쪽 끝에서 이만큼 지나 물 위로 나온 뒤부터 */
const PIER_FISH_FROM = 3.2;

/**
 * (x, z) 에서 낚시할 수 있으면 그 낚시터를, 아니면 null 을 돌려준다.
 * - 연못: 연못 가운데에서 POND_R + POND_FISH_REACH 안
 * - 부두: 1구역 항구 부두 위에서 물 위로 나온 곳 (끝 쪽이면 앞바다로, 아니면 가까운 옆 바다로 던진다)
 */
export function fishingSpotAt(x: number, z: number): FishingSpot | null {
  const d = dockArea();
  if (onDock(x, z) && z >= d.z0 + PIER_FISH_FROM) {
    if (z > d.z1 - 1.5) return { kind: 'pier', x: clamp(x, d.x - 0.4, d.x + 0.4), z: d.z1 + 2.1 };
    return { kind: 'pier', x: d.x + (x >= d.x ? 1 : -1) * (DOCK_HALF_W + 1.9), z };
  }
  const zone = zoneAt(x, z);
  if (zone < 0) return null;
  const c = zoneCenter(zone);
  for (const nb of NEIGHBORHOODS) {
    if (nb.feature !== 'pond') continue;
    const px = c.x + nb.x;
    const pz = c.z + nb.z;
    const dist = Math.hypot(x - px, z - pz);
    if (dist > POND_R + POND_FISH_REACH) continue;
    // 고양이에서 연못 가운데 쪽으로 2.2 앞, 단 연못 물 안쪽에 떨어지게
    const reach = Math.max(0, Math.min(POND_R - 1.1, dist - 2.2));
    const k = dist > 1e-3 ? reach / dist : 0;
    return { kind: 'pond', x: px + (x - px) * k, z: pz + (z - pz) * k };
  }
  return null;
}

// ───────────── 섬 모서리 (세계 좌표로, 앱과 지도용) ─────────────

/** 열린 구역들의 주민 집 (id = 구역 * 8 + 순번). door 는 문 앞 (가까이 가면 들어갈 수 있다), stand 는 주인이 서 있을 자리 */
export function npcHomes(zoneCount: number): Array<{ id: number; zone: number; index: number; x: number; z: number; rot: number; door: { x: number; z: number }; stand: { x: number; z: number } }> {
  const out = [];
  for (let zone = 0; zone < Math.max(1, zoneCount); zone++) {
    const c = zoneCenter(zone);
    for (let i = 0; i < HOME_SPOTS.length; i++) {
      const h = HOME_SPOTS[i];
      const d = homeDoor(h, HOME_DOOR + 0.5);
      const side = homeDoor(h, HOME_DOOR + 1.4);
      out.push({
        id: zone * HOME_SPOTS.length + i,
        zone,
        index: i,
        x: c.x + h.x,
        z: c.z + h.z,
        rot: h.rot,
        door: { x: c.x + d.x, z: c.z + d.z },
        stand: { x: c.x + side.x + Math.cos(h.rot) * 2.2, z: c.z + side.z - Math.sin(h.rot) * 2.2 },
      });
    }
  }
  return out;
}

/** 열린 구역들의 동굴 입구 (세계 좌표). rot 은 입구가 보는 쪽 */
export function caveMouths(zoneCount: number): Array<{ zone: number; x: number; z: number; rot: number; hillX: number; hillZ: number; r: number }> {
  const out = [];
  for (let zone = 0; zone < Math.max(1, zoneCount); zone++) {
    const c = zoneCenter(zone);
    out.push({ zone, x: c.x + CAVE_MOUTH.x, z: c.z + CAVE_MOUTH.z, rot: CAVE_HILL.rot, hillX: c.x + CAVE_HILL.x, hillZ: c.z + CAVE_HILL.z, r: CAVE_HILL.r });
  }
  return out;
}

/** 지도에 그릴 바위 언덕과 연못 (세계 좌표) */
export function mapHills(zoneCount: number): { hills: Array<{ x: number; z: number; r: number }>; ponds: Array<{ x: number; z: number; r: number }> } {
  const hills = [];
  const ponds = [];
  for (let zone = 0; zone < Math.max(1, zoneCount); zone++) {
    const c = zoneCenter(zone);
    for (const h of HILLS) hills.push({ x: c.x + h.x, z: c.z + h.z, r: h.r });
    for (const nb of NEIGHBORHOODS) if (nb.feature === 'pond') ponds.push({ x: c.x + nb.x, z: c.z + nb.z, r: POND_R });
  }
  return { hills, ponds };
}

/** 열린 구역의 마을 광장 (세계 좌표) */
export function townSquares(zoneCount: number): Array<{
  zone: number;
  x: number;
  z: number;
  r: number;
  board: { x: number; z: number; rot: number };
  mayor: { x: number; z: number };
  stalls: Array<{ kind: 'shop' | 'arcade'; x: number; z: number; rot: number; front: { x: number; z: number } }>;
}> {
  const out = [];
  for (let zone = 0; zone < Math.max(1, zoneCount); zone++) {
    const c = zoneCenter(zone);
    const T = TOWN_SQUARE;
    out.push({
      zone,
      x: c.x + T.x,
      z: c.z + T.z,
      r: T.r,
      board: { x: c.x + T.board.x, z: c.z + T.board.z, rot: T.board.rot },
      mayor: { x: c.x + T.mayor.x, z: c.z + T.mayor.z },
      stalls: T.stalls.map((st) => {
        const f = stallFront(st);
        return { kind: st.kind, x: c.x + st.x, z: c.z + st.z, rot: st.rot, front: { x: c.x + f.x, z: c.z + f.z } };
      }),
    });
  }
  return out;
}

/** (x, z) 둘레 reach 안의 가장 가까운 벤치 (세계 좌표, rot 은 앉는 쪽이 보는 방향). 없으면 null */
export function benchNear(x: number, z: number, reach = 1.8): { x: number; z: number; rot: number } | null {
  const zone = zoneAt(x, z);
  if (zone < 0) return null;
  const c = zoneCenter(zone);
  let best: { x: number; z: number; rot: number } | null = null;
  let bestD = reach;
  for (const s of ZONE_SCENERY) {
    if (s.kind !== 'bench') continue;
    const d = Math.hypot(c.x + s.x - x, c.z + s.z - z);
    if (d < bestD) {
      bestD = d;
      best = { x: c.x + s.x, z: c.z + s.z, rot: s.rot };
    }
  }
  return best;
}

// ───────────── 길 찾기용 (2026-11-15, 앱의 지도 길 안내) ─────────────

const costNear: Collider[] = [];
/** 구역 장식 안의 길 자리 (1 단위 칸, 구역 가운데 기준). 처음 부를 때 한 번 만든다 */
let pathMask: Uint8Array | null = null;
const MASK_W = Math.ceil(ZONE.halfX * 2) + 2;
const MASK_H = Math.ceil(ZONE.halfZ * 2) + 2;
function buildPathMask() {
  const m = new Uint8Array(MASK_W * MASK_H);
  for (const s of ZONE_PATHS) {
    const x0 = Math.floor(Math.min(s.ax, s.bx) - s.r - 1);
    const x1 = Math.ceil(Math.max(s.ax, s.bx) + s.r + 1);
    const z0 = Math.floor(Math.min(s.az, s.bz) - s.r - 1);
    const z1 = Math.ceil(Math.max(s.az, s.bz) + s.r + 1);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (segDist(x, z, s) > 0.4) continue;
        const gx = x + Math.ceil(ZONE.halfX) + 1;
        const gz = z + Math.ceil(ZONE.halfZ) + 1;
        if (gx >= 0 && gz >= 0 && gx < MASK_W && gz < MASK_H) m[gz * MASK_W + gx] = 1;
      }
  }
  return m;
}

/**
 * (x, z) 를 걸어서 지나는 비용 (세계 좌표). 걸을 수 없으면 Infinity, 길 위는 싸게(0.55), 풀밭은 1, 다리와 부두는 0.7.
 * hasHouse: 그 번지에 집이 있는지 (빈 자리의 집/울타리는 막지 않는다). pad: 막힌 것에서 띄울 거리
 */
export function walkCost(x: number, z: number, zoneCount: number, hasHouse: (houseNo: number) => boolean, pad = 0.55): number {
  for (let k = 1; k < zoneCount; k++) {
    const b = bridgeOf(k);
    if (!b) continue;
    const along = b.axis === 'x' ? x - b.x : z - b.z;
    const across = b.axis === 'x' ? z - b.z : x - b.x;
    if (Math.abs(along) < BRIDGE.length / 2 && Math.abs(across) < BRIDGE.width / 2 - 0.25) return 0.7;
  }
  if (onDock(x, z)) return 0.7;
  const zone = zoneAt(x, z);
  if (zone < 0 || zone >= Math.max(1, zoneCount)) return Infinity;
  const c = zoneCenter(zone);
  const lx = x - c.x;
  const lz = z - c.z;
  if (zoneLandLocal(zone, lx, lz) < 0.7) return Infinity;
  for (const col of collidersNear(lx, lz, pad + 0.3, costNear)) {
    if (col.lot >= 0 && !hasHouse(zone * ZONE_CAPACITY + col.lot + 1)) continue;
    const dx = lx - col.x;
    const dz = lz - col.z;
    if (col.r > 0) {
      if (Math.hypot(dx, dz) < col.r + pad) return Infinity;
    } else if (Math.abs(dx * col.cos - dz * col.sin) < col.hx + pad && Math.abs(dx * col.sin + dz * col.cos) < col.hz + pad) return Infinity;
  }
  pathMask ??= buildPathMask();
  const gx = Math.round(lx) + Math.ceil(ZONE.halfX) + 1;
  const gz = Math.round(lz) + Math.ceil(ZONE.halfZ) + 1;
  if (gx >= 0 && gz >= 0 && gx < MASK_W && gz < MASK_H && pathMask[gz * MASK_W + gx]) return 0.55;
  return 1;
}
