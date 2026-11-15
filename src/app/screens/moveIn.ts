import { catLook } from '../../shared/catLook';
import { REGIONS } from '../../shared/config';
import { handleProblem, HANDLE_MAX, HANDLE_PROBLEM_TEXT, normalizeHandle } from '../../shared/handle';
import type { RegionId } from '../../shared/types';
import { play } from '../audio/sound';
import { ApiError, moveIn, saveToken } from '../net/api';
import { go } from '../router';
import { isFounder, refreshRegions, regionLabel, setMe, state } from '../state';
import { mountCard } from '../ui/adoptCard';
import { catSvg } from '../ui/catSvg';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { refreshWallet } from '../wallet';
import type { Screen } from './types';

/** 입주한 사람: 내 입양 카드와 지역 순위 */
function renderMine(root: HTMLElement, justMoved: { rank: number; total: number; toFirst: number } | null) {
  const me = state.me!;
  const handle = me.igHandle ?? '';
  const stat = state.regions?.regions.find((r) => r.id === me.region);
  const rank = justMoved?.rank ?? stat?.rankTotal ?? null;
  const total = justMoved?.total ?? stat?.total ?? null;
  const first = state.regions ? Math.max(...state.regions.regions.map((r) => r.total)) : null;
  const toFirst = justMoved?.toFirst ?? (first !== null && total !== null ? Math.max(0, first - total) : null);
  const label = regionLabel(me.region);

  root.innerHTML = `
    ${justMoved ? `<p class="lead"><b>입주 완료!</b> ${me.houseNo}번지가 내 집이 됐어요.</p>` : ''}
    ${
      rank !== null
        ? `<div class="region-card"><b>${esc(label)} ${rank}위</b><span>${
            rank === 1 ? '우리 지역이 1위예요!' : `1위까지 ${toFirst?.toLocaleString() ?? '?'}마리`
          }</span></div>`
        : ''
    }
    <div id="card-slot"></div>
    <div class="row two">
      <button class="btn" data-act="home">내 집 보러 가기</button>
      <button class="btn" data-act="decorate">마당 꾸미기</button>
    </div>
    ${me.verified ? '' : '<p class="note">지금은 아이디 입력만으로 입주한 <b>미인증</b> 상태예요. 나중에 인스타 DM 으로 본인 확인을 열면 인증 표시가 붙어요.</p>'}`;
  mountCard(root.querySelector('#card-slot')!, {
    handle,
    houseNo: me.houseNo,
    founder: isFounder(me.houseNo),
    region: me.region,
    regionRank: rank,
    regionTotal: total,
  });
  root.querySelector('[data-act="home"]')?.addEventListener('click', () => {
    go('map');
    state.scene.focusHouse(me.houseNo);
  });
  root.querySelector('[data-act="decorate"]')?.addEventListener('click', () => go('decorate'));
}

function renderForm(root: HTMLElement, ctx: { setTitle(t: string): void }) {
  const options = REGIONS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('');
  root.innerHTML = `
    <p class="lead">집 한 채와 고양이 한 마리를 무료로 받아요.<br />집에는 내 인스타 아이디 이름표가 걸려요.</p>
    <form class="form" novalidate>
      <label class="field">
        <span>인스타 아이디</span>
        <div class="handle-input"><i>@</i><input name="handle" type="text" inputmode="email" autocomplete="off" autocapitalize="off"
               spellcheck="false" maxlength="${HANDLE_MAX + 1}" placeholder="mochi_nyang" required /></div>
        <small class="hint" data-hint></small>
      </label>
      <div class="preview" data-preview hidden></div>
      <label class="field">
        <span>사는 지역 <small>한 번 정하면 못 바꿔요</small></span>
        <select name="region" required>
          <option value="" selected disabled>지역을 골라 주세요</option>
          ${options}
        </select>
      </label>
      <label class="check"><input type="checkbox" name="hide" /> <span>인스타 아이디 숨기기<small>다른 사람에게는 가린 아이디(mo***ng)만 보여요. 설정에서 바꿀 수 있어요.</small></span></label>
      <button class="btn primary" type="submit" disabled>입주하기</button>
    </form>
    <p class="note">같은 아이디로는 한 번만 입주할 수 있어요. 남의 아이디로 입주하면 나중에 본인 확인을 열 때 정리될 수 있어요.</p>`;

  const form = root.querySelector('form')!;
  const input = form.querySelector<HTMLInputElement>('input[name="handle"]')!;
  const select = form.querySelector<HTMLSelectElement>('select')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const hint = form.querySelector<HTMLElement>('[data-hint]')!;
  const preview = form.querySelector<HTMLElement>('[data-preview]')!;

  const check = () => {
    const handle = normalizeHandle(input.value);
    const problem = input.value.trim() ? handleProblem(handle) : 'empty';
    hint.textContent = problem && problem !== 'empty' ? HANDLE_PROBLEM_TEXT[problem] : '';
    hint.classList.toggle('bad', !!problem && problem !== 'empty');
    // 입력하는 동안 미리 보는 내 고양이
    if (!problem) {
      const look = catLook(handle);
      preview.hidden = false;
      preview.innerHTML = `${catSvg(look, 64, 'pv')}<div><b>${esc(look.name)}</b><span>${esc(look.patternLabel)} 고양이 · ${esc(look.personality)}</span></div>`;
    } else preview.hidden = true;
    button.disabled = !!problem || !select.value;
  };
  input.addEventListener('input', check);
  select.addEventListener('change', check);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const handle = normalizeHandle(input.value);
    if (handleProblem(handle) || !select.value) return;
    button.disabled = true;
    button.textContent = '입주하는 중...';
    try {
      const hide = form.querySelector<HTMLInputElement>('input[name="hide"]')!.checked;
      const res = await moveIn(handle, select.value as RegionId, hide);
      saveToken(res.token);
      state.hideHandle = res.hideHandle;
      play('fanfare');
      setMe(res.house);
      void refreshWallet();
      refreshRegions();
      state.scene.focusHouse(res.house.houseNo);
      ctx.setTitle('입양 결과');
      renderMine(root, res.region);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '잠시 문제가 생겼어요';
      toast(msg, 3000);
      play('error');
      hint.textContent = msg;
      hint.classList.add('bad');
      button.textContent = '입주하기';
      check();
    }
  });
}

export const moveInScreen: Screen = {
  id: 'move-in',
  title: '입주하기',
  render(root, _param, ctx) {
    if (state.me) {
      ctx.setTitle('내 고양이');
      if (!state.regions) refreshRegions().then(() => state.me && renderMine(root, null));
      renderMine(root, null);
      return;
    }
    if (state.offline) {
      root.innerHTML = '<p class="empty">지금은 서버에 연결할 수 없어서 입주할 수 없어요.<br />잠시 후에 다시 열어 주세요.</p>';
      return;
    }
    renderForm(root, ctx);
  },
};
