import { CAT_CHOICES, catLook, EYE_CHOICES, patternLabelOf, snapCatChoice } from '../../shared/catLook';
import { FOLLOW_HANDLE, NEIGHBORHOOD_SIZE, REGIONS } from '../../shared/config';
import { handleProblem, HANDLE_MAX, HANDLE_PROBLEM_TEXT, normalizeHandle } from '../../shared/handle';
import type { CatLook, RegionId } from '../../shared/types';
import { play } from '../audio/sound';
import { ApiError, moveIn, saveToken } from '../net/api';
import { go, onRoute } from '../router';
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
    </div>`;
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

// ── 입주 중간 저장: 섬에서 집을 고르러 갔다 와도 적던 내용이 남는다 ──
interface Draft {
  handle: string;
  region: string;
  cat: CatLook | null;
  /** 고양이를 직접 골랐는지 (안 골랐으면 닉네임의 추천 고양이) */
  touched: boolean;
  /** 고른 빈 집. null 이면 빈 집 중 앞 번호 */
  houseNo: number | null;
}
const draft: Draft = { handle: '', region: '', cat: null, touched: false, houseNo: null };

// ── 팔로우 부탁 (soft): 팔로우 여부는 확인하지 않는다. 인스타 메시지 API 는 사업자 인증이 있어야 써서 못 쓴다 ──
const FOLLOW_KEY = 'ci_follow_asked';
function followAsked(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === '1';
  } catch {
    return followAskedMem;
  }
}
let followAskedMem = false;
function markFollowAsked() {
  followAskedMem = true;
  try {
    localStorage.setItem(FOLLOW_KEY, '1');
  } catch {
    /* 저장이 막힌 브라우저: 이 화면에서만 기억 */
  }
}
const followUrl = () => `https://www.instagram.com/${encodeURIComponent(FOLLOW_HANDLE)}/`;

function renderFollow(root: HTMLElement, ctx: { setTitle(t: string): void }) {
  ctx.setTitle('입주하기');
  const h = esc(FOLLOW_HANDLE);
  root.innerHTML = `
    <div class="follow-card">
      <div class="follow-cat">${catPic({ pattern: 'cheese', fur: CAT_CHOICES[0].furs[0], eyeColor: EYE_CHOICES[0] }, 96, 'follow')}</div>
      <p class="lead"><b>입주하려면 먼저 팔로우!</b><br />고양이섬 계정 <b>@${h}</b> 를 팔로우해야 입주할 수 있어요.<br />새 섬이 열리거나 이벤트가 있을 때 여기서 알려 드려요.</p>
      <a class="btn primary" data-act="follow" href="${followUrl()}" target="_blank" rel="noopener noreferrer">@${h} 팔로우하러 가기</a>
      <p class="note">팔로우하고 이 화면으로 돌아오면 고양이와 집을 고를 수 있어요.</p>
    </div>`;
  root.querySelector('[data-act="follow"]')!.addEventListener('click', () => {
    markFollowAsked();
    play('tap');
    // 링크가 먼저 열리게 두고, 곧 입주 화면으로 넘어간다 (인스타 앱에서 돌아오면 입주 화면이 기다리고 있다)
    window.setTimeout(() => root.isConnected && renderForm(root, ctx), 400);
  });
}

// ── 섬에서 빈 집 고르기 ──
let picking = false;
let banner: HTMLElement | null = null;
/** 섬에서 입주할 집을 고르는 중인지 (집 팝업이 "이 집에 입주하기"를 보여 준다) */
export const pickingHouse = () => picking && !state.me;
/** 빈 집 중 가장 앞 번호 (지금 화면이 아는 마을 기준) */
export function firstEmptyHouse(): number {
  let no = 1;
  while (state.houses.has(no)) no++;
  return no;
}
function endPicking() {
  picking = false;
  banner?.remove();
  banner = null;
}
function startPicking() {
  picking = true;
  go('map');
  state.scene.focusHouse(draft.houseNo ?? firstEmptyHouse());
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'pick-banner';
    banner.innerHTML = '<span>입주할 <b>빈 집</b>을 눌러 주세요</span><button type="button">취소</button>';
    banner.querySelector('button')!.addEventListener('click', () => {
      play('tap');
      endPicking();
      go('move-in');
    });
    document.getElementById('app')!.appendChild(banner);
  }
}
/** 집 팝업에서 "이 집에 입주하기" */
export function chooseHouse(no: number) {
  draft.houseNo = no;
  endPicking();
  play('ding');
  go('move-in');
}
// 지도와 집 팝업 말고 다른 판으로 가면 고르기를 그만둔다
onRoute((r) => {
  if (picking && r.id !== 'map' && r.id !== 'house') endPicking();
});

/** 고른 집 설명: "12번지 · 2번째 동네 · 이웃 3마리" */
function houseInfo(no: number): string {
  const nb = Math.floor((no - 1) / NEIGHBORHOOD_SIZE);
  const lo = nb * NEIGHBORHOOD_SIZE + 1;
  let neighbors = 0;
  for (let n = lo; n < lo + NEIGHBORHOOD_SIZE; n++) if (n !== no && state.houses.has(n)) neighbors++;
  return `<b>${no}번지</b> · ${nb + 1}번째 동네 · ${neighbors ? `이웃 ${neighbors}마리` : '아직 이웃 없음'}`;
}

