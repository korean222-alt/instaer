import * as THREE from 'three';
import { itemDef, type ItemDef } from './catalog';
import type { PlacedItem } from './types';

/**
 * 아이템을 놓는 공간 하나 (어떤 집의 마당, 또는 집 안).
 * 아이템 좌표는 공간 가운데 기준이고, 여기 적힌 값으로 화면 좌표로 옮긴다.
 */
export interface Space {
  kind: 'yard' | 'room';
  houseNo: number;
  /** 공간 가운데의 화면 좌표와 돌아간 각도 */
  ox: number;
  oz: number;
  rot: number;
  cos: number;
  sin: number;
  /** 바닥 높이 */
  y: number;
  /** 아이템을 놓을 수 있는 범위 */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 벽면 위치 (집 안만): 뒤쪽 벽 z = -wall, 왼쪽 벽 x = -wall */
  wall: number;
  /** 놓을 수 없는 네모 (마당의 집 몸체, 집 안의 문 앞) */
  keepOut: ReadonlyArray<{ x: number; z: number; hx: number; hz: number }>;
}

export const ROOM_SIZE = 8;
export const ROOM_HALF = ROOM_SIZE / 2;
export const WALL_HEIGHT = 3.2;

/** 2026-11-16: 넓힌 집 안 (집 넓히기) 의 한 변 절반 */
export const ROOM_HALF_BIG = 5.5;

export function roomSpace(houseNo: number, half = ROOM_HALF): Space {
  const e = half - 0.04;
  return {
    kind: 'room',
    houseNo,
    ox: 0,
    oz: 0,
    rot: 0,
    cos: 1,
    sin: 0,
    y: 0,
    minX: -e,
    maxX: e,
    minZ: -e,
    maxZ: e,
    wall: half,
    keepOut: [{ x: 0, z: half - 0.45, hx: 0.85, hz: 0.5 }],
  };
}

/** half: 마당 한 변의 절반 (기본 3.0, 넓힌 마당 3.6) */
export function yardSpace(houseNo: number, x: number, z: number, rot: number, y: number, half = 3.6): Space {
  const e = half - 0.18;
  return {
    kind: 'yard',
    houseNo,
    ox: x,
    oz: z,
    rot,
    cos: Math.cos(rot),
    sin: Math.sin(rot),
    y,
    minX: -e,
    maxX: e,
    minZ: -e,
    maxZ: half - 0.05,
    wall: 0,
    // 집 몸체와 그 뒤 (마당 칸으로 x 1~4, y 0~2 자리)
    keepOut: [{ x: 0, z: -1.5, hx: 1.6, hz: 1.48 }],
  };
}

/** 공간 좌표 → 화면 좌표 */
export function toWorld(s: Space, lx: number, lz: number, out: { x: number; z: number }) {
  out.x = s.ox + lx * s.cos + lz * s.sin;
  out.z = s.oz - lx * s.sin + lz * s.cos;
  return out;
}

/** 화면 좌표 → 공간 좌표 */
export function toLocal(s: Space, wx: number, wz: number, out: { x: number; z: number }) {
  const dx = wx - s.ox;
  const dz = wz - s.oz;
  out.x = dx * s.cos - dz * s.sin;
  out.z = dx * s.sin + dz * s.cos;
  return out;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/** 아이템을 그릴 행렬 */
export function itemMatrix(s: Space, item: { x: number; z: number; rotY: number }, lift: number, out: THREE.Matrix4): THREE.Matrix4 {
  _q.setFromAxisAngle(_up, s.rot + item.rotY);
  _v.set(s.ox + item.x * s.cos + item.z * s.sin, s.y + lift, s.oz - item.x * s.sin + item.z * s.cos);
  return out.compose(_v, _q, _one);
}

interface Obb {
  x: number;
  z: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
}

function obbOf(item: { x: number; z: number; rotY: number }, def: ItemDef, out: Obb, shrink = 0): Obb {
  out.cos = Math.cos(item.rotY);
  out.sin = Math.sin(item.rotY);
  // 벽에 거는 것은 벽면에서 튀어나온 두께만큼이 자리다
  const off = def.mount === 'wall' ? def.hz : 0;
  out.x = item.x + off * out.sin;
  out.z = item.z + off * out.cos;
  out.hx = def.hx - shrink;
  out.hz = def.hz - shrink;
  return out;
}

/** 돌아간 네모 둘이 겹치는가 (네 축에 비춰 본다) */
function overlaps(a: Obb, b: Obb): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (let i = 0; i < 4; i++) {
    const o = i < 2 ? a : b;
    // 네모의 가로축 (cos, -sin), 세로축 (sin, cos)
    const ax = i % 2 === 0 ? o.cos : o.sin;
    const az = i % 2 === 0 ? -o.sin : o.cos;
    const ra = a.hx * Math.abs(a.cos * ax - a.sin * az) + a.hz * Math.abs(a.sin * ax + a.cos * az);
    const rb = b.hx * Math.abs(b.cos * ax - b.sin * az) + b.hz * Math.abs(b.sin * ax + b.cos * az);
    if (Math.abs(dx * ax + dz * az) >= ra + rb) return false;
  }
  return true;
}

