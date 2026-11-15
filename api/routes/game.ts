// 상점, 퀘스트 보상, 미니게임(낚시, 생선 받기), 주민 집 방문.
// 츄르를 주는 곳은 모두 서버가 정한다. 화면이 보낸 결과는 시간/횟수/하루 상한으로 검사한다.
import { decorItem } from '../../src/shared/config';
import {
  ARCADE_MAX_SCORE,
  ARCADE_PAID_PLAYS,
  ARCADE_PRIZE_SCORE,
  ARCADE_SEC,
  arcadeCoins,
  DAILY_ALL_COINS,
  DAILY_ALL_ID,
  DAILY_QUESTS,
  dailyQuests,
  FISH_MIN_SEC,
  FISH_PER_REPORT,
  fishDef,
  isRareFish,
  owns,
  prizeItem,
  questValue,
  storyQuest,
  VISIT_COINS,
  VISIT_MAX,
  type Wallet,
} from '../../src/shared/economy';
import type { Env } from '../env';
import { clientIp, error, json, readJson } from '../http';
import { allow } from '../lib/rateLimit';
import { sessionHouse } from '../lib/session';
import { loadWallet, payGame, saveWallet, walletView } from '../lib/wallet';

type Handler = (w: Wallet, body: Record<string, unknown>, ctx: { houseNo: number; db: D1Database }) => Promise<Response | Record<string, unknown>> | Response | Record<string, unknown>;

