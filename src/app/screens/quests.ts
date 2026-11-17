// 퀘스트 (2026-11-15): 주민에게 말을 걸어 받은 부탁만 보인다. 오늘의 부탁은 한국 시간 자정에 모두 새로 바뀐다.
// 가방(물고기, 광석)과 도감도 여기서 본다.
import { decorItem } from '../../shared/config';
import {
  bagCount,
  bagDef,
  BAG_MAX,
  CURRENCY,
  DAILY_ALL_COINS,
  DAILY_ALL_ID,
  DAILY_COUNT,
  DAILY_GAME_CAP,
  dailyQuest,
  FISH,
  NPC_INFO,
  ORES,
  questValue,
  STORY_QUESTS,
  storyQuest,
  type DailyQuestDef,
  type NpcRole,
  type StoryQuestDef,
} from '../../shared/economy';
import { play } from '../audio/sound';
import { acceptQuest, ApiError, claimQuest } from '../net/api';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, coins, refreshWallet } from '../wallet';
import { coinIcon } from './shop';
import type { Screen } from './types';

const bar = (v: number, target: number) => `<span class="q-bar"><b style="width:${Math.min(100, (v / target) * 100)}%"></b></span><span class="q-n">${Math.min(v, target)}/${target}</span>`;

/** 오늘의 부탁 한 줄. withAsk: 주민 판에서는 주민이 하는 말을 보여 준다 */
function dailyRow(q: DailyQuestDef, withAsk: boolean): string {
  const w = state.wallet!;
  const d = w.data.daily;
  const claimed = d.claimed.includes(q.id);
  const accepted = q.id in d.accepted;
  const v = accepted ? questValue(w.data, q) : 0;
  const ready = accepted && !claimed && v >= q.target;
  const who = `${NPC_INFO[q.npc].title} ${NPC_INFO[q.npc].name}`;
  const sub = withAsk ? `“${esc(q.ask)}”` : `${esc(who)}의 부탁 · ${esc(q.hint)}`;
  const action = claimed
    ? '<span class="badge ok">완료</span>'
    : accepted
      ? `<button class="btn small${ready ? ' primary' : ''}" data-claim="${q.id}" ${ready ? '' : 'disabled'}>받기</button>`
      : `<button class="btn small primary" data-accept="${q.id}">부탁 받기</button>`;
  return `<li class="q-row${claimed ? ' done' : ''}">
    <div class="q-main"><b>${esc(q.label)}</b><small>${sub} · ${q.coins} ${CURRENCY}</small>
      ${accepted && !claimed ? `<div class="q-prog">${bar(v, q.target)}</div>` : ''}</div>
    ${action}</li>`;
}

/** 특별 부탁 한 줄 (한 번만, 아이템 보상) */
function storyRow(q: StoryQuestDef, withAsk: boolean): string {
  const w = state.wallet!;
  const done = w.data.story.includes(q.id);
  const taken = w.data.storyTaken.includes(q.id);
  const v = w.data.life[q.key];
  const ready = taken && !done && v >= q.target;
  const reward = `${esc(decorItem(q.item)?.label ?? q.item)} + ${q.coins} ${CURRENCY}`;
  const sub = withAsk ? `“${esc(q.ask)}”` : `${NPC_INFO[q.npc].title} ${NPC_INFO[q.npc].name}의 특별 부탁`;
  const action = done
    ? '<span class="badge ok">완료</span>'
    : taken
      ? `<button class="btn small${ready ? ' primary' : ''}" data-claim="${q.id}" ${ready ? '' : 'disabled'}>받기</button>`
      : `<button class="btn small" data-accept="${q.id}">부탁 받기</button>`;
  return `<li class="q-row special${done ? ' done' : ''}">
    <div class="q-main"><b>${esc(q.label)} <em class="tag">특별</em></b><small>${sub} · 보상 ${reward}</small>
      ${taken && !done ? `<div class="q-prog">${bar(v, q.target)}</div>` : ''}</div>
    ${action}</li>`;
}

/** 그 주민이 주는 부탁 (주민 판). 오늘의 부탁 하나 + 남은 특별 부탁 */
export function npcQuestHtml(role: NpcRole): string {
  const w = state.wallet;
  if (!w) return '';
  const today = w.daily.map((id) => dailyQuest(id)).filter((q): q is DailyQuestDef => !!q && q.npc === role);
  const special = STORY_QUESTS.filter((q) => q.npc === role && !w.data.story.includes(q.id)).slice(0, 1);
  if (!today.length && !special.length) return '';
  return `<h3 class="sec">부탁 <small>받으면 퀘스트 탭에 떠요</small></h3><ul class="q-list">${today.map((q) => dailyRow(q, true)).join('')}${special.map((q) => storyRow(q, true)).join('')}</ul>`;
}

/** 부탁 받기 / 보상 받기 버튼 처리 (판 어디서든) */
export function bindClaims(root: HTMLElement, redraw: () => void) {
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-claim], [data-accept]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.accept) {
        const res = await acceptQuest(b.dataset.accept);
        applyWallet(res.wallet, { silent: true });
        play('ding');
        toast('부탁을 받았어요. 퀘스트 탭에서 진행을 볼 수 있어요', 2200);
      } else {
        const res = await claimQuest(b.dataset.claim!);
        applyWallet(res.wallet, { coins: res.coins, item: res.item });
      }
    } catch (err) {
      play('error');
      toast(err instanceof ApiError ? err.message : '하지 못했어요');
    }
    redraw();
  });
}

