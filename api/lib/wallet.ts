// 츄르 지갑 읽기/쓰기. 지갑은 집 한 채당 한 줄(coins + data JSON)이라 무엇을 하든 쓰기 1행이다.
import { addSeasonMail, DAILY_GAME_CAP, dailyQuests, normalizeWallet, welcomeMail, type Wallet, type WalletData } from '../../src/shared/economy';

export interface WalletRow {
  coins: number;
  data: string;
}

/** 지갑을 읽는다. 없으면 새로 만든다 (2026-11-16: 환영 츄르는 바로 주지 않고 우편함 환영 편지에 넣는다) */
export async function loadWallet(db: D1Database, houseId: number): Promise<Wallet> {
  let row = await db.prepare('SELECT coins, data FROM wallets WHERE house_id = ?').bind(houseId).first<WalletRow>();
  if (!row) {
    const data = JSON.stringify({ mail: [welcomeMail()] });
    await db.prepare('INSERT OR IGNORE INTO wallets (house_id, coins, data) VALUES (?, ?, ?)').bind(houseId, 0, data).run();
    row = (await db.prepare('SELECT coins, data FROM wallets WHERE house_id = ?').bind(houseId).first<WalletRow>()) ?? { coins: 0, data };
  }
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.data);
  } catch {
    /* 깨진 값은 빈 지갑 데이터로 */
  }
  const data = normalizeWallet(parsed);
  // 겨울 선물 편지 (눈사람). 다음에 지갑을 저장할 때 같이 저장된다 (읽기만 하면 매번 다시 넣어 보여 준다)
  addSeasonMail(data);
  return { coins: row.coins, data };
}

/** 지갑 저장 문 (다른 쓰기와 같이 batch 로 보낼 수 있게 문만 만든다) */
export function saveWallet(db: D1Database, houseId: number, w: Wallet): D1PreparedStatement {
  return db.prepare('UPDATE wallets SET coins = ?, data = ? WHERE house_id = ?').bind(Math.max(0, Math.floor(w.coins)), JSON.stringify(w.data), houseId);
}

/** 미니게임 보상: 하루 상한까지만 준다. 실제로 준 수를 돌려준다 */
export function payGame(w: Wallet, coins: number): number {
  const room = Math.max(0, DAILY_GAME_CAP - w.data.daily.earned);
  const paid = Math.max(0, Math.min(room, Math.floor(coins)));
  w.coins += paid;
  w.data.daily.earned += paid;
  return paid;
}

/** 화면에 돌려줄 지갑 (오늘의 퀘스트 id 포함) */
export function walletView(w: Wallet, houseNo: number) {
  return { coins: w.coins, data: w.data, daily: dailyQuests(w.data.day, houseNo).map((q) => q.id) };
}

/** 하루 카운터 하나 올리기 (예뻐요, 꾸미기 저장, 그림 저장). 실패해도 본 작업은 막지 않는다 */
export async function bumpDaily(db: D1Database, houseId: number, fn: (d: WalletData) => void): Promise<void> {
  try {
    const w = await loadWallet(db, houseId);
    fn(w.data);
    await saveWallet(db, houseId, w).run();
  } catch (e) {
    console.error('[wallet] bump', e);
  }
}
