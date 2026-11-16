// 우편함 (2026-11-16): 집 앞 우편함에 온 편지. 처음 입주하면 이장님 환영 편지에 50츄르가 들어 있다.
import { decorItem } from '../../shared/config';
import { CURRENCY } from '../../shared/economy';
import { itemPic } from './shop';
import { play } from '../audio/sound';
import { ApiError, openMail } from '../net/api';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, refreshWallet } from '../wallet';
import type { Screen } from './types';

export const mailScreen: Screen = {
  id: 'mail',
  title: '우편함',
  render(root) {
    const draw = () => {
      const w = state.wallet;
      if (!state.me) {
        root.innerHTML = '<p class="note">입주하면 집 앞 우편함으로 편지가 와요.</p>';
        return;
      }
      if (!w) {
        root.innerHTML = '<p class="note">불러오는 중...</p>';
        return;
      }
      const list = w.data.mail ?? [];
      root.innerHTML = list.length
        ? `<ul class="mail-list">${list
            .map(
              (m) => {
                const gift = m.item ? decorItem(m.item)?.label ?? '선물' : '';
                const has = !m.read || m.coins > 0 || !!m.item;
                const label = m.coins > 0 ? `편지 열기 (${m.coins} ${CURRENCY})` : gift ? `선물 받기 (${esc(gift)})` : '편지 열기';
                return `<li class="mail-row${has ? ' unread' : ''}">
                <small>${esc(m.from)}</small><b>${esc(m.title)}</b>
                ${m.item ? `<div class="mail-gift">${itemPic(m.item, 64)}</div>` : ''}
                ${m.read ? `<p>${esc(m.text)}</p>` : ''}
                ${has ? `<button class="btn small primary" data-open="${esc(m.id)}">${label}</button>` : ''}
              </li>`;
              },
            )
            .join('')}</ul>`
        : '<p class="note">우편함이 비어 있어요.</p>';
    };
    root.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-open]');
      if (!b) return;
      b.disabled = true;
      try {
        const res = await openMail(b.dataset.open!);
        play('open');
        applyWallet(res.wallet, res.coins || res.item ? { coins: res.coins, item: res.item ?? null } : { silent: true });
      } catch (err) {
        play('error');
        toast(err instanceof ApiError ? err.message : '편지를 열지 못했어요');
      }
      draw();
    });
    draw();
    if (state.me) void refreshWallet().then(draw);
  },
};
