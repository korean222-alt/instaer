import { play } from '../audio/sound';
import { ApiError, like } from '../net/api';
import { go } from '../router';
import { emit, isFounder, regionColor, regionLabel, state } from '../state';
import { catSvg } from '../ui/catSvg';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { chooseHouse, pickingHouse } from './moveIn';
import type { Screen } from './types';
import { mountHouseSocial } from './social';

/** 집을 탭했을 때 아래에서 올라오는 구경 팝업 */
export const houseScreen: Screen = {
  id: 'house',
  title: '집 구경',
  render(root, param, ctx) {
    const no = Number(param);
    const house = state.houses.get(no);
    ctx.setTitle(house?.igHandle ? `${house.igHandle}의 집 · ${no}번지` : `${no}번지`);
    if (!house || !house.igHandle) {
      // 입주 전이면 이 빈 집을 바로 내 집으로 고를 수 있다
      root.innerHTML = `
        <p class="empty">아직 빈 집이에요. 동네 고양이가 대신 지키고 있어요.</p>
        ${state.me ? '' : `<button class="btn primary" data-act="choose">${pickingHouse() ? '이 집으로 할래요' : '이 집에 입주하기'}</button>`}`;
      root.querySelector('[data-act="choose"]')?.addEventListener('click', () => chooseHouse(no));
      state.scene.highlightHouse(no);
      return () => state.scene.highlightHouse(state.todayTop?.houseNo ?? null);
    }
    const mine = state.me?.houseNo === no;
    const handle = house.igHandle;
    const items = state.yards.get(no)?.length ?? 0;
    root.innerHTML = `
      <div class="house-head">
        ${house.cat ? catSvg(house.cat, 88, `h${no}`) : ''}
        <div>
          <div class="house-handle">${esc(handle)}</div>
          <div class="badges">
            <span class="badge-region"><i style="background:${regionColor(house.region)}"></i>${esc(regionLabel(house.region))}</span>
            ${isFounder(no) ? `<span class="badge gold">창립 주민 ${no}번지</span>` : `<span class="badge">${no}번지</span>`}
            ${house.verified ? '<span class="badge ok">인증</span>' : ''}
          </div>
          <div class="house-meta">꾸미기 ${items}개 · 예뻐요 <b data-likes>${house.likes.toLocaleString()}</b></div>
        </div>
      </div>
      <div class="row">
        ${
          mine
            ? '<a class="btn primary" href="#/decorate">내 마당 꾸미기</a>'
            : '<button class="btn primary" data-act="like"><span aria-hidden="true">♥</span> 예뻐요</button>'
        }
      </div>
      <div class="house-social"></div>
      <div class="row-end"><button class="link small" data-act="report">신고하기</button></div>`;
    mountHouseSocial(root.querySelector<HTMLElement>('.house-social')!, no);

    state.scene.highlightHouse(no);
    root.querySelector('[data-act="like"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const res = await like(no);
        if (res.ok) {
          house.likes = res.likes;
          root.querySelector('[data-likes]')!.textContent = res.likes.toLocaleString();
          btn.classList.add('liked');
          play('like');
          toast('예뻐요를 눌렀어요');
          emit();
        } else {
          toast(res.message ?? '오늘은 이미 눌렀어요');
          play('tap');
        }
      } catch (err) {
        toast(err instanceof ApiError ? err.message : '잠시 문제가 생겼어요');
        btn.disabled = false;
      }
    });
    root.querySelector('[data-act="report"]')?.addEventListener('click', () => go('report', no));
    return () => state.scene.highlightHouse(state.todayTop?.houseNo ?? null);
  },
};

export function openHouse(no: number) {
  state.scene.focusHouse(no);
  go('house', no);
}
