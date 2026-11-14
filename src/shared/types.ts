// 공통 타입. Opus 담당이고 씬(src/scene)은 읽기만 한다. 모양은 CLAUDE.md "공통 타입"과 같다.

import type { REGIONS, YARD_ITEMS } from './config';

/** 지역 id ('seoul', 'busan', ... 'other') */
export type RegionId = (typeof REGIONS)[number]['id'];

export type CatPattern = 'cheese' | 'black' | 'calico' | 'white' | 'gray' | 'tuxedo';

export interface CatLook {
  /** 털 색 (hex, 예: '#f2a65a') */
  fur: string;
  pattern: CatPattern;
  /** 눈 색 (hex) */
  eyeColor: string;
}

export interface House {
  /** 번지 (1부터) */
  houseNo: number;
  igHandle: string | null;
  /** 지붕 색 (hex) */
  roofColor: string;
  cat: CatLook | null;
  /** 지역 (깃발 색) */
  region: RegionId;
  likes: number;
  isNpc: boolean;
  verified: boolean;
}

export type YardItemType = (typeof YARD_ITEMS)[number]['type'];

export interface YardItem {
  type: YardItemType;
  /** 마당 칸 0~5 */
  x: number;
  /** 마당 칸 0~5 */
  y: number;
  rotation: 0 | 90 | 180 | 270;
}

export type PlayerAnim = 'idle' | 'walk' | 'sit' | 'jump';

/** 내 주변의 다른 유저 (실시간) */
export interface RemotePlayer {
  /** 접속이 이어지는 동안 바뀌지 않는 값 */
  id: string;
  houseNo: number | null;
  /** 인스타 아이디 ('@' 없이) */
  handle: string;
  x: number;
  z: number;
  /** 바라보는 방향 (라디안, LocalState.rotY 와 같은 기준) */
  rotY: number;
  anim: PlayerAnim;
  /** null 이면 기본 고양이 */
  cat: House['cat'];
}

/** 걷기 모드에서 내 고양이 상태 */
export interface LocalState {
  x: number;
  z: number;
  rotY: number;
  anim: PlayerAnim;
}
