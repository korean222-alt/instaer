import type { Screen } from './types';

// 단계 A 에서 마당(6x6) 꾸미기와 지붕 색 고르기를 붙인다.
export const decorateScreen: Screen = {
  id: 'decorate',
  title: '마당 꾸미기',
  render(root) {
    root.innerHTML = `
      <p class="empty">입주하면 내 마당에 캣타워, 해먹, 화분 같은<br />꾸미기 아이템을 놓을 수 있어요.</p>
      <a class="btn primary" href="#/move-in">입주하러 가기</a>`;
  },
};
