// 상점: 츄르로 꾸미기 아이템을 산다. 꾸미기 탭과 잡화점 주민이 같이 쓴다.
import { DECOR_ITEMS } from '../../shared/config';
import { CURRENCY, STORY_QUESTS, NPC_INFO, UPGRADES } from '../../shared/economy';
import { play } from '../audio/sound';
import { ApiError, buyItem } from '../net/api';
import { state } from '../state';
import { ctl } from '../play/ctl';
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
      <h3 class="sub">한 번 사면 계속</h3>
      <ul class="shop-list">
        ${UPGRADES.map((u) => {
          const own = hasItem(u.key);
          return `<li class="shop-row${own ? ' own' : ''}">
            <div class="shop-pic">${upgradePic(u.key)}</div>
            <div><b>${esc(u.label)}</b><small>${esc(u.desc)}</small></div>
            ${own ? '<span class="badge ok">가짐</span>' : `<button class="btn small primary" data-buy="${u.key}" ${state.me && coins() >= u.price ? '' : 'disabled'}>${u.price} ${CURRENCY}</button>`}
          </li>`;
        }).join('')}
      </ul>
      <h3 class="sub">꾸미기 아이템</h3>
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
      // 집 넓히기: 내 집 안에 있으면 바로 넓어진다
      const inside = ctl.explore?.insideDecor();
      if (res.bought === 'room_big' && inside && state.me && inside.houseNo === state.me.houseNo) ctl.explore!.setInsideDecor({ ...inside, big: true });
    } catch (err) {
      play('error');
      toast(err instanceof ApiError ? err.message : '사지 못했어요');
    }
    draw();
  });
  draw();
  if (state.me && !state.wallet) void refreshWallet().then(draw);
}

/** 업그레이드 그림 (간단한 그림) */
function upgradePic(key: string): string {
  const svg = (body: string) => `<svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">${body}</svg>`;
  if (key === 'cat_car')
    return svg(
      '<path d="M6 30v-7l5-9h22l7 9h2v7z" fill="#ff9f6b"/><path d="M12 14l-1-6 5 4M30 14l1-6-5 4" fill="#ff9f6b"/><circle cx="14" cy="32" r="5" fill="#4a4448"/><circle cx="34" cy="32" r="5" fill="#4a4448"/><circle cx="14" cy="32" r="2" fill="#fff4e2"/><circle cx="34" cy="32" r="2" fill="#fff4e2"/><circle cx="38" cy="22" r="2.5" fill="#fffbe6"/>',
    );
  if (key === 'room_big')
    return svg('<path d="M8 22 24 9l16 13v18H8z" fill="#ffd6a5"/><path d="M4 22 24 5l20 17" stroke="#e9794f" stroke-width="3" fill="none"/><path d="M14 30h20M14 30l4-3M14 30l4 3M34 30l-4-3M34 30l-4 3" stroke="#5b4636" stroke-width="2" fill="none"/>');
  return svg('<path d="M4 26 24 10l20 16z" fill="#ff8f7a"/><rect x="10" y="26" width="28" height="14" fill="#fff4e2"/><path d="M17 20l3-3 3 3 3-4 4 4" stroke="#fff" stroke-width="2" fill="none"/><circle cx="34" cy="10" r="4" fill="#ffd166"/>');
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
