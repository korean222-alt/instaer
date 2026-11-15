// 퀘스트: 오늘의 퀘스트 3개, 주민 부탁(아이템 보상), 물고기 도감.
import { decorItem } from '../../shared/config';
import {
  CURRENCY,
  DAILY_ALL_COINS,
  DAILY_ALL_ID,
  DAILY_GAME_CAP,
  DAILY_QUESTS,
  FISH,
  NPC_INFO,
  STORY_QUESTS,
  questValue,
  type NpcRole,
} from '../../shared/economy';
import { play } from '../audio/sound';
import { ApiError, claimQuest } from '../net/api';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, coins, refreshWallet } from '../wallet';
import { coinIcon } from './shop';
import type { Screen } from './types';

const bar = (v: number, target: number) => `<span class="q-bar"><b style="width:${Math.min(100, (v / target) * 100)}%"></b></span><span class="q-n">${Math.min(v, target)}/${target}</span>`;

/** 그 주민의 부탁 목록 (NPC 판과 같이 쓴다) */
export function storyHtml(npc?: NpcRole): string {
  const w = state.wallet;
  if (!w) return '';
  return STORY_QUESTS.filter((q) => !npc || q.npc === npc)
    .map((q) => {
      const done = w.data.story.includes(q.id);
      const v = w.data.life[q.key];
      const ready = !done && v >= q.target;
      return `<li class="q-row${done ? ' done' : ''}">
        <div class="q-main"><b>${esc(q.label)}</b><small>${npc ? `“${esc(q.ask)}”` : `${NPC_INFO[q.npc].title} ${NPC_INFO[q.npc].name}의 부탁`} · 보상 ${esc(decorItem(q.item)?.label ?? q.item)} + ${q.coins} ${CURRENCY}</small>
          <div class="q-prog">${bar(v, q.target)}</div></div>
        ${done ? '<span class="badge ok">완료</span>' : `<button class="btn small${ready ? ' primary' : ''}" data-claim="${q.id}" ${ready ? '' : 'disabled'}>받기</button>`}
      </li>`;
    })
    .join('');
}

/** 받기 버튼 처리 (판 어디서든) */
export function bindClaims(root: HTMLElement, redraw: () => void) {
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-claim]');
    if (!b) return;
    b.disabled = true;
    try {
      const res = await claimQuest(b.dataset.claim!);
      applyWallet(res.wallet, { coins: res.coins, item: res.item });
    } catch (err) {
      play('error');
      toast(err instanceof ApiError ? err.message : '받지 못했어요');
    }
    redraw();
  });
}

export const questsScreen: Screen = {
  id: 'quests',
  title: '퀘스트',
  render(root) {
    if (!state.me) {
      root.innerHTML = `<p class="empty">입주하면 퀘스트를 깨고 ${CURRENCY}를 모아서<br />화분, 캣타워 같은 꾸미기 아이템을 얻을 수 있어요.</p><a class="btn primary" href="#/move-in">입주하러 가기</a>`;
      return;
    }
    const draw = () => {
      const w = state.wallet;
      if (!w) {
        root.innerHTML = '<p class="empty">불러오는 중...</p>';
        return;
      }
      const todays = w.daily.map((id) => DAILY_QUESTS.find((q) => q.id === id)).filter((q) => !!q);
      const allClaimed = todays.every((q) => w.data.daily.claimed.includes(q.id));
      const bonusDone = w.data.daily.claimed.includes(DAILY_ALL_ID);
      root.innerHTML = `
        <div class="coin-card">${coinIcon()}<b>${coins().toLocaleString()}</b><span>${CURRENCY}</span><a class="link" href="#/shop">상점</a></div>
        <h3 class="sec">오늘의 퀘스트 <small>한국 시간 자정에 바뀌어요</small></h3>
        <ul class="q-list">
          ${todays
            .map((q) => {
              const v = questValue(w.data, q.key);
              const claimed = w.data.daily.claimed.includes(q.id);
              const ready = !claimed && v >= q.target;
              return `<li class="q-row${claimed ? ' done' : ''}">
                <div class="q-main"><b>${esc(q.label)}</b><small>${esc(q.hint)} · ${q.coins} ${CURRENCY}</small><div class="q-prog">${bar(v, q.target)}</div></div>
                ${claimed ? '<span class="badge ok">받음</span>' : `<button class="btn small${ready ? ' primary' : ''}" data-claim="${q.id}" ${ready ? '' : 'disabled'}>받기</button>`}
              </li>`;
            })
            .join('')}
          <li class="q-row bonus${bonusDone ? ' done' : ''}">
            <div class="q-main"><b>오늘 셋 다 끝내기</b><small>보너스 ${DAILY_ALL_COINS} ${CURRENCY}</small></div>
            ${bonusDone ? '<span class="badge ok">받음</span>' : `<button class="btn small${allClaimed ? ' primary' : ''}" data-claim="${DAILY_ALL_ID}" ${allClaimed ? '' : 'disabled'}>받기</button>`}
          </li>
        </ul>
        <p class="note">오늘 미니게임(낚시, 생선 받기, 주민 집 방문)으로 받은 ${CURRENCY}: ${w.data.daily.earned}/${DAILY_GAME_CAP}</p>
        <h3 class="sec">주민 부탁 <small>동네 가운데 주민에게 말을 걸어요</small></h3>
        <ul class="q-list">${storyHtml()}</ul>
        <h3 class="sec">물고기 도감 <small>${w.data.dex.length}/${FISH.length}</small></h3>
        <div class="dex">
          ${FISH.map((f) => {
            const got = w.data.dex.includes(f.id);
            return `<div class="dex-cell${got ? '' : ' unknown'}">${fishSvg(got ? f.color : '#d8cfc2', 44)}<span>${got ? esc(f.label) : '???'}</span></div>`;
          }).join('')}
        </div>`;
    };
    bindClaims(root, draw);
    draw();
    void refreshWallet().then(draw);
  },
};

/** 간단한 물고기 그림 */
export const fishSvg = (color: string, size: number) =>
  `<svg viewBox="0 0 48 32" width="${size}" height="${(size * 2) / 3}" aria-hidden="true"><path d="M4 16c6-9 18-12 28-6l8-6v24l-8-6C22 28 10 25 4 16z" fill="${color}"/><circle cx="12" cy="14" r="2.2" fill="#3a2e26"/><path d="M20 10q4 6 0 12" stroke="rgba(0,0,0,.18)" stroke-width="2" fill="none"/></svg>`;
