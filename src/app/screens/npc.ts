// 주민에게 말 걸기: 잡화점(사기/팔기), 오락실(생선 받기), 낚시꾼, 정원사, 탐험가(동굴), 이웃.
// 부탁(퀘스트)은 여기서 받는다. 받으면 퀘스트 탭에 뜬다.
import { bagDef, CURRENCY, DAILY_GAME_CAP, NPC_INFO, VISIT_COINS, VISIT_MAX, type NpcRole } from '../../shared/economy';
import { play } from '../audio/sound';
import { ApiError, sellItems } from '../net/api';
import { ctl } from '../play/ctl';
import { MAYOR_NAME, npcLook, npcName } from '../play/npcs';
import { WANDER_TALK } from '../play/wanderers';
import { markNewsSeen, newsHtml } from './social';
import { state } from '../state';
import { catSvg } from '../ui/catSvg';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, refreshWallet } from '../wallet';
import { bagPic, bindClaims, npcQuestHtml } from './quests';
import { renderShop } from './shop';
import type { Screen } from './types';
import type { CatLook } from '../../shared/types';

const RESIDENT_TALK = [
  '놀러 와 줘서 고맙다냥! 오늘도 좋은 하루 보내자냥.',
  '섬 북서쪽 산에 동굴이 있다냥. 두더지가 매일 들어간다더라냥.',
  '물고기는 마을 광장 잡화점 보리한테 팔면 츄르로 바꿔 준다냥!',
  '오락실 콩이는 생선 받기 50점 넘으면 선물을 준다냥.',
  '고양이 자동차 타 봤냥? 뒤에 친구도 태울 수 있다냥!',
  '집 앞 우편함에 편지가 왔을지도 모른다냥. 열어 보자냥.',
];

/** 3D 고양이 그림 (안 되면 2D) */
function face(cat: CatLook, key: string): string {
  try {
    const url = state.scene.renderCatPreview(cat, 160, { pose: 'sit', yaw: 0.3 });
    if (url) return `<img class="npc-face" src="${url}" alt="" width="80" height="80" />`;
  } catch {
    /* 2D 로 */
  }
  return catSvg(cat, 72, key);
}

/** 잡화점 팔기: 가방의 물고기/광석 */
function renderSell(root: HTMLElement) {
  const draw = () => {
    const w = state.wallet;
    if (!w) {
      root.innerHTML = '<p class="note">입주하면 낚은 물고기와 캔 광석을 팔 수 있어요.</p>';
      return;
    }
    const entries = Object.entries(w.data.bag).filter(([, n]) => n > 0);
    const total = entries.reduce((s, [id, n]) => s + (bagDef(id)?.price ?? 0) * n, 0);
    root.innerHTML = entries.length
      ? `<ul class="shop-list">
          ${entries
            .map(([id, n]) => {
              const d = bagDef(id);
              if (!d) return '';
              return `<li class="shop-row"><div class="shop-pic">${bagPic(d, 46)}</div>
                <div><b>${esc(d.label)} ×${n}</b><small>하나에 ${d.price} ${CURRENCY}</small></div>
                <div class="row-btns"><button class="btn small" data-sell="${id}" data-n="1">1개</button><button class="btn small primary" data-sell="${id}" data-n="${n}">모두</button></div></li>`;
            })
            .join('')}
        </ul>
        <button class="btn primary" data-sellall>전부 팔기 (${total} ${CURRENCY})</button>
        <p class="note">오늘 팔기·오락실·방문으로 받은 ${CURRENCY}: ${w.data.daily.earned}/${DAILY_GAME_CAP}. 넘으면 내일 다시 팔 수 있어요.</p>`
      : '<p class="note">팔 물건이 없어요. 연못이나 부두에서 낚시하고, 북서쪽 산 동굴에서 광석을 캐 와!</p>';
  };
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sell], [data-sellall]');
    if (!b || !state.wallet) return;
    const items: Record<string, number> = {};
    if (b.dataset.sell) items[b.dataset.sell] = Number(b.dataset.n);
    else for (const [id, n] of Object.entries(state.wallet.data.bag)) items[id] = n;
    b.disabled = true;
    try {
      const res = await sellItems(items);
      applyWallet(res.wallet, res.coins ? { coins: res.coins } : { silent: true });
      if (res.capped) toast(`오늘은 더 팔 수 없어요 (하루 ${DAILY_GAME_CAP} ${CURRENCY}). 내일 또 와!`, 2800);
    } catch (err) {
      play('error');
      toast(err instanceof ApiError ? err.message : '팔지 못했어요');
    }
    draw();
  });
  draw();
}

