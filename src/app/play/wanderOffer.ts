// 산책냥 부탁 (2026-11-19 사용자: "주민들이 멀리 있으니 지나가면서 자연스럽게 퀘스트를 주면 좋겠다, 머리 위에 느낌표").
// 머리 위에 "!" 가 뜬 산책냥 옆을 지나가면 화면 아래에 말풍선 카드가 뜬다. 판(sheet)을 열지 않아서 걷던 걸음이 끊기지 않는다.
// 규칙은 shared/economy.ts 의 WANDER_QUESTS, 서버는 /api/quest/accept (give 는 그 자리에서 츄르).
import { bagDef, cheapestInBag, CURRENCY, kstDay, normalizeWallet, wanderHasQuest, wanderQuestFor, wanderQuestId, type WanderQuestDef } from '../../shared/economy';
import { play } from '../audio/sound';
import { acceptQuest, ApiError } from '../net/api';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet } from '../wallet';
import type { Npc } from './npcs';
import { wanderName } from './wanderers';

/** 이만큼 가까우면 말을 걸어 오고, 이만큼 멀어지면 카드를 닫는다 (m) */
const OFFER_NEAR = 3.4;
const OFFER_FAR = 7;
/** "다음에" 를 누르면 그 산책냥은 이만큼 다시 말을 걸지 않는다 */
const SNOOZE_MS = 3 * 60_000;

let card: HTMLDivElement | null = null;
let current: { walker: number; def: WanderQuestDef } | null = null;
let busy = false;
const snoozed = new Map<number, number>();

function el(): HTMLDivElement {
  if (card) return card;
  card = document.createElement('div');
  card.className = 'wander-offer';
  card.hidden = true;
  document.getElementById('app')!.appendChild(card);
  card.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || !current) return;
    if (b.dataset.act === 'later') {
      snoozed.set(current.walker, Date.now());
      play('close');
      hide();
    } else if (b.dataset.act === 'yes') void take(current.walker, current.def);
  });
  return card;
}

function hide() {
  current = null;
  if (card) card.hidden = true;
}

const word = (k: WanderQuestDef['bag']) => (k === 'fish' ? '물고기' : k === 'ore' ? '광석' : '곤충');
/** 물고기가 / 광석이 / 곤충이 */
const wordGa = (k: WanderQuestDef['bag']) => (k === 'fish' ? '물고기가' : k === 'ore' ? '광석이' : '곤충이');

function draw() {
  if (!current) return;
  const c = el();
  const { walker, def } = current;
  const data = normalizeWallet(state.wallet!.data, kstDay());
  let actions: string;
  let line = def.ask;
  if (def.kind === 'give') {
    const item = cheapestInBag(data, def.bag!);
    if (item) actions = `<button class="btn small primary" data-act="yes">${esc(bagDef(item)?.label ?? word(def.bag))} 건네주기 · +${def.coins} ${CURRENCY}</button><button class="btn small" data-act="later">다음에</button>`;
    else {
      line = `${def.ask} ...앗, 가방에 ${wordGa(def.bag)} 없구나냥. 생기면 다시 와 줘냥!`;
      actions = `<span class="hint-line">${esc(def.hint)}</span><button class="btn small" data-act="later">알았어요</button>`;
    }
  } else actions = `<button class="btn small primary" data-act="yes">부탁 받기 · ${def.coins} ${CURRENCY}</button><button class="btn small" data-act="later">다음에</button>`;
  c.innerHTML = `<b>${esc(wanderName(walker))} <em>!</em></b><p>“${esc(line)}”</p>${def.kind === 'count' ? `<small>${esc(def.label)} · 다 하면 퀘스트에서 받아요</small>` : ''}<div class="wo-acts">${actions}</div>`;
  c.hidden = false;
}

async function take(walker: number, def: WanderQuestDef) {
  if (busy) return;
  busy = true;
  try {
    const res = await acceptQuest(wanderQuestId(walker, def));
    if (res.coins) {
      applyWallet(res.wallet, { coins: res.coins });
      toast(`${wanderName(walker)}: 고맙다냥! (${bagDef(res.gave ?? '')?.label ?? word(def.bag)} → +${res.coins} ${CURRENCY})`, 2600);
    } else {
      applyWallet(res.wallet, { silent: true });
      play('ding');
      toast(`부탁을 받았어요: ${def.label}. 다 하면 퀘스트에서 받아요`, 2600);
    }
    hide();
  } catch (e) {
    play('error');
    toast(e instanceof ApiError ? e.message : '하지 못했어요');
    snoozed.set(walker, Date.now());
    hide();
  }
  busy = false;
}

/** 걷는 동안 0.2초마다: 보이는 주민 목록과 내 자리. 걷지 않거나 집/동굴 안이면 list 를 null 로 */
export function updateWanderOffer(list: readonly Npc[] | null, me: { x: number; z: number } | null) {
  if (!list || !me || !state.me || !state.wallet || document.body.classList.contains('decorating')) {
    hide();
    return;
  }
  if (busy) return;
  const data = normalizeWallet(state.wallet.data, kstDay());
  if (current) {
    const n = list.find((v) => v.role === 'wanderer' && v.homeId === current!.walker);
    if (!n || Math.hypot(n.x - me.x, n.z - me.z) > OFFER_FAR || !wanderHasQuest(data, state.me.houseNo, current.walker)) hide();
    return;
  }
  const now = Date.now();
  for (const n of list) {
    if (n.role !== 'wanderer' || !n.mark) continue;
    if (Math.hypot(n.x - me.x, n.z - me.z) > OFFER_NEAR) continue;
    const t = snoozed.get(n.homeId);
    if (t && now - t < SNOOZE_MS) continue;
    if (!wanderHasQuest(data, state.me.houseNo, n.homeId)) continue;
    current = { walker: n.homeId, def: wanderQuestFor(data.day, state.me.houseNo, n.homeId) };
    play('meow');
    draw();
    return;
  }
}

/** 산책냥 판(말 걸기)에서 쓰는 부탁 줄. 받을 부탁이 없으면 빈 글자 */
export function wanderOfferHtml(walker: number): string {
  if (!state.me || !state.wallet) return '';
  const data = normalizeWallet(state.wallet.data, kstDay());
  if (!wanderHasQuest(data, state.me.houseNo, walker)) return '';
  const def = wanderQuestFor(data.day, state.me.houseNo, walker);
  const has = def.kind === 'count' || !!cheapestInBag(data, def.bag!);
  return `<div class="wander-ask"><p class="bubble">“${esc(def.ask)}”</p>
    ${has ? `<button class="btn primary" data-wander="${walker}">${def.kind === 'give' ? `건네주기 · +${def.coins} ${CURRENCY}` : `부탁 받기 · ${def.coins} ${CURRENCY}`}</button>` : `<p class="note">가방에 ${wordGa(def.bag)} 생기면 건네줄 수 있어요. (${esc(def.hint)})</p>`}</div>`;
}
/** 산책냥 판의 버튼 */
export async function takeWanderFromSheet(walker: number): Promise<void> {
  if (!state.me || !state.wallet) return;
  const data = normalizeWallet(state.wallet.data, kstDay());
  await take(walker, wanderQuestFor(data.day, state.me.houseNo, walker));
}
