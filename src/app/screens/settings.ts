import { CURRENCY, RENAME_COST } from '../../shared/economy';
import { handleProblem, HANDLE_PROBLEM_TEXT, normalizeHandle } from '../../shared/handle';
import { getSoundSettings, play, setSoundSettings } from '../audio/sound';
import { ApiError, renameMe } from '../net/api';
import { pushHousesToScene, setMe, state } from '../state';
import { GRAPHICS_LABEL, getGraphicsMode, setGraphicsMode } from '../graphics';
import type { GraphicsMode } from '../../scene';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, coins } from '../wallet';
import type { Screen } from './types';

export const settingsScreen: Screen = {
  id: 'settings',
  title: '설정',
  render(root) {
    const s = getSoundSettings();
    const me = state.me;
    root.innerHTML = `
      ${
        me
          ? `<div class="set-group">
        <div class="set-row"><span>내 고양이</span><b>${esc(me.igHandle ?? '')} · ${me.houseNo}번지</b></div>
        <a class="btn" href="#/move-in">내 고양이 입양 카드 보기</a>
        <label class="field"><span>닉네임(= 고양이 이름) 바꾸기 <small>${RENAME_COST} ${CURRENCY} · 지금 ${coins().toLocaleString()} ${CURRENCY}</small></span>
          <input class="input" id="rename" maxlength="12" placeholder="새 닉네임" autocomplete="off" /></label>
        <p class="note" id="rename-hint">한글, 영문, 숫자, 밑줄(_) 12자까지. 다른 고양이와 같은 이름은 안 돼요.</p>
        <button class="btn primary" id="rename-go" ${coins() >= RENAME_COST ? '' : 'disabled'}>${RENAME_COST} ${CURRENCY}로 바꾸기</button>
      </div>`
          : ''
      }
      <div class="set-group">
        <a class="btn" href="#/wish">⭐ 소원 비는 곳 <small>생겼으면 하는 것 적기</small></a>
        <a class="btn" href="#/report">신고하기 <small>내 인스타 아이디를 누가 썼어요 등</small></a>
      </div>
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
      <div class="set-group">
        <div class="set-row toggle"><span>화면 품질<small id="gfx-now"></small></span></div>
        <div class="seg" role="radiogroup" aria-label="화면 품질">
          ${(['auto', 'normal', 'low'] as GraphicsMode[])
            .map((m) => `<button class="seg-btn${getGraphicsMode() === m ? ' on' : ''}" data-gfx="${m}" role="radio" aria-checked="${getGraphicsMode() === m}">${GRAPHICS_LABEL[m]}${m === 'auto' ? ' (추천)' : ''}</button>`)
            .join('')}
        </div>
        <p class="note">폰이 느리거나 뜨거워지면, 저전력 모드에서 끊기면 <b>저사양</b>을 골라 보세요. 그림자를 끄고 해상도를 낮추고 1초에 30번만 그려요. 계단 현상까지 줄이려면 앱을 한 번 다시 열어 주세요.</p>
      </div>
    `;

    const gfxNow = root.querySelector<HTMLElement>('#gfx-now');
    const showGfx = () => {
      const g = state.scene.getGraphicsState();
      if (gfxNow) gfxNow.textContent = g.mode === 'auto' ? `지금: ${g.low ? '저사양' : '보통'}${g.weakDevice ? ' (가벼운 폰으로 보여요)' : ''}` : '';
    };
    showGfx();
    root.querySelectorAll<HTMLButtonElement>('[data-gfx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.gfx as GraphicsMode;
        setGraphicsMode(state.scene, mode);
        root.querySelectorAll<HTMLButtonElement>('[data-gfx]').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
        });
        showGfx();
        play('tap');
      });
    });

    root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
      const out = input.nextElementSibling as HTMLOutputElement;
      input.addEventListener('input', () => {
        out.textContent = input.value;
        setSoundSettings({ [input.dataset.k!]: Number(input.value) / 100 });
      });
      // 효과음 크기를 바꾸면 들려 준다
      if (input.dataset.k === 'sfx') input.addEventListener('change', () => play('tap'));
    });

    const input = root.querySelector<HTMLInputElement>('#rename');
    const hint = root.querySelector<HTMLElement>('#rename-hint');
    const go = root.querySelector<HTMLButtonElement>('#rename-go');
    input?.addEventListener('input', () => {
      const p = input.value.trim() ? handleProblem(normalizeHandle(input.value)) : null;
      if (hint) hint.textContent = p ? HANDLE_PROBLEM_TEXT[p] : '한글, 영문, 숫자, 밑줄(_) 12자까지. 다른 고양이와 같은 이름은 안 돼요.';
    });
    go?.addEventListener('click', async () => {
      if (!input) return;
      const handle = normalizeHandle(input.value);
      const p = handleProblem(handle);
      if (p) {
        play('error');
        toast(HANDLE_PROBLEM_TEXT[p]);
        return;
      }
      if (!confirm(`닉네임과 고양이 이름을 '${handle}'(으)로 바꿀까요? ${RENAME_COST} ${CURRENCY}가 들어요`)) return;
      go.disabled = true;
      try {
        const res = await renameMe(handle);
        applyWallet(res.wallet, { silent: true });
        setMe(res.house);
        pushHousesToScene();
        play('fanfare');
        toast(`이제 '${handle}' 고양이예요`);
        settingsScreen.render(root, null, { setTitle: () => {}, close: () => {} });
      } catch (err) {
        play('error');
        toast(err instanceof ApiError ? err.message : '바꾸지 못했어요');
        go.disabled = false;
      }
    });
  },
};
