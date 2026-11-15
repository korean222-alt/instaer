// 내 지갑(츄르, 가진 아이템, 퀘스트)을 들고 있고, 서버 응답이 올 때마다 바꾼다.
import { decorItem, STARTER_ITEMS } from '../shared/config';
import { CURRENCY, DAILY_QUESTS, dailyQuests, kstDay, normalizeWallet, owns, questValue } from '../shared/economy';
import { play } from './audio/sound';
import { fetchWallet, type WalletView } from './net/api';
import { setWallet, state } from './state';
import { toast } from './ui/toast';

export async function refreshWallet(): Promise<WalletView | null> {
  if (!state.me) return null;
  try {
    const { wallet } = await fetchWallet();
    setWallet(wallet);
    return wallet;
  } catch {
    return state.wallet;
  }
}

/** 서버가 돌려준 지갑으로 바꾼다. 받은 츄르가 있으면 알려 준다 */
export function applyWallet(w: WalletView | undefined, gained?: { coins?: number; item?: string | null; silent?: boolean }) {
  if (!w) return;
  setWallet(w);
  if (!gained || gained.silent) return;
  const parts: string[] = [];
  if (gained.item) parts.push(`${decorItem(gained.item)?.label ?? gained.item} 획득`);
  if (gained.coins) parts.push(`${CURRENCY} +${gained.coins}`);
  if (parts.length) {
    play('fanfare');
    toast(parts.join(' · '), 2600);
  }
}

/** 그 아이템을 가졌는지 (입주 전이면 기본 아이템만) */
export function hasItem(type: string): boolean {
  if (!state.wallet) return STARTER_ITEMS.includes(type);
  return owns(state.wallet.data, type);
}

export const coins = () => state.wallet?.coins ?? 0;

/** 오늘 받을 수 있는 퀘스트 보상 수 (HUD 빨간 점) */
export function claimableCount(): number {
  const w = state.wallet;
  if (!w || !state.me) return 0;
  const data = normalizeWallet(w.data, kstDay());
  const todays = data.day === w.data.day ? w.daily : dailyQuests(data.day, state.me.houseNo).map((q) => q.id);
  let n = 0;
  for (const id of todays) {
    const q = DAILY_QUESTS.find((d) => d.id === id);
    if (q && !data.daily.claimed.includes(id) && questValue(data, q.key) >= q.target) n++;
  }
  return n;
}
