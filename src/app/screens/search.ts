import { searchHouses } from '../state';
import { esc } from '../ui/dom';
import { openHouse } from './house';
import type { Screen } from './types';

export const searchScreen: Screen = {
  id: 'search',
  title: '집 찾기',
  render(root) {
    root.innerHTML = `
      <label class="field">
        <span>닉네임으로 찾기</span>
        <input type="search" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="닉네임 앞부분만 적어도 돼요" />
      </label>
      <ul class="result-list" aria-live="polite"></ul>`;
    const input = root.querySelector('input')!;
    const list = root.querySelector('ul')!;
    const draw = () => {
      const q = input.value.trim();
      const found = searchHouses(q);
      list.innerHTML = !q
        ? ''
        : found.length
          ? found.map((h) => `<li><button data-no="${h.houseNo}"><b>${esc(h.igHandle ?? '')}</b><span>${h.houseNo}번지</span></button></li>`).join('')
          : '<li class="empty">아직 입주하지 않은 닉네임이에요</li>';
      list.querySelectorAll<HTMLButtonElement>('[data-no]').forEach((b) => b.addEventListener('click', () => openHouse(Number(b.dataset.no))));
    };
    input.addEventListener('input', draw);
    setTimeout(() => input.focus(), 250);
  },
};
