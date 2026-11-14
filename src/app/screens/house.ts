import { isMaskedHandle } from '../../shared/handle';
import { play } from '../audio/sound';
import { ApiError, like } from '../net/api';
import { go } from '../router';
import { emit, isFounder, regionColor, regionLabel, state } from '../state';
import { catSvg } from '../ui/catSvg';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import type { Screen } from './types';

/** 집을 탭했을 때 아래에서 올라오는 구경 팝업 */
export const houseScreen: Screen = {
  id: 'house',
  title: '집 구경',
  render(root, param, ctx) {
    const no = Number(param);
    const house = state.houses.get(no);
    ctx.setTitle(`${no}번지`);
    if (!house || !house.igHandle) {
      root.innerHTML = `
        <p class="empty">아직 빈 집이에요. 동네 고양이가 대신 지키고 있어요.</p>
        ${state.me ? '' : '<a class="btn primary" href="#/move-in">나도 입주하기</a>'}`;
      return;
    }
    const mine = state.me?.houseNo === no;
    const handle = house.igHandle;
    const items = state.yards.get(no)?.length ?? 0;
    root.innerHTML = `
      <div class="house-head">
        ${house.cat ? catSvg(house.cat, 88, `h${no}`) : ''}
        <div>
          <div class="house-handle">@${esc(handle)}</div>
          <div class="badges">
            <span class="badge-region"><i style="background:${regionColor(house.region)}"></i>${esc(regionLabel(house.region))}</span>
            ${isFounder(no) ? `<span class="badge gold">창립 주민 ${no}번지</span>` : `<span class="badge">${no}번지</span>`}
            ${house.verified ? '<span class="badge ok">인증</span>' : '<span class="badge dim">미인증</span>'}
          </div>
          <div class="house-meta">꾸미기 ${items}개 · 예뻐요 <b data-likes>${house.likes.toLocaleString()}</b></div>
        </div>
      </div>
      <div class="row two">
        ${
          mine
            ? '<a class="btn primary" href="#/decorate">내 마당 꾸미기</a>'
            : '<button class="btn primary" data-act="like"><span aria-hidden="true">♥</span> 예뻐요</button>'
        }
        ${
          isMaskedHandle(handle)
            ? '<span class="btn ghost" aria-disabled="true">아이디 비공개</span>'
            : `<a class="btn" href="https://www.instagram.com/${encodeURIComponent(handle)}/" target="_blank" rel="noopener noreferrer">인스타 보러 가기</a>`
        }
      </div>
      <div class="row-end"><button class="link small" data-act="report">신고하기</button></div>`;

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
    root.querySelector('[data-act="report"]')?.addEventListener('click', () => toast('신고 기능은 곧 열려요. 급하면 인스타 DM 으로 알려 주세요', 3000));
    return () => state.scene.highlightHouse(state.todayTop?.houseNo ?? null);
  },
};

export function openHouse(no: number) {
  state.scene.focusHouse(no);
  go('house', no);
}