const _a: Obb = { x: 0, z: 0, hx: 0, hz: 0, cos: 1, sin: 0 };
const _b: Obb = { x: 0, z: 0, hx: 0, hz: 0, cos: 1, sin: 0 };
const WALL_EPS = 0.02;

/** 벽에 거는 아이템이 어느 벽에 붙어 있는가. 0=뒤쪽 벽, 1=왼쪽 벽, -1=벽이 아님 */
export function wallOf(s: Space, item: { x: number; z: number; rotY: number }): number {
  if (s.kind !== 'room') return -1;
  if (Math.abs(item.z + s.wall) < WALL_EPS && Math.abs(Math.sin(item.rotY)) < 0.01 && Math.cos(item.rotY) > 0) return 0;
  if (Math.abs(item.x + s.wall) < WALL_EPS && Math.abs(Math.cos(item.rotY)) < 0.01 && Math.sin(item.rotY) > 0) return 1;
  return -1;
}

/**
 * 그 자리에 놓을 수 있는가: 공간 안에 다 들어오고, 못 놓는 자리를 피하고,
 * 같은 층(가구끼리 / 러그끼리 / 벽걸이끼리)의 다른 아이템과 겹치지 않아야 한다.
 */
export function canPlace(s: Space, item: PlacedItem, others: readonly PlacedItem[]): boolean {
  const def = itemDef(item.type);
  if (!Number.isFinite(item.x) || !Number.isFinite(item.z) || !Number.isFinite(item.rotY)) return false;
  // 살짝 맞닿는 것은 봐준다
  const a = obbOf(item, def, _a, 0.015);
  if (def.mount === 'wall') {
    const w = wallOf(s, item);
    if (w < 0) return false;
    const along = w === 0 ? item.x : item.z;
    if (Math.abs(along) > s.wall - def.hx - 0.05) return false;
  } else {
    const ex = a.hx * Math.abs(a.cos) + a.hz * Math.abs(a.sin);
    const ez = a.hx * Math.abs(a.sin) + a.hz * Math.abs(a.cos);
    if (a.x - ex < s.minX || a.x + ex > s.maxX || a.z - ez < s.minZ || a.z + ez > s.maxZ) return false;
    for (const k of s.keepOut) {
      _b.x = k.x;
      _b.z = k.z;
      _b.hx = k.hx;
      _b.hz = k.hz;
      _b.cos = 1;
      _b.sin = 0;
      if (overlaps(a, _b)) return false;
    }
  }
  for (const o of others) {
    if (o.id === item.id) continue;
    const od = itemDef(o.type);
    if (od.mount !== def.mount) continue;
    if (overlaps(a, obbOf(o, od, _b, 0.015))) return false;
  }
  return true;
}

const _ray = new THREE.Ray();
const _box = new THREE.Box3();
const _hit = new THREE.Vector3();