function renderForm(root: HTMLElement, ctx: { setTitle(t: string): void }) {
  const options = REGIONS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('');
  // 처음에는 무늬를 하나 골라 두고, 고양이를 직접 고르기 전까지는 닉네임을 적으면 그 닉네임의 추천 고양이로 바뀐다
  const start = CAT_CHOICES[Math.floor(Math.random() * CAT_CHOICES.length)];
  let cat: CatLook = draft.cat ?? { pattern: start.pattern, fur: start.furs[0], eyeColor: EYE_CHOICES[0] };
  let touched = draft.touched;
  // 고르는 사이에 다른 사람이 들어간 집이면 다시 고른다
  if (draft.houseNo !== null && state.houses.has(draft.houseNo)) {
    toast(`${draft.houseNo}번지는 방금 다른 고양이가 입주했어요`, 2600);
    draft.houseNo = null;
  }
  root.innerHTML = `
    <p class="lead">어서 와요! 함께 살 고양이를 먼저 골라 주세요.<br />집 한 채와 고양이 한 마리를 무료로 받고, 집에는 내 닉네임 이름표가 걸려요.</p>
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
        <span>닉네임 <small>마음대로 정해요 · 한글, 영문, 숫자, _ · ${HANDLE_MAX}자까지</small></span>
        <input name="handle" type="text" inputmode="text" autocomplete="off" autocapitalize="off"
               spellcheck="false" maxlength="${HANDLE_MAX + 1}" placeholder="모찌냥" required />
        <small class="hint" data-hint></small>
      </label>
      <label class="field">
        <span>사는 지역 <small>한 번 정하면 못 바꿔요</small></span>
        <select name="region" required>
          <option value="" selected disabled>지역을 골라 주세요</option>
          ${options}
        </select>
      </label>
      <div class="field">
        <span>내 집 <small>섬에서 빈 집을 직접 고를 수 있어요</small></span>
        <div class="house-pick">
          <div class="house-pick-info" data-house-info></div>
          <button type="button" class="btn small" data-act="pick">섬에서 고르기</button>
        </div>
      </div>
      <button class="btn primary" type="submit" disabled>입주하기</button>
    </form>
    <p class="note">닉네임은 한 고양이만 쓸 수 있어요. 다른 사람이 이미 쓰는 닉네임이면 다른 이름을 써 주세요.</p>`;

  const form = root.querySelector('form')!;
  const input = form.querySelector<HTMLInputElement>('input[name="handle"]')!;
  const select = form.querySelector<HTMLSelectElement>('select')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const hint = form.querySelector<HTMLElement>('[data-hint]')!;
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const furs = root.querySelector<HTMLElement>('[data-furs]')!;
  const houseInfoEl = root.querySelector<HTMLElement>('[data-house-info]')!;
  input.value = draft.handle;
  select.value = draft.region;
  const saveDraft = () => {
    draft.handle = input.value;
    draft.region = select.value;
    draft.cat = cat;
    draft.touched = touched;
  };
  const drawHouse = () => {
    houseInfoEl.innerHTML =
      draft.houseNo !== null
        ? `${houseInfo(draft.houseNo)} <button type="button" class="link small" data-act="auto">자동으로</button>`
        : `빈 집 중 앞 번호로 자동 배정<br /><small>지금이라면 ${houseInfo(firstEmptyHouse())}</small>`;
  };
  drawHouse();
  root.querySelector('.house-pick')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    play('tap');
    saveDraft();
    if (b.dataset.act === 'pick') startPicking();
    else if (b.dataset.act === 'auto') {
      draft.houseNo = null;
      drawHouse();
    }
  });

  /** 큰 그림, 이름, 고른 표시 다시 그리기 */
  const drawCat = () => {
    const handle = normalizeHandle(input.value);
    const named = input.value.trim() && !handleProblem(handle) ? catLook(handle) : null;
    stage.innerHTML = `<div class="cat-big">${catPic(cat, 150, 'big')}</div>
      <div class="cat-who"><b>${named ? esc(named.name) : '고양이 이름은 닉네임으로 정해져요'}</b>
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
    saveDraft();
  });

  const check = () => {
    const handle = normalizeHandle(input.value);
    const problem = input.value.trim() ? handleProblem(handle) : 'empty';
    hint.textContent = problem && problem !== 'empty' ? HANDLE_PROBLEM_TEXT[problem] : '';
    hint.classList.toggle('bad', !!problem && problem !== 'empty');
    // 고양이를 직접 고르기 전에는 닉네임의 추천 고양이를 보여 준다
    if (!problem && !touched) {
      const look = catLook(handle);
      cat = snapCatChoice({ pattern: look.pattern, fur: look.fur, eyeColor: look.eyeColor });
    }
    drawCat();
    button.disabled = !!problem || !select.value;
    saveDraft();
  };
  input.addEventListener('input', check);
  select.addEventListener('change', check);
  if (input.value) check();
  else drawCat();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const handle = normalizeHandle(input.value);
    if (handleProblem(handle) || !select.value) return;
    button.disabled = true;
    button.textContent = '입주하는 중...';
    try {
      const res = await moveIn(handle, select.value as RegionId, false, cat, draft.houseNo);
      Object.assign(draft, { handle: '', region: '', cat: null, touched: false, houseNo: null });
      endPicking();
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
      button.textContent = '입주하기';
      if (err instanceof ApiError && (err.code === 'house_taken' || err.code === 'house_locked')) {
        draft.houseNo = null;
        drawHouse();
        check();
        return;
      }
      check();
      hint.textContent = msg;
      hint.classList.add('bad');
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
    if (FOLLOW_HANDLE && !followAsked()) renderFollow(root, ctx);
    else renderForm(root, ctx);
  },
};
