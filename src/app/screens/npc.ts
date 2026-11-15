// 주민에게 말 걸기: 잡화점(상점), 오락실(생선 받기), 낚시꾼(낚시 부탁, 도감), 정원사(부탁), 주민 집 고양이(인사).
import { CURRENCY, NPC_INFO, residentName, VISIT_COINS, VISIT_MAX, type NpcRole } from '../../shared/economy';
import { ctl } from '../play/ctl';
import { state } from '../state';
import { catSvg } from '../ui/catSvg';
import { esc } from '../ui/dom';
import { refreshWallet } from '../wallet';
import { bindClaims, storyHtml } from './quests';
import { renderShop } from './shop';
import type { Screen } from './types';

const LOOKS: Record<NpcRole, Parameters<typeof catSvg>[0]> = {
  shop: { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' },
  arcade: { fur: '#35323a', pattern: 'tuxedo', eyeColor: '#f2c94c' },
  fisher: { fur: '#a9adb8', pattern: 'gray', eyeColor: '#f0b44a' },
  gardener: { fur: '#f0a04b', pattern: 'calico', eyeColor: '#6fb7e8' },
};

const RESIDENT_TALK = ['놀러 와 줘서 고마워! 츄르 하나 줄게.', '오늘 날씨 좋다냥. 연못에 가 봤어?', '우리 집 소파 푹신하지? 상점에서 팔아.', '광장 오락실 콩이가 상품을 준대!'];

export const npcScreen: Screen = {
  id: 'npc',
  title: '주민',
  render(root, param, ctx) {
    const p = param ?? '';
    if (p.startsWith('resident-')) {
      const no = Number(p.slice(9));
      ctx.setTitle(`주민 ${residentName(no)}`);
      const visited = state.wallet?.data.daily.visits.includes(no);
      root.innerHTML = `
        <div class="npc-head">${catSvg({ fur: '#fffaf2', pattern: 'white', eyeColor: '#6fb7e8' }, 72, `r${no}`)}
          <p class="bubble">${esc(RESIDENT_TALK[no % RESIDENT_TALK.length])}</p></div>
        <p class="note">${state.me ? (visited ? `오늘 이 집 방문 보상(${VISIT_COINS} ${CURRENCY})을 받았어요.` : `주민 집에 들어가면 하루 ${VISIT_MAX}곳까지 ${VISIT_COINS} ${CURRENCY}씩 받아요.`) : '입주하면 방문 보상을 받아요.'}</p>`;
      return;
    }
    const role = (Object.keys(NPC_INFO) as NpcRole[]).includes(p as NpcRole) ? (p as NpcRole) : 'shop';
    const info = NPC_INFO[role];
    ctx.setTitle(`${info.title} ${info.name}`);
    const draw = () => {
      root.innerHTML = `
        <div class="npc-head">${catSvg(LOOKS[role], 72, `n${role}`)}<p class="bubble">${esc(info.hello)}</p></div>
        ${role === 'arcade' ? '<button class="btn primary" data-act="arcade">생선 받기 한 판 (30초)</button><p class="note">15점 10츄르 · 30점 25츄르 · 50점 40츄르, 하루 처음 50점을 넘기면 선물 상자!</p>' : ''}
        ${role === 'fisher' ? '<p class="note">연못 둘레 가까이 가면 "낚시하기" 버튼이 생겨요. 찌가 쑥 들어가면 바로 누르세요!</p>' : ''}
        ${state.me ? `<ul class="q-list">${storyHtml(role)}</ul>` : ''}
        ${role === 'shop' ? '<div class="shop-box"></div>' : ''}
        ${role === 'fisher' ? '<a class="btn" href="#/quests">물고기 도감 보기</a>' : ''}`;
      const box = root.querySelector<HTMLElement>('.shop-box');
      if (box) renderShop(box);
    };
    bindClaims(root, draw);
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="arcade"]')) {
        ctx.close();
        ctl.arcade?.();
      }
    });
    draw();
    if (state.me) void refreshWallet().then(draw);
  },
};
