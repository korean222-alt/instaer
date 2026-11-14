import { ZONE_CAPACITY } from '../shared/config';
import type { CatLook, CatPattern, House } from '../shared/types';

// 서버는 입주한 집만 준다. 빈 번지는 앱이 NPC 집으로 채워서 씬에 넘긴다
// (씬은 넘기지 않은 번지를 풀밭으로 그린다).

const NPC_ROOFS = ['#e8c9b0', '#c9d8e0', '#e6dcb8', '#cfe0cc', '#ddd0e4', '#ecd2d2'];
const NPC_CATS: Array<{ pattern: CatPattern; fur: string; eyeColor: string }> = [
  { pattern: 'cheese', fur: '#f4a650', eyeColor: '#7ac36a' },
  { pattern: 'gray', fur: '#a9adb8', eyeColor: '#f0b44a' },
  { pattern: 'white', fur: '#fffaf2', eyeColor: '#6fb7e8' },
  { pattern: 'tuxedo', fur: '#35323a', eyeColor: '#8fd16a' },
  { pattern: 'black', fur: '#34313a', eyeColor: '#f2c94c' },
  { pattern: 'calico', fur: '#f0a04b', eyeColor: '#e0a13a' },
];

/** 번지 번호로 항상 같은 값이 나오게 섞는다 */
function mix(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function npcHouse(houseNo: number): House {
  const r = mix(houseNo);
  const cat: CatLook = { ...NPC_CATS[r % NPC_CATS.length] };
  return {
    houseNo,
    igHandle: null,
    roofColor: NPC_ROOFS[(r >>> 8) % NPC_ROOFS.length],
    region: 'other',
    cat,
    likes: 0,
    isNpc: true,
    verified: false,
  };
}

/** 입주한 집 목록 + 열린 구역의 빈 번지(NPC) */
export function withEmptyLots(lived: House[], unlockedZones: number): House[] {
  const byNo = new Map(lived.map((h) => [h.houseNo, h]));
  const maxNo = Math.max(unlockedZones * ZONE_CAPACITY, ...lived.map((h) => h.houseNo));
  const out: House[] = [];
  for (let no = 1; no <= maxNo; no++) out.push(byNo.get(no) ?? npcHouse(no));
  return out;
}
