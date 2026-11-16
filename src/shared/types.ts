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

/** 낚시하는 모습의 단계 (씬 setFishing 의 FishingState 와 같은 값) */
export type FishingPose = 'cast' | 'wait' | 'bite' | 'reel' | 'caught';

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
  /** 낚시 중이면 그 단계 (없거나 null 이면 낚시 안 함). 이때 anim 은 'sit' 이다 */
  fishing?: FishingPose | null;
  /** 추고 있는 춤 id (src/shared/social.ts 의 DANCES). 없거나 null 이면 춤 안 춤. 걷는 동안은 씬이 멈춘다 */
  dance?: string | null;
  /** 고양이 자동차 (2026-11-16): 'drive' 운전 중, 'ride' 남의 차 뒷자리 (rideWith 가 운전자 id) */
  car?: 'drive' | 'ride' | null;
  rideWith?: string | null;
}

/** 걷기 모드에서 내 고양이 상태 */
export interface LocalState {
  x: number;
  z: number;
  rotY: number;
  anim: PlayerAnim;
}

// ── 집 안, 자유 배치, 직접 그린 그림 (씬 작업 4 와 같은 모양) ──

/**
 * 자유롭게 놓은 아이템 하나 (마당 또는 집 안).
 * 좌표는 그 공간 가운데가 (0, 0), 단위 미터. 마당은 -3~3, 집 안은 -4~4. +z 가 앞(대문/문 쪽).
 * rotY 는 라디안이고 0 이면 앞(+z)을 본다. 벽걸이는 뒤쪽 벽 z = -4 / 왼쪽 벽 x = -4.
 */
export interface PlacedItem {
  /** 아이템마다 고유한 값 (새로 놓을 때 씬이 만든다) */
  id: string;
  /** 아이템 종류 (config.ts 의 DECOR_ITEMS) */
  type: string;
  x: number;
  z: number;
  rotY: number;
  /** 직접 그린 그림을 붙일 때 (액자, 간판, 러그) */
  drawingId?: string;
}

/** 집 안에 놓는 아이템. 모양은 PlacedItem 과 같다 */
export type InteriorItem = PlacedItem;

/** 직접 그린 그림 한 장: 32x32 픽셀, 16색 */
export interface Drawing {
  id: string;
  /** 픽셀 1024개를 4비트씩 담은 512바이트의 base64 (앞 픽셀이 위쪽 4비트) */
  pixels: string;
  /** 색 16개 (hex) */
  palette: string[];
}

/** 집 한 채의 꾸미기 전체 (마당 + 집 안 + 지붕 그림) */
export interface HouseDecor {
  houseNo: number;
  yard: PlacedItem[];
  room: InteriorItem[];
  /** 'cream' | 'stripe' | 'dots' | '#rrggbb' | 'drawing:그림id' */
  wallpaper: string;
  /** 'wood' | 'tile' | 'carpet' | '#rrggbb' | 'drawing:그림id' */
  floor: string;
  /** 지붕에 붙인 그림 id (없으면 null) */
  roofArt: string | null;
  /** 지붕 뒷면 그림 id (2026-11-16. 없으면 null) */
  roofArtBack?: string | null;
  /** 넓힌 집인지 (집 넓히기, 2026-11-16) */
  big?: boolean;
}
