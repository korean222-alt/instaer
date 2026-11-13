import type { House } from '../../shared/types';
import { valueNoise2 } from '../util/rand';
import type { MapDef, PathSeg } from '../world/mapField';

/**
 * 데모용 작은 섬 하나. (전체 군도 배치는 다음 단계에서 src/scene/layout.ts 로 만든다)
 * 가운데 광장, 그 둘레에 집 5채, 아래쪽에 항구.
 */
export interface DemoSlot {
  houseNo: number;
  /** 마당 한가운데 */
  x: number;
  z: number;
}

export const DEMO_SLOTS: DemoSlot[] = [
  { houseNo: 1, x: 0, z: -9.6 },
  { houseNo: 2, x: -8.6, z: -9.2 },
  { houseNo: 3, x: 8.6, z: -9.2 },
  { houseNo: 4, x: -11.4, z: 1.6 },
  { houseNo: 5, x: 11.4, z: 1.6 },
];

export const DEMO_HOUSES: House[] = [
  {
    houseNo: 1,
    igHandle: 'cat.island',
    roofColor: '#ff8f7a',
    cat: { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' },
    likes: 128,
    isNpc: false,
    verified: true,
  },
  {
    houseNo: 2,
    igHandle: 'mochi_nyang',
    roofColor: '#7cc4f2',
    cat: { fur: '#fffaf2', pattern: 'white', eyeColor: '#6fb7e8' },
    likes: 41,
    isNpc: false,
    verified: true,
  },
  {
    houseNo: 3,
    igHandle: 'bori.the.cat',
    roofColor: '#ffd166',
    cat: { fur: '#f0a04b', pattern: 'calico', eyeColor: '#e0a13a' },
    likes: 77,
    isNpc: false,
    verified: false,
  },
  {
    houseNo: 4,
    igHandle: null,
    roofColor: '#b79cf0',
    cat: { fur: '#a9adb8', pattern: 'gray', eyeColor: '#f0b44a' },
    likes: 0,
    isNpc: true,
    verified: false,
  },
  {
    houseNo: 5,
    igHandle: 'jelly_tuxedo',
    roofColor: '#7fd8b0',
    cat: { fur: '#35323a', pattern: 'tuxedo', eyeColor: '#8fd16a' },
    likes: 19,
    isNpc: false,
    verified: true,
  },
];

export const PLAZA = { x: 0, z: 3.2, r: 3.5 };
export const DOCK = { x: 0, z: 15.4, length: 6.2 };

const R = 0.78;
const PATHS: PathSeg[] = [
  // 광장 → 항구
  { ax: 0, az: 6.2, bx: 0, bz: 14.2, r: R },
  // 광장 → 뒷줄 집들 앞길
  { ax: 0, az: 0.2, bx: 0, bz: -5.6, r: R },
  { ax: -8.6, az: -5.5, bx: 8.6, bz: -5.5, r: R },
  // 광장 → 양옆 집
  { ax: -3, az: 4.2, bx: -6.8, bz: 5.6, r: R },
  { ax: -6.8, az: 5.6, bx: -11.4, bz: 5.6, r: R },
  { ax: 3, az: 4.2, bx: 6.8, bz: 5.6, r: R },
  { ax: 6.8, az: 5.6, bx: 11.4, bz: 5.6, r: R },
];

function sdRoundBox(x: number, z: number, hx: number, hz: number, r: number) {
  const qx = Math.abs(x) - hx + r;
  const qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/** 두 땅덩이를 부드럽게 이어 붙인다 */
function smoothUnion(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

function land(x: number, z: number): number {
  const main = -sdRoundBox(x, z + 2.4, 18.8, 16.2, 12);
  const harbor = 5.2 - Math.hypot(x, z - 13.4);
  let d = smoothUnion(main, harbor, 3.5);
  // 해안선을 울퉁불퉁하게
  d += (valueNoise2(x * 0.15 + 40, z * 0.15 + 40, 5) - 0.5) * 2.6;
  d += (valueNoise2(x * 0.42 + 9, z * 0.42 + 9, 9) - 0.5) * 0.7;
  return d;
}

export const DEMO_MAP: MapDef = {
  minX: -34,
  minZ: -34,
  size: 68,
  res: 256,
  land,
  paths: PATHS,
  plazas: [PLAZA],
};