/** 가방 (물고기, 광석) */
export function bagHtml(): string {
  const w = state.wallet;
  if (!w) return '';
  const entries = Object.entries(w.data.bag).filter(([, n]) => n > 0);
  if (!entries.length) return '<p class="note">가방이 비었어요. 낚시나 동굴 탐험으로 채워 보세요.</p>';
  return `<div class="bag">${entries
    .map(([id, n]) => {
      const d = bagDef(id);
      if (!d) return '';
      return `<div class="bag-cell">${d.kind === 'fish' ? fishSvg(d.color, 40) : oreSvg(d.color, 34)}<span>${esc(d.label)}</span><b>×${n}</b></div>`;
    })
    .join('')}</div>`;
}

export const questsScreen: Screen = {
  id: 'quests',
  title: '퀘스트',
  render(root) {
    if (!state.me) {
      root.innerHTML = `<p class="empty">입주하면 주민들의 부탁을 들어주고 ${CURRENCY}를 모아서<br />화분, 캣타워 같은 꾸미기 아이템을 얻을 수 있어요.</p><a class="btn primary" href="#/move-in">입주하러 가기</a>`;
      return;
    }
    const draw = () => {
      const w = state.wallet;
      if (!w) {
        root.innerHTML = '<p class="empty">불러오는 중...</p>';
        return;
      }
      const d = w.data.daily;
      const accepted = Object.keys(d.accepted)
        .map((id) => dailyQuest(id))
        .filter((q): q is DailyQuestDef => !!q);
      const doneCount = d.claimed.filter((c) => !!dailyQuest(c)).length;
      const bonusDone = d.claimed.includes(DAILY_ALL_ID);
      const stories = w.data.storyTaken.map((id) => storyQuest(id)).filter((q): q is StoryQuestDef => !!q);
      const notYet = (Object.keys(NPC_INFO) as NpcRole[]).filter((role) => {
        const q = w.daily.map((id) => dailyQuest(id)).find((x) => x?.npc === role);
        return q && !(q.id in d.accepted);
      });
      root.innerHTML = `
        <div class="coin-card">${coinIcon()}<b>${coins().toLocaleString()}</b><span>${CURRENCY}</span><a class="link" href="#/shop">상점</a></div>
        <h3 class="sec">받은 부탁 <small>한국 시간 자정에 새로 바뀌어요</small></h3>
        ${
          accepted.length || stories.length
            ? `<ul class="q-list">${accepted.map((q) => dailyRow(q, false)).join('')}${stories.map((q) => storyRow(q, false)).join('')}
              <li class="q-row bonus${bonusDone ? ' done' : ''}">
                <div class="q-main"><b>오늘 부탁 ${DAILY_COUNT}개 끝내기</b><small>보너스 ${DAILY_ALL_COINS} ${CURRENCY}</small><div class="q-prog">${bar(doneCount, DAILY_COUNT)}</div></div>
                ${bonusDone ? '<span class="badge ok">받음</span>' : `<button class="btn small${doneCount >= DAILY_COUNT ? ' primary' : ''}" data-claim="${DAILY_ALL_ID}" ${doneCount >= DAILY_COUNT ? '' : 'disabled'}>받기</button>`}
              </li></ul>`
            : '<p class="empty small">아직 받은 부탁이 없어요.<br />걷기를 눌러 섬 모서리의 주민들에게 말을 걸어 보세요.</p>'
        }
        ${
          notYet.length
            ? `<p class="note">오늘 부탁이 남은 주민: ${notYet.map((r) => `<b>${esc(NPC_INFO[r].title)} ${esc(NPC_INFO[r].name)}</b>`).join(', ')}. 걷기 화면 위 지도에 주민 위치가 보여요.</p>`
            : ''
        }
        <p class="note">오늘 팔기·오락실·방문으로 받은 ${CURRENCY}: ${d.earned}/${DAILY_GAME_CAP}</p>
        <h3 class="sec">가방 <small>${bagCount(w.data.bag)}/${BAG_MAX} · 잡화점 보리에게 팔아요</small></h3>
        ${bagHtml()}
        <h3 class="sec">물고기 도감 <small>${w.data.dex.filter((id) => FISH.some((f) => f.id === id)).length}/${FISH.length}</small></h3>
        <div class="dex">
          ${FISH.map((f) => {
            const got = w.data.dex.includes(f.id);
            return `<div class="dex-cell${got ? '' : ' unknown'}">${fishSvg(got ? f.color : '#d8cfc2', 44)}<span>${got ? esc(f.label) : '???'}</span></div>`;
          }).join('')}
        </div>
        <h3 class="sec">광석 도감 <small>${w.data.dex.filter((id) => ORES.some((o) => o.id === id)).length}/${ORES.length}</small></h3>
        <div class="dex">
          ${ORES.map((o) => {
            const got = w.data.dex.includes(o.id);
            return `<div class="dex-cell${got ? '' : ' unknown'}">${oreSvg(got ? o.color : '#d8cfc2', 34)}<span>${got ? esc(o.label) : '???'}</span></div>`;
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
/** 간단한 광석 그림 */
export const oreSvg = (color: string, size: number) =>
  `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><path d="M5 24 9 12l7-6 8 5 3 13-11 4z" fill="#8f8276"/><path d="M11 13l5-5 5 4-2 8-7 1z" fill="${color}"/><path d="M16 8l5 4-5 2z" fill="#fff" opacity=".45"/></svg>`;
