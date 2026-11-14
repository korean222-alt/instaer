import { maskHandle } from '../../shared/handle';
import { getSoundSettings, play, setSoundSettings } from '../audio/sound';
import { ApiError, setPrivacy } from '../net/api';
import { emit, state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import type { Screen } from './types';

export const settingsScreen: Screen = {
  id: 'settings',
  title: '설정',
  render(root) {
    const s = getSoundSettings();
    const me = state.me;
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
      ${
        me
          ? `<div class="set-group">
        <label class="set-row toggle">
          <span>인스타 아이디 숨기기<small>다른 사람에게는 <b data-mask>@${esc(maskHandle(me.igHandle ?? ''))}</b> 처럼 보이고, 아이디 찾기와 "인스타 보러 가기"에서 빠져요.</small></span>
          <input type="checkbox" role="switch" data-k="hide" ${state.hideHandle ? 'checked' : ''} />
        </label>
      </div>`
          : ''
      }`;

    root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
      const out = input.nextElementSibling as HTMLOutputElement;
      input.addEventListener('input', () => {
        out.textContent = input.value;
        setSoundSettings({ [input.dataset.k!]: Number(input.value) / 100 });
      });
      // 효과음 크기를 바꾸면 들려 준다
      if (input.dataset.k === 'sfx') input.addEventListener('change', () => play('tap'));
    });

    const hide = root.querySelector<HTMLInputElement>('input[data-k="hide"]');
    hide?.addEventListener('change', async () => {
      hide.disabled = true;
      try {
        const res = await setPrivacy(hide.checked);
        state.hideHandle = res.hideHandle;
        emit();
        toast(res.hideHandle ? '이제 다른 사람에게 아이디가 가려져 보여요 (1분 안에 반영)' : '아이디가 다시 보여요 (1분 안에 반영)', 3000);
        play('save');
      } catch (err) {
        hide.checked = !hide.checked;
        toast(err instanceof ApiError ? err.message : '바꾸지 못했어요');
        play('error');
      }
      hide.disabled = false;
    });
  },
};