export const npcScreen: Screen = {
  id: 'npc',
  title: '주민',
  render(root, param, ctx) {
    const p = param ?? '';
    if (p === 'mayor') {
      ctx.setTitle(MAYOR_NAME);
      root.innerHTML = `
        <div class="npc-head">${face(npcLook('mayor', -1), 'mayor')}
          <p class="bubble">${state.me ? `${esc(state.me.igHandle ?? '')} 주민, 반갑다냥! 섬에 새로 생긴 소식을 알려 주겠다냥.` : '어서 오라냥! 고양이섬 이장이다냥. 입주하면 이웃들이 반겨 줄 거다냥.'}</p></div>
        <div class="row two"><a class="btn primary" href="#/board">마을 게시판</a><a class="btn" href="#/friends">친구</a></div>
        <h3 class="sub">업데이트 소식</h3>
        ${newsHtml()}`;
      markNewsSeen();
      return;
    }
    if (p.startsWith('walker-')) {
      // 산책냥 (2026-11-19): 섬을 돌아다니는 주민. 부탁은 없고 인사만
      const id = Number(p.slice(7)) || 0;
      ctx.setTitle(npcName('wanderer', id));
      root.innerHTML = `
        <div class="npc-head">${face(npcLook('wanderer', id), `w${id}`)}
          <p class="bubble">${esc(WANDER_TALK[(id + new Date().getDate()) % WANDER_TALK.length])}</p></div>
        <p class="note">산책냥은 마을 광장과 동네 여기저기를 천천히 돌아다녀요. 작은 지도에서 노란 점으로 보여요.</p>`;
      return;
    }
    if (p.startsWith('resident-')) {
      const id = Number(p.slice(9));
      ctx.setTitle(npcName('resident', id));
      const visited = state.wallet?.data.daily.visits.includes(-(id + 1));
      root.innerHTML = `
        <div class="npc-head">${face(npcLook('resident', id), `r${id}`)}
          <p class="bubble">${esc(RESIDENT_TALK[id % RESIDENT_TALK.length])}</p></div>
        <p class="note">${state.me ? (visited ? `오늘 이 집 방문 보상(${VISIT_COINS} ${CURRENCY})을 받았어요.` : `주민 집에 들어가면 하루 ${VISIT_MAX}곳까지 ${VISIT_COINS} ${CURRENCY}씩 받아요.`) : '입주하면 방문 보상을 받아요.'}</p>`;
      return;
    }
    const role = (Object.keys(NPC_INFO) as NpcRole[]).includes(p as NpcRole) ? (p as NpcRole) : 'shop';
    const info = NPC_INFO[role];
    ctx.setTitle(`${info.title} ${info.name}`);
    let tab: 'buy' | 'sell' = 'buy';
    const draw = () => {
      root.innerHTML = `
        <div class="npc-head">${face(npcLook(role, 0), `n${role}`)}<p class="bubble">${esc(info.hello)}</p></div>
        ${role === 'arcade' ? '<button class="btn primary" data-act="arcade">생선 받기 한 판 (30초)</button><p class="note">15점 10츄르 · 30점 25츄르 · 50점 40츄르, 하루 처음 50점을 넘기면 선물 상자!</p>' : ''}
        ${role === 'fisher' ? '<p class="note">연못 둘레나 1구역 남쪽 부두 끝에 가면 "낚시하기" 버튼이 생겨요. 낚은 물고기는 가방에 모이고, 마을 광장 잡화점 보리에게 팔아요.</p>' : ''}
        ${role === 'explorer' ? '<p class="note">섬 북서쪽 큰 산에 동굴이 있다냥. 입구 앞에서 "동굴 들어가기", 반짝이는 바위 옆에서 "캐기" 버튼을 꾹 누르고 있으면 캐진다냥! 안쪽 굴로 더 들어가면 자수정, 금, 다이아도 나온다냥.</p>' : ''}
        ${role === 'gardener' ? '<p class="note">꾸미기 탭에서 마당을 꾸며 보자냥. 예쁜 집에는 예뻐요도 눌러 주자냥! 걷다 보면 나비랑 곤충이 보인다냥. 옆에 가서 "잡기"를 누르자냥. 밤에는 반딧불이가 나온다냥.</p>' : ''}
        ${role === 'painter' ? '<p class="note">꾸미기 탭에서 그림을 그리고, 그림 캔버스에 걸어 두자냥. 캔버스를 누르면 누구나 그림을 크게 볼 수 있다냥.</p>' : ''}
        ${role === 'mailman' ? '<p class="note">집 앞 우편함 옆에 서면 "우편함 열기"가 나온다냥. 섬 모서리 주민 집에 들르면 방문 보상도 있다냥.</p>' : ''}
        ${state.me ? npcQuestHtml(role) : '<p class="note">입주하면 부탁을 받을 수 있어요.</p>'}
        ${
          role === 'shop'
            ? `<div class="seg"><button class="seg-btn${tab === 'buy' ? ' on' : ''}" data-tab="buy">사기</button><button class="seg-btn${tab === 'sell' ? ' on' : ''}" data-tab="sell">팔기</button></div><div class="shop-box"></div>`
            : ''
        }`;
      const box = root.querySelector<HTMLElement>('.shop-box');
      if (box) (tab === 'buy' ? renderShop : renderSell)(box);
    };
    bindClaims(root, draw);
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-act="arcade"]')) {
        ctx.close();
        ctl.arcade?.();
      }
      const tb = t.closest<HTMLElement>('[data-tab]');
      if (tb && (tb.dataset.tab === 'buy' || tb.dataset.tab === 'sell') && tb.dataset.tab !== tab) {
        tab = tb.dataset.tab;
        play('tap');
        draw();
      }
    });
    draw();
    if (state.me) void refreshWallet().then(draw);
  },
};
