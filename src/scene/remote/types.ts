// 다른 유저 표시(작업 3a)에 쓰는 타입.
// CLAUDE.md "공통 타입"에 적힌 모양 그대로다. 원래 자리는 src/shared/types.ts 인데
// 아직 그 파일에 없어서(공통 폴더는 앱 쪽 담당) 씬 안에 임시로 둔다.
// 앱 쪽 파일에 생기면 이 파일을 지우고 그쪽에서 가져온다. → README-scene.md "요청"
import type { CatLook } from '../../shared/types';

export type PlayerAnim = 'idle' | 'walk' | 'sit' | 'jump';

export interface RemotePlayer {
  /** 유저마다 고정된 값 (접속이 이어지는 동안 바뀌지 않는다) */
  id: string;
  houseNo: number | null;
  /** 인스타 아이디 ('@' 없이) */
  handle: string;
  x: number;
  z: number;
  /** 바라보는 방향 (라디안. 0이면 +z, LocalState.rotY 와 같은 기준) */
  rotY: number;
  anim: PlayerAnim;
  /** null 이면 기본 고양이(치즈) */
  cat: CatLook | null;
}

export interface LocalState {
  x: number;
  z: number;
  rotY: number;
  anim: PlayerAnim;
}
