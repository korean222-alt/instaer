// 화면 품질 설정 (2026-11-17): 자동 / 보통 / 저사양. 폰에만 저장한다.
import type { GraphicsMode, IslandScene } from '../scene';

const KEY = 'ci_gfx';
/** 'auto' 에서 폰이 버거워해서 저사양으로 바뀐 적이 있으면 다음에 열 때 처음부터 저사양 */
const AUTO_LOW_KEY = 'ci_gfx_autolow';

export const GRAPHICS_LABEL: Record<GraphicsMode, string> = { auto: '자동', normal: '보통', low: '저사양' };

export function getGraphicsMode(): GraphicsMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'low' || v === 'normal' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function rememberedAutoLow(): boolean {
  try {
    return localStorage.getItem(AUTO_LOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberAutoLow(on: boolean) {
  try {
    if (on) localStorage.setItem(AUTO_LOW_KEY, '1');
    else localStorage.removeItem(AUTO_LOW_KEY);
  } catch {
    // 저장이 막혀도 이번 실행에서는 그대로 동작한다
  }
}

export function setGraphicsMode(scene: IslandScene, mode: GraphicsMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // 위와 같음
  }
  // 직접 고르면 자동 기억은 지운다 (자동으로 돌아오면 다시 재본다)
  rememberAutoLow(false);
  scene.setGraphicsMode(mode);
}
