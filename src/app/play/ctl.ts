// 화면(판)에서 걷기/꾸미기/미니게임을 부를 수 있게 main.ts 가 만든 것을 여기에 둔다.
import type { Explore } from './explore';
import type { Placement } from './placement';

export const ctl: {
  explore: Explore | null;
  placement: Placement | null;
  /** 생선 받기 시작 */
  arcade: (() => void) | null;
  /** 낚시 시작 */
  fishing: (() => void) | null;
} = { explore: null, placement: null, arcade: null, fishing: null };