/** 내 지갑을 읽고 → 처리 → 저장하는 공통 틀 */
async function withWallet(request: Request, env: Env, fn: Handler): Promise<Response> {
  if (!(await allow(env.RL_WRITE, `write:${clientIp(request)}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주하면 츄르를 모을 수 있어요');
  const body = (await readJson<Record<string, unknown>>(request, 4096)) ?? {};
  const w = await loadWallet(env.DB, mine.house.id);
  const out = await fn(w, body, { houseNo: mine.house.house_no, db: env.DB });
  if (out instanceof Response) return out;
  await saveWallet(env.DB, mine.house.id, w).run();
  return json({ ok: true, ...out, wallet: walletView(w, mine.house.house_no) });
}

/** POST /api/shop/buy {type} */
export const buy = (request: Request, env: Env) =>
  withWallet(request, env, (w, body) => {
    const def = typeof body.type === 'string' ? decorItem(body.type) : undefined;
    if (!def || def.price === null) return error(400, 'not_for_sale', '파는 물건이 아니에요');
    if (owns(w.data, def.type)) return error(400, 'owned', '이미 가지고 있어요');
    if (w.coins < def.price) return error(400, 'no_coins', `츄르가 ${def.price - w.coins}개 모자라요`);
    w.coins -= def.price;
    w.data.owned.push(def.type);
    return { bought: def.type };
  });

/** POST /api/quest/claim {id} : 오늘의 퀘스트, 오늘 전부 끝낸 보너스, 주민 부탁(이야기 퀘스트) */
export const claim = (request: Request, env: Env) =>
  withWallet(request, env, (w, body, { houseNo }) => {
    const id = typeof body.id === 'string' ? body.id : '';
    const d = w.data.daily;
    const todays = dailyQuests(w.data.day, houseNo);
    if (id === DAILY_ALL_ID) {
      if (d.claimed.includes(id)) return error(400, 'claimed', '이미 받았어요');
      if (!todays.every((q) => d.claimed.includes(q.id))) return error(400, 'not_done', '오늘의 퀘스트를 모두 끝내면 받을 수 있어요');
      d.claimed.push(id);
      w.coins += DAILY_ALL_COINS;
      return { coins: DAILY_ALL_COINS };
    }
    const dq = DAILY_QUESTS.find((q) => q.id === id);
    if (dq) {
      if (!todays.some((q) => q.id === id)) return error(400, 'not_today', '오늘의 퀘스트가 아니에요');
      if (d.claimed.includes(id)) return error(400, 'claimed', '이미 받았어요');
      if (questValue(w.data, dq.key) < dq.target) return error(400, 'not_done', '아직 다 못 했어요');
      d.claimed.push(id);
      w.coins += dq.coins;
      return { coins: dq.coins };
    }
    const sq = storyQuest(id);
    if (sq) {
      if (w.data.story.includes(id)) return error(400, 'claimed', '이미 받았어요');
      if (w.data.life[sq.key] < sq.target) return error(400, 'not_done', '아직 다 못 했어요');
      w.data.story.push(id);
      w.coins += sq.coins;
      // 이미 산 아이템이면 그 값만큼 츄르로 돌려준다
      const def = decorItem(sq.item);
      let refund = 0;
      if (owns(w.data, sq.item)) refund = def?.price ?? 0;
      else w.data.owned.push(sq.item);
      w.coins += refund;
      return { item: sq.item, coins: sq.coins + refund };
    }
    return error(400, 'no_quest', '없는 퀘스트예요');
  });

/**
 * POST /api/game/fish {catches: [{id, cm}]} : 낚은 물고기를 모아서 알린다 (낚시를 마칠 때 한 번).
 * 물고기 하나에 FISH_MIN_SEC 초는 걸리므로, 지난번 알린 뒤 지난 시간보다 많이 잡았다고 하면 그만큼만 친다.
 */
export const fish = (request: Request, env: Env) =>
  withWallet(request, env, (w, body) => {
    if (!Array.isArray(body.catches) || !body.catches.length) return error(400, 'bad_request', '잡은 물고기가 없어요');
    const now = Math.floor(Date.now() / 1000);
    const since = w.data.lastFish ? now - w.data.lastFish : 3600;
    const allowed = Math.max(1, Math.min(FISH_PER_REPORT, Math.floor(since / FISH_MIN_SEC)));
    const counted: Array<{ id: string; cm: number; coins: number }> = [];
    let total = 0;
    for (const c of (body.catches as Array<Record<string, unknown>>).slice(0, allowed)) {
      const def = typeof c?.id === 'string' ? fishDef(c.id) : undefined;
      if (!def) continue;
      const cm = typeof c.cm === 'number' ? Math.max(def.min, Math.min(def.max, Math.round(c.cm))) : def.min;
      counted.push({ id: def.id, cm, coins: def.price });
      total += def.price;
      w.data.daily.fish += 1;
      w.data.life.fish += 1;
      if (isRareFish(def.id)) {
        w.data.daily.rare += 1;
        w.data.life.rare += 1;
      }
      if (!w.data.dex.includes(def.id)) w.data.dex.push(def.id);
    }
    w.data.lastFish = now;
    const paid = payGame(w, total);
    return { counted: counted.length, coins: paid, capped: paid < total };
  });

/** POST /api/game/arcade {score, ms} : 생선 받기 한 판 */
export const arcade = (request: Request, env: Env) =>
  withWallet(request, env, (w, body) => {
    const score = body.score;
    const ms = body.ms;
    if (!Number.isInteger(score) || (score as number) < 0) return error(400, 'bad_score', '점수가 이상해요');
    if (typeof ms !== 'number' || ms < (ARCADE_SEC - 2) * 1000) return error(400, 'too_fast', '게임이 너무 빨리 끝났어요');
    const s = Math.min(score as number, ARCADE_MAX_SCORE);
    if ((score as number) > ARCADE_MAX_SCORE) return error(400, 'bad_score', '점수가 이상해요');
    const d = w.data.daily;
    d.arcadePlays += 1;
    d.arcadeBest = Math.max(d.arcadeBest, s);
    w.data.life.arcadeBest = Math.max(w.data.life.arcadeBest, s);
    const want = d.arcadePlays <= ARCADE_PAID_PLAYS ? arcadeCoins(s) : 0;
    const paid = payGame(w, want);
    let prize: string | null = null;
    let prizeCoins = 0;
    if (s >= ARCADE_PRIZE_SCORE && !d.prize) {
      d.prize = true;
      prize = prizeItem(w.data);
      if (prize) w.data.owned.push(prize);
      else {
        prizeCoins = 30;
        w.coins += prizeCoins;
      }
    }
    return { score: s, coins: paid + prizeCoins, prize, morePaid: Math.max(0, ARCADE_PAID_PLAYS - d.arcadePlays) };
  });

/** POST /api/game/visit {houseNo} : 주민 집(빈 집)에 들어가 보기. 하루에 한 집 한 번, 다섯 곳까지 */
export const visit = (request: Request, env: Env) =>
  withWallet(request, env, async (w, body, { houseNo: myNo, db }) => {
    const no = body.houseNo;
    if (!Number.isInteger(no) || (no as number) < 1 || (no as number) > 1_000_000 || no === myNo) return error(400, 'bad_house', '번지가 이상해요');
    const d = w.data.daily;
    if (d.visits.includes(no as number)) return { coins: 0, already: true };
    if (d.visits.length >= VISIT_MAX) return { coins: 0, full: true };
    // 주민 집 = 아직 아무도 입주하지 않은 번지
    const lived = await db.prepare('SELECT 1 FROM houses WHERE house_no = ?').bind(no).first();
    if (lived) return error(400, 'not_resident', '주민 집이 아니에요');
    d.visits.push(no as number);
    w.data.life.visits += 1;
    return { coins: payGame(w, VISIT_COINS) };
  });
