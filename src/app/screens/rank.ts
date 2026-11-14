import type { Screen } from './types';

// 단계 A 에서 GET /api/regions 순위(전체 / 이번 주)를 붙인다.
export const rankScreen: Screen = {
  id: 'rank',
  title: '지역 대항전',
  render(root) {
    root.innerHTML = `
      <div class="tabs" role="tablist">
        <button class="tab on" role="tab" aria-selected="true">전체 입주</button>
        <button class="tab" role="tab" aria-selected="false" disabled>이번 주 신규</button>
      </div>
      <p class="empty">아직 순위가 없어요.<br />첫 입주자가 우리 지역을 1위로 만들어요.</p>`;
  },
};
