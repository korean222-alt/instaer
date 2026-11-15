// 섬 모서리의 주민 집에 사는 주민들 (2026-11-15).
// 구역마다 주민 집 8채: 탐험가 두더지, 잡화점 보리, 오락실 콩이, 낚시꾼 멸치, 정원사 쑥이, 이웃 셋.
// 주민은 자기 집 문 옆에 서 있다가 둘레를 조금 걷는다 (씬 setNpcs). 집 안에 들어가면 그 주민이 안에도 있다.
import { mapHills, npcHomes, type SceneNpc } from '../../scene';
import { homeRole, NPC_INFO, residentName, type HomeRole } from '../../shared/economy';
import type { CatLook } from '../../shared/types';

export interface Npc {
  id: string;
  role: HomeRole;
  name: string;
  x: number;
  z: number;
  rotY: number;
  cat: CatLook;
  /** 사는 주민 집 번호 (npcHomes 의 id) */
  homeId: number;
}

export interface Home {
  id: number;
  role: HomeRole;
  /** 화면에 쓰는 이름 (예: 잡화점 보리네 집) */
  label: string;
  x: number;
  z: number;
  rot: number;
  door: { x: number; z: number };
}

const LOOK: Record<HomeRole, CatLook> = {
  shop: { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' },
  arcade: { fur: '#35323a', pattern: 'tuxedo', eyeColor: '#f2c94c' },
  fisher: { fur: '#a9adb8', pattern: 'gray', eyeColor: '#f0b44a' },
  gardener: { fur: '#f0a04b', pattern: 'calico', eyeColor: '#6fb7e8' },
  explorer: { fur: '#7d6a5e', pattern: 'black', eyeColor: '#f2c94c' },
  resident: { fur: '#fffaf2', pattern: 'white', eyeColor: '#6fb7e8' },
};
const RESIDENT_LOOKS: CatLook[] = [
  { fur: '#fffaf2', pattern: 'white', eyeColor: '#6fb7e8' },
  { fur: '#34313a', pattern: 'black', eyeColor: '#f2c94c' },
  { fur: '#f7c27a', pattern: 'cheese', eyeColor: '#7ac36a' },
  { fur: '#c9ccd4', pattern: 'gray', eyeColor: '#e0a13a' },
];

export const npcName = (role: HomeRole, homeId: number) => (role === 'resident' ? `이웃 ${residentName(homeId)}` : `${NPC_INFO[role].title} ${NPC_INFO[role].name}`);
export const npcLook = (role: HomeRole, homeId: number) => (role === 'resident' ? RESIDENT_LOOKS[homeId % RESIDENT_LOOKS.length] : LOOK[role]);

let cachedZones = -1;
let cachedNpcs: Npc[] = [];
let cachedHomes: Home[] = [];

function build(zones: number) {
  if (zones === cachedZones) return;
  cachedZones = zones;
  cachedHomes = npcHomes(zones).map((h) => {
    const role = homeRole(h.id);
    const owner = role === 'resident' ? `이웃 ${residentName(h.id)}` : NPC_INFO[role].name;
    return { id: h.id, role, label: `${owner}네 집`, x: h.x, z: h.z, rot: h.rot, door: h.door };
  });
  cachedNpcs = npcHomes(zones).map((h) => {
    const role = homeRole(h.id);
    return { id: `npc-${h.id}`, role, name: npcName(role, h.id), x: h.stand.x, z: h.stand.z, rotY: h.rot, cat: npcLook(role, h.id), homeId: h.id };
  });
}

/** 열린 구역의 주민 전체 (섬 좌표) */
export function townNpcs(unlockedZones: number): Npc[] {
  build(unlockedZones);
  return cachedNpcs;
}

/** 열린 구역의 주민 집 전체 */
export function townHomes(unlockedZones: number): Home[] {
  build(unlockedZones);
  return cachedHomes;
}

/** 연못 (지도용) */
export function pondsOf(unlockedZones: number) {
  return mapHills(unlockedZones).ponds;
}

/** 주민 집 안의 주인 고양이 (방 좌표) */
export function homeNpc(homeId: number): Npc {
  const role = homeRole(homeId);
  return { id: `npc-in-${homeId}`, role, name: npcName(role, homeId), x: 1.5, z: -1.2, rotY: -0.4, cat: npcLook(role, homeId), homeId };
}

export const toSceneNpc = (n: Npc): SceneNpc => ({ id: n.id, name: n.name, x: n.x, z: n.z, rotY: n.rotY, cat: n.cat, role: n.role });
