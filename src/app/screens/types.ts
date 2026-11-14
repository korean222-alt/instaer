import type { IslandScene } from '../../scene';
import type { ScreenId } from '../router';

export interface AppContext {
  scene: IslandScene;
}

export interface Screen {
  id: Exclude<ScreenId, 'map'>;
  title: string;
  /** 판 안의 내용을 그린다. 판이 닫힐 때 부를 정리 함수를 돌려줄 수 있다 */
  render(root: HTMLElement, ctx: AppContext): void | (() => void);
}
