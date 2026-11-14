import type { ScreenId } from '../router';

export interface ScreenCtx {
  /** 판 제목 바꾸기 */
  setTitle(title: string): void;
  /** 판 닫기 (지도로) */
  close(): void;
}

export interface Screen {
  id: Exclude<ScreenId, 'map'>;
  title: string;
  /** 판 안의 내용을 그린다. 판이 닫힐 때 부를 정리 함수를 돌려줄 수 있다 */
  render(root: HTMLElement, param: string | null, ctx: ScreenCtx): void | (() => void);
}
