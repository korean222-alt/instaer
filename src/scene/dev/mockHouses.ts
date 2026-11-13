import { REGIONS, ZONE_CAPACITY } from '../../shared/config';
import type { CatLook, CatPattern, House, RegionId, YardItem, YardItemType } from '../../shared/types';
import { mulberry32 } from '../util/rand';

/**
 * 개발/성능 확인용 가짜 집 데이터. 같은 숫자를 넣으면 항상 같은 마을이 나온다.
 *   mockHouses(100)   1구역
 *   mockHouses(1000)  10구역
 *   mockHouses(3000)  30구역
 */
const ROOFS = ['#ff8f7a', '#7cc4f2', '#ffd166', '#7fd8b0', '#b79cf0', '#ff9ec2', '#f6a55c', '#8fd3e8', '#c5e17a', '#f48fb1'];

const CATS: Array<{ pattern: CatPattern; furs: string[]; eyes: string[] }> = [
  { pattern: 'cheese', furs: ['#f4a650', '#f0b060', '#e99a48'], eyes: ['#7ac36a', '#e0a13a'] },
  { pattern: 'black', furs: ['#34313a', '#3a3438'], eyes: ['#f2c94c', '#8fd16a'] },
  { pattern: 'calico', furs: ['#f0a04b', '#eb9a4a'], eyes: ['#e0a13a', '#7ac36a'] },
  { pattern: 'white', furs: ['#fffaf2', '#fbf3e6'], eyes: ['#6fb7e8', '#f0b44a'] },
  { pattern: 'gray', furs: ['#a9adb8', '#9aa0ad', '#b9bcc6'], eyes: ['#f0b44a', '#8fd16a'] },
  { pattern: 'tuxedo', furs: ['#35323a', '#3b363c'], eyes: ['#8fd16a', '#f2c94c'] },
];

const NAME_A = ['mochi', 'bori', 'nabi', 'kong', 'dubu', 'coco', 'haru', 'choco', 'bam', 'dal', 'gaeul', 'tori', 'yuja', 'ggomi', 'ruru', 'somi'];
const NAME_B = ['cat', 'nyang', 'meow', 'home', 'zip', 'daily', 'log', 'jelly', 'island', 'butler', 'mom', 'papa'];

/** 인구가 많은 지역이 더 자주 나오게 */
const REGION_WEIGHT: Partial<Record<RegionId, number>> = { seoul: 9, gyeonggi: 12, busan: 4, incheon: 3, daegu: 3, gyeongnam: 3 };

const ITEM_TYPES: YardItemType[] = ['cat_tower', 'hammock', 'plant', 'sign', 'fish_rack', 'cushion', 'lantern', 'bench'];

function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.floor(rnd() * list.length)];
}

function pickRegion(rnd: () => number): RegionId {
  let total = 0;
  for (const r of REGIONS) total += REGION_WEIGHT[r.id] ?? 1;
  let t = rnd() * total;
  for (const r of REGIONS) {
    t -= REGION_WEIGHT[r.id] ?? 1;
    if (t <= 0) return r.id;
  }
  return 'other';
}

export function mockCat(rnd: () => number): CatLook {
  const kind = pick(rnd, CATS);
  return { pattern: kind.pattern, fur: pick(rnd, kind.furs), eyeColor: pick(rnd, kind.eyes) };
}

/** 집 count 채. 마지막 구역은 빈 집(NPC)으로 채워서 구역이 휑하지 않게 한다 */
export function mockHouses(count: number, seed = 1): House[] {
  const rnd = mulberry32(seed * 9973 + 17);
  const total = Math.ceil(count / ZONE_CAPACITY) * ZONE_CAPACITY;
  const out: House[] = [];
  for (let houseNo = 1; houseNo <= total; houseNo++) {
    // 실제 입주자는 count 명. 그중 일부(약 6%)와 나머지 자리는 빈 집
    const occupied = houseNo <= count && rnd() > 0.06;
    const handle = `${pick(rnd, NAME_A)}_${pick(rnd, NAME_B)}${Math.floor(rnd() * 90 + 10)}`;
    const cat = mockCat(rnd);
    out.push({
      houseNo,
      igHandle: occupied ? handle : null,
      roofColor: pick(rnd, ROOFS),
      cat,
      region: pickRegion(rnd),
      likes: occupied ? Math.floor(rnd() * rnd() * 300) : 0,
      isNpc: !occupied,
      verified: occupied && rnd() > 0.3,
    });
  }
  return out;
}

/** 집 한 채의 가짜 꾸미기 아이템. 집이 서 있는 칸(x 1~4, y 0~2)은 피한다 */
export function mockYardItems(houseNo: number): YardItem[] {
  const rnd = mulberry32(houseNo * 7 + 3);
  const n = Math.floor(rnd() * 5);
  const used = new Set<string>();
  const items: YardItem[] = [];
  for (let i = 0; i < n; i++) {
    const front = rnd() > 0.25;
    const x = front ? Math.floor(rnd() * 6) : rnd() > 0.5 ? 0 : 5;
    const y = front ? 3 + Math.floor(rnd() * 3) : Math.floor(rnd() * 3);
    // 입구 디딤돌 자리는 비워 둔다
    if ((x === 2 || x === 3) && y >= 3) continue;
    const key = `${x},${y}`;
    if (used.has(key)) continue;
    used.add(key);
    items.push({ type: pick(rnd, ITEM_TYPES), x, y, rotation: pick(rnd, [0, 90, 180, 270] as const) });
  }
  return items;
}
