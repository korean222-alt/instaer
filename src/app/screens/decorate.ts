// 꾸미기 탭: 마당/집 안 꾸미기 시작, 지붕(색 + 직접 그린 그림), 내 그림, 상점으로 가기.
import { DRAWING_MAX, ROOF_COLORS } from '../../shared/config';
import { CURRENCY } from '../../shared/economy';
import { forgetMyDrawing, loadMyDrawings, myDrawingList, sceneHasRoofArt, syncArt } from '../art';
import { play } from '../audio/sound';
import { ApiError, deleteDrawing, saveDecor } from '../net/api';
import { ctl } from '../play/ctl';
import { pushHousesToScene, setMe, setMyRoofArt, state } from '../state';
import { drawingThumb, drawingUrl } from '../ui/drawingThumb';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, coins, refreshWallet } from '../wallet';
import { openDrawEditor } from './draw';
import { coinIcon } from './shop';
import type { Screen } from './types';

export const decorateScreen: Screen = {
  id: 'decorate',
  title: '꾸미기',
  render(root, param, ctx) {
    const me = state.me;
    if (!me) {
      root.innerHTML = `
        <p class="empty">입주하면 마당과 집 안을 손가락으로 끌어서 꾸미고,<br />직접 그린 그림을 지붕과 액자에 붙일 수 있어요.</p>
        <a class="btn primary" href="#/move-in">입주하러 가기</a>`;
      return;
    }
    // 집 안에서 "집 안 꾸미기" 를 누르면 바로 꾸미기 모드로
    if (param === 'room' || param === 'yard') {
      ctx.close();
      void ctl.placement?.start(param);
      return;
    }
    const houseNo = me.houseNo;
    if (!ctl.explore?.walking()) state.scene.focusHouse(houseNo);
    let selected: string | null = null;
    let busy = false;

    const roofArt = () => state.roofArt.get(houseNo) ?? null;
    const draw = () => {
      const list = myDrawingList();
      const art = roofArt();
      const artD = art ? list.find((d) => d.id === art) : null;
      const sel = selected ? list.find((d) => d.id === selected) : null;
      root.innerHTML = `
        <div class="coin-card">${coinIcon()}<b>${coins().toLocaleString()}</b><span>${CURRENCY}</span>
          <a class="link" href="#/shop">상점</a><a class="link" href="#/quests">퀘스트</a></div>
        <div class="row two">
          <button class="btn primary" data-act="yard">마당 꾸미기</button>
          <button class="btn primary" data-act="room">집 안 꾸미기</button>
        </div>
        <p class="note">섬 화면에서 아이템을 손가락으로 끌어서 놓아요. 집 안은 걷기 모드로 들어가요.</p>

        <h3 class="sec">지붕</h3>
        <div class="roof-preview" style="--roof:${me.roofColor}">
          <div class="roof">${artD ? `<img class="pixel" src="${drawingUrl(artD)}" alt="지붕 그림" />` : ''}</div><div class="wall"></div>
        </div>
        <div class="swatches">
          ${ROOF_COLORS.map((c) => `<button class="swatch${c === me.roofColor ? ' on' : ''}" data-roof="${c}" style="background:${c}" aria-label="지붕 색 ${c}" aria-pressed="${c === me.roofColor}"></button>`).join('')}
        </div>
        <div class="field"><span>지붕 그림 <small>내 그림 중 하나를 지붕에 붙여요</small></span></div>
        <div class="art-row wrap">
          <button class="art-pick${!art ? ' on' : ''}" data-roofart="">없음</button>
          ${list.map((d) => `<button class="art-pick${art === d.id ? ' on' : ''}" data-roofart="${esc(d.id)}">${drawingThumb(d, 40)}</button>`).join('')}
          <button class="art-pick new" data-act="roof-new">+ 새로 그리기</button>
        </div>
        ${sceneHasRoofArt() ? '' : '<p class="note">지붕 그림은 저장되고 다른 사람에게도 전해져요. 3D 섬의 지붕에 그려지는 것은 섬 화면 업데이트(Fable 작업 5) 뒤부터예요.</p>'}

        <h3 class="sec">내 그림 <small>${list.length}/${DRAWING_MAX}</small></h3>
        <div class="art-row wrap">
          ${list.map((d) => `<button class="art-pick${selected === d.id ? ' on' : ''}" data-pick="${esc(d.id)}">${drawingThumb(d, 52)}</button>`).join('')}
          <button class="art-pick new big" data-act="new">+ 새 그림</button>
        </div>
        ${
          sel
            ? `<div class="row"><button class="btn small" data-act="copy">따라 그리기</button><button class="btn small" data-act="to-roof">지붕에 붙이기</button><button class="btn small" data-act="del">지우기</button></div>`
            : '<p class="note">그림은 액자, 간판, 러그, 벽지, 바닥에도 붙일 수 있어요(꾸미기 중에 아이템을 고르고 "그림").</p>'
        }`;
    };

    async function patchRoof(patch: { roofColor?: string; roofArt?: string | null }) {
      if (busy) return;
      busy = true;
      try {
        const res = await saveDecor(houseNo, patch);
        applyWallet(res.wallet, { silent: true });
        setMe({ ...state.me!, roofColor: res.roofColor });
        setMyRoofArt(res.decor.roofArt);
        const h = state.houses.get(houseNo);
        if (h) h.roofColor = res.roofColor;
        pushHousesToScene();
        syncArt();
        play('save');
        toast('지붕을 바꿨어요');
      } catch (err) {
        play('error');
        toast(err instanceof ApiError ? err.message : '저장하지 못했어요');
      }
      busy = false;
      draw();
    }

    root.addEventListener('click', async (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.roof) return patchRoof({ roofColor: t.dataset.roof });
      if (t.dataset.roofart !== undefined) return patchRoof({ roofArt: t.dataset.roofart || null });
      if (t.dataset.pick) {
        selected = selected === t.dataset.pick ? null : t.dataset.pick;
        play('tap');
        return draw();
      }
      const act = t.dataset.act;
      if (act === 'yard' || act === 'room') {
        play('tap');
        ctx.close();
        void ctl.placement?.start(act);
      } else if (act === 'new') openDrawEditor();
      else if (act === 'roof-new') openDrawEditor((d) => void patchRoof({ roofArt: d.id }));
      else if (act === 'copy' && selected) openDrawEditor(undefined, selected);
      else if (act === 'to-roof' && selected) void patchRoof({ roofArt: selected });
      else if (act === 'del' && selected) {
        if (!confirm('이 그림을 지울까요? 붙여 둔 곳은 빈 액자로 보여요')) return;
        try {
          await deleteDrawing(selected);
          forgetMyDrawing(selected);
          if (roofArt() === selected) setMyRoofArt(null);
          selected = null;
          play('remove');
        } catch (err) {
          toast(err instanceof ApiError ? err.message : '지우지 못했어요');
        }
        draw();
      }
    });
    draw();
    void Promise.all([loadMyDrawings(), state.wallet ? null : refreshWallet()]).then(draw);
  },
};
