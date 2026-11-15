// 동네 가운데에 사는 주민(잡화점, 오락실, 낚시꾼, 정원사)과 빈 집(주민 집) 안의 고양이.
// 씬 작업 5 의 setNpcs 로 그린다 (이름표는 '@' 없이 연두색, 역할마다 모자/소품).
import { neighborhoodArea, POND_R, type SceneNpc } from '../../scene';
import { NEIGHBORHOOD_SIZE, ZONE_CAPACITY } from '../../shared/config';
import { NPC_INFO, residentName, type NpcRole } from '../../shared/economy';
import type { CatLook } from '../../shared/types';

export interface Npc {
  id: string;
  role: NpcRole | 'resident';
  name: string;
  x: number;
  z: number;
  rotY: number;
  cat: CatLook;
  /** 주민 집 고양이면 그 번지 */
  houseNo?: number;
}

const LOOK: Record<NpcRole, CatLook> = {
  shop: { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' },
  arcade: { fur: '#35323a', pattern: 'tuxedo', eyeColor: '#f2c94c' },
  fisher: { fur: '#a9adb8', pattern: 'gray', eyeColor: '#f0b44a' },
  gardener: { fur: '#f0a04b', pattern: 'calico', eyeColor: '#6fb7e8' },
};
const RESIDENT_LOOKS: CatLook[] = [
  { fur: '#fffaf2', pattern: 'white', eyeColor: '#6fb7e8' },
  { fur: '#34313a', pattern: 'black', eyeColor: '#f2c94c' },
  { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' },
  { fur: '#a9adb8', pattern: 'gray', eyeColor: '#f0b44a' },
];

let cachedZones = -1;
let cachedList: Npc[] = [];
/** 연못이 있는 동네 가운데 */
let ponds: Array<{ x: number; z: number }> = [];

/** 열린 구역의 동네 주민 전체 */
export function townNpcs(unlockedZones: number): Npc[] {
  if (unlockedZones === cachedZones) return cachedList;
  cachedZones = unlockedZones;
  const list: Npc[] = [];
  ponds = [];
  const perZone = ZONE_CAPACITY / NEIGHBORHOOD_SIZE;
  for (let z = 0; z < unlockedZones; z++) {
    let plazas = 0;
    for (let i = 0; i < perZone; i++) {
      const n = z * perZone + i;
      const a = neighborhoodArea(n);
      let role: NpcRole;
      let x = a.x;
      let zz = a.z;
      let rotY = 0;
      if (a.feature === 'pond') {
        role = 'fisher';
        ponds.push({ x: a.x, z: a.z });
        x += 1.3;
        zz += POND_R + 0.8;
        rotY = Math.PI; // 연못을 본다
      } else if (a.feature === 'tree') {
        role = 'gardener';
        x -= 2.4;
        zz += 2.6;
        rotY = -0.6;
      } else {
        role = plazas++ % 2 === 0 ? 'shop' : 'arcade';
        x += 2.4;
        zz += 2.1;
        rotY = 0.5;
      }
      list.push({ id: `npc-${role}-${n}`, role, name: `${NPC_INFO[role].title} ${NPC_INFO[role].name}`, x, z: zz, rotY, cat: LOOK[role] });
    }
  }
  cachedList = list;
  return list;
}

export function pondsOf(unlockedZones: number) {
  townNpcs(unlockedZones);
  return ponds;
}

/** 주민 집 안의 고양이 (방 좌표) */
export function residentNpc(houseNo: number): Npc {
  return {
    id: `npc-resident-${houseNo}`,
    role: 'resident',
    name: residentName(houseNo),
    x: 1.5,
    z: -1.2,
    rotY: -0.4,
    cat: RESIDENT_LOOKS[houseNo % RESIDENT_LOOKS.length],
    houseNo,
  };
}

export const toSceneNpc = (n: Npc): SceneNpc => ({ id: n.id, name: n.name, x: n.x, z: n.z, rotY: n.rotY, cat: n.cat, role: n.role });
