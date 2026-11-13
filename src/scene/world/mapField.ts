import * as THREE from 'three';
import { clamp, hash01 } from '../util/rand';
import { GROUND_Y, LAND_RANGE, PATH_RANGE } from './constants';

/**
 * 섬 지도. "어디가 땅이고, 어디가 길이고, 어디가 광장인가"를 거리값으로 담는다.
 * 이 값을 작은 텍스처 한 장으로 구워서 땅/바다 셰이더가 같이 읽는다.
 * (색을 꼭짓점이 아니라 거리값으로 정하므로 해안선과 길 가장자리가 매끈하다)
 */
export interface PathSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** 길 반폭 */
  r: number;
}
export interface Plaza {
  x: number;
  z: number;
  r: number;
}
export interface MapDef {
  minX: number;
  minZ: number;
  /** 정사각형 지도 한 변 길이 */
  size: number;
  /** 텍스처 해상도 */
  res: number;
  /** 해안까지의 거리. 땅 안쪽이 +, 바다가 - */
  land: (x: number, z: number) => number;
  paths: PathSeg[];
  plazas: Plaza[];
}

function segDist(px: number, pz: number, s: PathSeg): number {
  const vx = s.bx - s.ax;
  const vz = s.bz - s.az;
  const wx = px - s.ax;
  const wz = pz - s.az;
  const t = clamp((wx * vx + wz * vz) / Math.max(1e-6, vx * vx + vz * vz), 0, 1);
  return Math.hypot(wx - vx * t, wz - vz * t) - s.r;
}

export class MapField {
  readonly def: MapDef;
  readonly texture: THREE.DataTexture;

  constructor(def: MapDef) {
    this.def = def;
    const n = def.res;
    const data = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = def.minX + ((i + 0.5) / n) * def.size;
        const z = def.minZ + ((j + 0.5) / n) * def.size;
        const o = (j * n + i) * 4;
        // 지도 가장자리는 반드시 바다가 되도록
        const border = Math.min(i, j, n - 1 - i, n - 1 - j) < 2;
        const land = border ? -LAND_RANGE : def.land(x, z);
        data[o] = Math.round(clamp(land / LAND_RANGE, -1, 1) * 127 + 128);
        data[o + 1] = Math.round(clamp(this.pathAt(x, z) / PATH_RANGE, -1, 1) * 127 + 128);
        data[o + 2] = Math.round(clamp(this.plazaAt(x, z) / PATH_RANGE, -1, 1) * 127 + 128);
        data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  /** 해안까지의 거리 (안쪽 +) */
  landAt(x: number, z: number): number {
    return this.def.land(x, z);
  }
  /** 길 안쪽이면 + */
  pathAt(x: number, z: number): number {
    let d = Infinity;
    for (const s of this.def.paths) d = Math.min(d, segDist(x, z, s));
    return -d;
  }
  /** 광장 안쪽이면 + */
  plazaAt(x: number, z: number): number {
    let d = Infinity;
    for (const p of this.def.plazas) d = Math.min(d, Math.hypot(x - p.x, z - p.z) - p.r);
    return -d;
  }
  /** 땅 높이 (바다 수면이 0) */
  heightAt(x: number, z: number): number {
    return heightFromLand(this.def.land(x, z));
  }

  dispose() {
    this.texture.dispose();
  }
}

/** 해안 거리 → 높이: 바닷속 → 모래 비탈 → 낮은 턱 → 평평한 풀밭 */
export function heightFromLand(d: number): number {
  if (d >= 3.0) return GROUND_Y;
  if (d >= 2.0) {
    const t = d - 2.0;
    const s = t * t * (3 - 2 * t);
    return 0.27 + (GROUND_Y - 0.27) * s;
  }
  if (d >= 0) return -0.12 + (0.27 + 0.12) * (d / 2.0);
  return Math.max(-0.9, -0.12 + d * 0.22);
}

/**
 * 반복되는 작은 노이즈 텍스처.
 * R, G: 부드러운 얼룩 (서로 다른 모양) / B: 점점이 흩어진 흰 노이즈 / A: 더 큰 얼룩
 */
export function createNoiseTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const tile = (period: number, seed: number) => (x: number, y: number) => {
    const fx = (x / size) * period;
    const fy = (y / size) * period;
    const xi = Math.floor(fx);
    const yi = Math.floor(fy);
    const u0 = fx - xi;
    const v0 = fy - yi;
    const u = u0 * u0 * (3 - 2 * u0);
    const v = v0 * v0 * (3 - 2 * v0);
    const h = (i: number, j: number) => hash01(((i % period) + period) % period + (((j % period) + period) % period) * 977, seed);
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const r1 = tile(8, 11);
  const r2 = tile(16, 12);
  const g1 = tile(6, 21);
  const g2 = tile(20, 22);
  const a1 = tile(4, 31);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      data[o] = Math.round((r1(x, y) * 0.68 + r2(x, y) * 0.32) * 255);
      data[o + 1] = Math.round((g1(x, y) * 0.6 + g2(x, y) * 0.4) * 255);
      data[o + 2] = Math.round(hash01(x + y * size, 77) * 255);
      data[o + 3] = Math.round(a1(x, y) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
