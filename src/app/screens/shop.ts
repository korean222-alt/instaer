// 상점: 츄르로 꾸미기 아이템을 산다. 꾸미기 탭과 잡화점 주민이 같이 쓴다.
import { DECOR_ITEMS } from '../../shared/config';
import { CURRENCY, STORY_QUESTS, NPC_INFO } from '../../shared/economy';
import { play } from '../audio/sound';
import { ApiError, buyItem } from '../net/api';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, coins, hasItem, refreshWallet } from '../wallet';
import type { Screen } from './types';

/** 아이템 그림 (3D 로 찍은 것. 안 되면 빈 칸) */
export function itemPic(type: string, size = 56): string {
  try {
    const url = state.scene.renderItemPreview(type, size * 2);
    if (url) return `<img class="item-pic" src="${url}" alt="" width="${size}" height="${size}" />`;
  } catch {
    /* 그림 없이 */
  }
  return `<span class="item-pic empty" style="width:${size}px;height:${size}px"></span>`;
}

/** 퀘스트로도 받을 수 있는 아이템 → 누구 부탁인지 */
const questFor = (type: string) => {
  const q = STORY_QUESTS.find((s) => s.item === type);
  return q ? `${NPC_INFO[q.npc].title} 특별 부탁으로도 받아요` : '';
};

export function renderShop(root: HTMLElement) {
  const draw = () => {
    root.innerHTML = `
      <div class="coin-card">${coinIcon()}<b>${coins().toLocaleString()}</b><span>${CURRENCY}</span>
        <a class="link" href="#/quests">츄르 모으기</a></div>
      <ul class="shop-list">
        ${DECOR_ITEMS.map((d) => {
          const own = hasItem(d.type);
          const where = d.mount === 'wall' ? '집 안 벽' : d.mount === 'rug' ? '바닥에 깔기' : '마당, 집 안';
          return `<li class="shop-row${own ? ' own' : ''}">
            <div class="shop-pic">${itemPic(d.type)}</div>
            <div><b>${esc(d.label)}</b><small>${where}${d.art ? ' · 그림 붙이기' : ''}${!own && questFor(d.type) ? ` · ${questFor(d.type)}` : ''}</small></div>
            ${
              own
                ? `<span class="badge ok">${d.price === null ? '기본' : '가짐'}</span>`
                : `<button class="btn small primary" data-buy="${d.type}" ${state.me && coins() >= (d.price ?? 0) ? '' : 'disabled'}>${d.price} ${CURRENCY}</button>`
            }
          </li>`;
        }).join('')}
      </ul>
      ${state.me ? '' : '<p class="note">입주하면 츄르를 모아서 살 수 있어요.</p>'}`;
  };
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
    if (!b) return;
    b.disabled = true;
    try {
      const res = await buyItem(b.dataset.buy!);
      applyWallet(res.wallet, { item: res.bought });
    } catch (err) {
      play('error');
      toast(err instanceof ApiError ? err.message : '사지 못했어요');
    }
    draw();
  });
  draw();
  if (state.me && !state.wallet) void refreshWallet().then(draw);
}

export const coinIcon = () =>
  '<svg class="coin" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="5" fill="#ffb347"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';

export const shopScreen: Screen = {
  id: 'shop',
  title: '상점',
  render(root) {
    renderShop(root);
  },
};