/** 광선(화면 좌표)에 맞은 아이템 중 가장 가까운 것 */
export function pickItem(s: Space, items: readonly PlacedItem[], ray: THREE.Ray): PlacedItem | null {
  let best: PlacedItem | null = null;
  let bestT = Infinity;
  for (const item of items) {
    const def = itemDef(item.type);
    // 광선을 아이템 기준 좌표로 옮겨서 상자와 만나는지 본다
    const r = s.rot + item.rotY;
    const c = Math.cos(r);
    const sn = Math.sin(r);
    const wx = s.ox + item.x * s.cos + item.z * s.sin;
    const wz = s.oz - item.x * s.sin + item.z * s.cos;
    const dx = ray.origin.x - wx;
    const dz = ray.origin.z - wz;
    _ray.origin.set(dx * c - dz * sn, ray.origin.y - s.y, dx * sn + dz * c);
    _ray.direction.set(ray.direction.x * c - ray.direction.z * sn, ray.direction.y, ray.direction.x * sn + ray.direction.z * c);
    // 손가락으로 누르기 쉽게 조금 넉넉하게 잡는다
    const pad = 0.08;
    const y0 = def.y0 ?? 0;
    if (def.mount === 'wall') {
      _box.min.set(-def.hx - pad, y0 - pad, 0);
      _box.max.set(def.hx + pad, y0 + def.height + pad, def.hz * 2 + pad);
    } else {
      _box.min.set(-def.hx - pad, 0, -def.hz - pad);
      _box.max.set(def.hx + pad, Math.max(def.height, 0.12), def.hz + pad);
    }
    if (!_ray.intersectBox(_box, _hit)) continue;
    // 러그는 다른 것에 가려진 것으로 친다 (위에 놓인 가구를 먼저 집는다)
    const t = _hit.distanceTo(_ray.origin) + (def.mount === 'rug' ? 0.6 : 0);
    if (t < bestT) {
      bestT = t;
      best = item;
    }
  }
  return best;
}

/** (2026-11-20) 올라앉는 자리 하나 (화면 좌표) */
export interface SeatSpot {
  id: string;
  type: string;
  label: string;
  kind: 'sit' | 'up';
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** 내려올 자리 (앞쪽) */
  exitX: number;
  exitZ: number;
  /** 찾을 때 잰 거리 */
  dist: number;
}

/** 그 아이템의 올라앉는 자리 (자리가 없는 아이템이면 null). dist 는 0 */
export function seatOf(s: Space, item: PlacedItem): SeatSpot | null {
  const def = itemDef(item.type);
  const st = def.seat;
  if (!st) return null;
  const c = Math.cos(item.rotY);
  const sn = Math.sin(item.rotY);
  const at = toWorld(s, item.x + st.x * c + st.z * sn, item.z - st.x * sn + st.z * c, { x: 0, z: 0 });
  const ez = def.hz + 0.42;
  const ex = toWorld(s, item.x + ez * sn, item.z + ez * c, { x: 0, z: 0 });
  return { id: item.id, type: item.type, label: def.label, kind: st.kind, x: at.x, z: at.z, y: s.y + st.y, yaw: s.rot + item.rotY, exitX: ex.x, exitZ: ex.z, dist: 0 };
}

/** (x, z) 에서 reach 안에 있는 가장 가까운 올라앉는 자리. 아이템 몸체 가장자리까지의 거리로 잰다 */
export function seatNearIn(s: Space, items: readonly PlacedItem[], x: number, z: number, reach: number, best: SeatSpot | null): SeatSpot | null {
  let bestD = best ? best.dist : reach;
  const l = toLocal(s, x, z, _l);
  for (const item of items) {
    const def = itemDef(item.type);
    if (!def.seat) continue;
    const c = Math.cos(item.rotY);
    const sn = Math.sin(item.rotY);
    // 아이템 기준 좌표로 옮겨 네모 가장자리까지 거리
    const dx = l.x - item.x;
    const dz = l.z - item.z;
    const ux = dx * c - dz * sn;
    const uz = dx * sn + dz * c;
    const d = Math.hypot(Math.max(0, Math.abs(ux) - def.hx), Math.max(0, Math.abs(uz) - def.hz));
    if (d >= bestD) continue;
    const spot = seatOf(s, item);
    if (!spot) continue;
    bestD = d;
    spot.dist = d;
    best = spot;
  }
  return best;
}
const _l = { x: 0, z: 0 };

/** 걸어서 못 지나가는 원들을 out 에 담는다 (화면 좌표) */
export function blockersOf(s: Space, items: readonly PlacedItem[], pool: Array<{ x: number; z: number; r: number }>, n: number, out: Array<{ x: number; z: number; r: number }>): number {
  for (const item of items) {
    const def = itemDef(item.type);
    if (!def.block) continue;
    const c = Math.cos(item.rotY);
    const sn = Math.sin(item.rotY);
    for (const [bx, bz, br] of def.block) {
      const lx = item.x + bx * c + bz * sn;
      const lz = item.z - bx * sn + bz * c;
      const b = (pool[n] ??= { x: 0, z: 0, r: 0 });
      n++;
      b.x = s.ox + lx * s.cos + lz * s.sin;
      b.z = s.oz - lx * s.sin + lz * s.cos;
      b.r = br;
      out.push(b);
    }
  }
  return n;
}
