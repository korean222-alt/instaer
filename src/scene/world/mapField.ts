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
/** 지도에 그릴 섬 하나 */
export interface ZoneShape {
  /** 이 섬이 차지하는 범위 (세계 좌표). 이 범위 밖은 전부 바다로 본다 */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 해안까지의 거리. 땅 안쪽이 +, 바다가 - (세계 좌표) */
  land: (x: number, z: number) => number;
  paths: PathSeg[];
  plazas: Plaza[];
  /** 아직 열리지 않은 구역 (안개 낀 색으로 칠한다) */
  locked: boolean;
}

function segDist(px: number, pz: number, s: PathSeg): number {
  const vx = s.bx - s.ax;
  const vz = s.bz - s.az;
  const wx = px - s.ax;
  const wz = pz - s.az;
  const t = clamp((wx * vx + wz * vz) / Math.max(1e-6, vx * vx + vz * vz), 0, 1);
  return Math.hypot(wx - vx * t, wz - vz * t) - s.r;
}

/** 텍스처 한 칸이 담는 실제 길이의 목표값 */
const TEXEL = 0.42;

export class MapField {
  readonly zones: ZoneShape[];
  readonly texture: THREE.DataTexture;
  readonly minX: number;
  readonly minZ: number;
  /** 정사각형 지도 한 변 길이 */
  readonly size: number;
  readonly res: number;

  constructor(zones: ZoneShape[]) {
    this.zones = zones;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const z of zones) {
      minX = Math.min(minX, z.minX);
      maxX = Math.max(maxX, z.maxX);
      minZ = Math.min(minZ, z.minZ);
      maxZ = Math.max(maxZ, z.maxZ);
    }
    const margin = 12;
    const size = Math.max(maxX - minX, maxZ - minZ) + margin * 2;
    this.size = size;
    this.minX = (minX + maxX) / 2 - size / 2;
    this.minZ = (minZ + maxZ) / 2 - size / 2;
    let res = 256;
    while (res < 2048 && size / res > TEXEL) res *= 2;
    this.res = res;

    const n = res;
    const data = new Uint8Array(n * n * 4);
    // 기본값: 전부 바다 (거리 -최대), 잠김 없음
    for (let i = 0; i < n * n; i++) {
      data[i * 4] = 1;
      data[i * 4 + 1] = 1;
      data[i * 4 + 2] = 1;
      data[i * 4 + 3] = 255;
    }
    const texel = size / n;
    // 섬마다 자기 범위만 칠한다 (전체를 훑지 않아서 섬이 많아도 빠르다)
    for (const zone of zones) {
      const i0 = Math.max(2, Math.floor((zone.minX - this.minX) / texel));
      const i1 = Math.min(n - 3, Math.ceil((zone.maxX - this.minX) / texel));
      const j0 = Math.max(2, Math.floor((zone.minZ - this.minZ) / texel));
      const j1 = Math.min(n - 3, Math.ceil((zone.maxZ - this.minZ) / texel));
      for (let j = j0; j <= j1; j++) {
        const z = this.minZ + (j + 0.5) * texel;
        for (let i = i0; i <= i1; i++) {
          const x = this.minX + (i + 0.5) * texel;
          const o = (j * n + i) * 4;
          const land = zone.land(x, z);
          data[o] = Math.round(clamp(land / LAND_RANGE, -1, 1) * 127 + 128);
          if (land > 0) {
            let dp = Infinity;
            for (const s of zone.paths) dp = Math.min(dp, segDist(x, z, s));
            data[o + 1] = Math.round(clamp(-dp / PATH_RANGE, -1, 1) * 127 + 128);
            let dq = Infinity;
            for (const p of zone.plazas) dq = Math.min(dq, Math.hypot(x - p.x, z - p.z) - p.r);
            data[o + 2] = Math.round(clamp(-dq / PATH_RANGE, -1, 1) * 127 + 128);
          }
          data[o + 3] = zone.locked ? 0 : 255;
        }
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

  private zoneOf(x: number, z: number): ZoneShape | null {
    for (const zone of this.zones) {
      if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) return zone;
    }
    return null;
  }

  /** 해안까지의 거리 (안쪽 +) */
  landAt(x: number, z: number): number {
    const zone = this.zoneOf(x, z);
    return zone ? zone.land(x, z) : -LAND_RANGE;
  }
  /** 땅 높이 (바다 수면이 0) */
  heightAt(x: number, z: number): number {
    return heightFromLand(this.landAt(x, z));
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
