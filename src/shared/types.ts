// 공통 타입. 씬(src/scene)은 읽기만 한다.
// (앱 쪽 작업이 아직 없어서 씬 작업에서 지시문의 "공통 약속" 그대로 임시 생성함)

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
  likes: number;
  isNpc: boolean;
  verified: boolean;
}

export type YardItemType =
  | 'cat_tower'
  | 'hammock'
  | 'plant'
  | 'sign'
  | 'fish_rack'
  | 'cushion'
  | 'lantern'
  | 'bench';

export interface YardItem {
  type: YardItemType;
  /** 마당 칸 0~5 */
  x: number;
  /** 마당 칸 0~5 */
  y: number;
  rotation: 0 | 90 | 180 | 270;
}
