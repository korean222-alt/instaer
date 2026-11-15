import { CAT_CHOICES, catLook, EYE_CHOICES, patternLabelOf, snapCatChoice } from '../../shared/catLook';
import { REGIONS } from '../../shared/config';
import { handleProblem, HANDLE_MAX, HANDLE_PROBLEM_TEXT, normalizeHandle } from '../../shared/handle';
import type { CatLook, RegionId } from '../../shared/types';
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

/** 고양이 그림: 씬이 찍어 준 3D 그림, 안 되면 2D 그림 */
function catPic(cat: CatLook, size: number, key: string): string {
  let url = '';
  try {
    url = state.scene.renderCatPreview(cat, size * 2, { pose: 'sit', yaw: 0.45 });
  } catch {
    url = '';
  }
  return url.startsWith('data:image/') ? `<img src="${url}" width="${size}" height="${size}" alt="" />` : catSvg(cat, size, key);
}

function renderForm(root: HTMLElement, ctx: { setTitle(t: string): void }) {
  const options = REGIONS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('');
  // 처음에는 무늬를 하나 골라 두고, 고양이를 직접 고르기 전까지는 아이디를 적으면 그 아이디의 추천 고양이로 바뀐다
  const start = CAT_CHOICES[Math.floor(Math.random() * CAT_CHOICES.length)];
  let cat: CatLook = { pattern: start.pattern, fur: start.furs[0], eyeColor: EYE_CHOICES[0] };
  let touched = false;
  root.innerHTML = `
    <p class="lead">어서 와요! 함께 살 고양이를 먼저 골라 주세요.<br />집 한 채와 고양이 한 마리를 무료로 받고, 집에는 내 인스타 아이디 이름표가 걸려요.</p>
    <section class="cat-pick" aria-label="고양이 고르기">
      <div class="cat-stage" data-stage></div>
      <div class="pick-label">무늬</div>
      <div class="pick-patterns" role="radiogroup" aria-label="무늬">
        ${CAT_CHOICES.map(
          (k) => `<button type="button" class="pick-pattern" role="radio" data-pattern="${k.pattern}">${catPic({ pattern: k.pattern, fur: k.furs[0], eyeColor: EYE_CHOICES[0] }, 56, `pp-${k.pattern}`)}<span>${esc(k.label)}</span></button>`,
        ).join('')}
      </div>
      <div class="pick-label">털 색</div>
      <div class="pick-swatches" data-furs role="radiogroup" aria-label="털 색"></div>
      <div class="pick-label">눈 색</div>
      <div class="pick-swatches" role="radiogroup" aria-label="눈 색">
        ${EYE_CHOICES.map((c) => `<button type="button" class="swatch eye" role="radio" data-eye="${c}" style="--c:${c}" aria-label="눈 색 ${c}"></button>`).join('')}
      </div>
    </section>
    <form class="form" novalidate>
      <label class="field">
        <span>인스타 아이디</span>
        <div class="handle-input"><i>@</i><input name="handle" type="text" inputmode="email" autocomplete="off" autocapitalize="off"
               spellcheck="false" maxlength="${HANDLE_MAX + 1}" placeholder="mochi_nyang" required /></div>
        <small class="hint" data-hint></small>
      </label>
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
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const furs = root.querySelector<HTMLElement>('[data-furs]')!;

  /** 큰 그림, 이름, 고른 표시 다시 그리기 */
  const drawCat = () => {
    const handle = normalizeHandle(input.value);
    const named = input.value.trim() && !handleProblem(handle) ? catLook(handle) : null;
    stage.innerHTML = `<div class="cat-big">${catPic(cat, 150, 'big')}</div>
      <div class="cat-who"><b>${named ? esc(named.name) : '이름은 아이디로 정해져요'}</b>
      <span>${esc(patternLabelOf(cat.pattern))} 고양이${named ? ` · ${esc(named.personality)}` : ''}</span></div>`;
    for (const b of root.querySelectorAll<HTMLElement>('[data-pattern]')) b.setAttribute('aria-checked', String(b.dataset.pattern === cat.pattern));
    const kind = CAT_CHOICES.find((k) => k.pattern === cat.pattern)!;
    furs.innerHTML = kind.furs
      .map((c) => `<button type="button" class="swatch" role="radio" data-fur="${c}" style="--c:${c}" aria-label="털 색 ${c}" aria-checked="${c === cat.fur}"></button>`)
      .join('');
    for (const b of root.querySelectorAll<HTMLElement>('[data-eye]')) b.setAttribute('aria-checked', String(b.dataset.eye === cat.eyeColor));
  };
  root.querySelector('.cat-pick')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pattern], [data-fur], [data-eye]');
    if (!b) return;
    touched = true;
    if (b.dataset.pattern) {
      const kind = CAT_CHOICES.find((k) => k.pattern === b.dataset.pattern)!;
      cat = { ...cat, pattern: kind.pattern, fur: kind.furs[0] };
    } else if (b.dataset.fur) cat = { ...cat, fur: b.dataset.fur };
    else if (b.dataset.eye) cat = { ...cat, eyeColor: b.dataset.eye };
    play('tap');
    drawCat();
  });

  const check = () => {
    const handle = normalizeHandle(input.value);
    const problem = input.value.trim() ? handleProblem(handle) : 'empty';
    hint.textContent = problem && problem !== 'empty' ? HANDLE_PROBLEM_TEXT[problem] : '';
    hint.classList.toggle('bad', !!problem && problem !== 'empty');
    // 고양이를 직접 고르기 전에는 아이디의 추천 고양이를 보여 준다
    if (!problem && !touched) {
      const look = catLook(handle);
      cat = snapCatChoice({ pattern: look.pattern, fur: look.fur, eyeColor: look.eyeColor });
    }
    drawCat();
    button.disabled = !!problem || !select.value;
  };
  input.addEventListener('input', check);
  select.addEventListener('change', check);
  drawCat();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const handle = normalizeHandle(input.value);
    if (handleProblem(handle) || !select.value) return;
    button.disabled = true;
    button.textContent = '입주하는 중...';
    try {
      const hide = form.querySelector<HTMLInputElement>('input[name="hide"]')!.checked;
      const res = await moveIn(handle, select.value as RegionId, hide, cat);
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
