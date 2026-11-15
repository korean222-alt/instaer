import { getSoundSettings, play, setSoundSettings } from '../audio/sound';
import type { Screen } from './types';

export const settingsScreen: Screen = {
  id: 'settings',
  title: '설정',
  render(root) {
    const s = getSoundSettings();
    root.innerHTML = `
      <div class="set-group">
        <label class="set-row">
          <span>배경 음악</span>
          <input type="range" min="0" max="100" step="5" value="${Math.round(s.bgm * 100)}" data-k="bgm" aria-label="배경 음악 크기" />
          <output>${Math.round(s.bgm * 100)}</output>
        </label>
        <label class="set-row">
          <span>효과음</span>
          <input type="range" min="0" max="100" step="5" value="${Math.round(s.sfx * 100)}" data-k="sfx" aria-label="효과음 크기" />
          <output>${Math.round(s.sfx * 100)}</output>
        </label>
        <p class="note">아이폰은 옆면 무음 스위치를 켜 두면 소리가 나지 않아요.</p>
      </div>
    `;

    root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
      const out = input.nextElementSibling as HTMLOutputElement;
      input.addEventListener('input', () => {
        out.textContent = input.value;
        setSoundSettings({ [input.dataset.k!]: Number(input.value) / 100 });
      });
      // 효과음 크기를 바꾸면 들려 준다
      if (input.dataset.k === 'sfx') input.addEventListener('change', () => play('tap'));
    });
  },
};
