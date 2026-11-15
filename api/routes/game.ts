// 상점, 퀘스트 보상, 미니게임(낚시, 생선 받기), 주민 집 방문.
// 츄르를 주는 곳은 모두 서버가 정한다. 화면이 보낸 결과는 시간/횟수/하루 상한으로 검사한다.
import { decorItem } from '../../src/shared/config';
import {
  BAG_MAX,
  BAG_STACK,
  bagCount,
  bagDef,
  CAVE_LEVELS,
  dailyQuest,
  DAILY_COUNT,
  homeRole,
  MINE_MIN_SEC,
  MINE_PER_REPORT,
  oreDef,
  questBase,
  ARCADE_MAX_SCORE,
  ARCADE_PAID_PLAYS,
  ARCADE_PRIZE_SCORE,
  ARCADE_SEC,
  arcadeCoins,
  DAILY_ALL_COINS,
  DAILY_ALL_ID,
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

/** 받을 수 있는 오늘의 부탁인가 (오늘 그 집에 나온 것) */
const isToday = (w: Wallet, houseNo: number, id: string) => dailyQuests(w.data.day, houseNo).some((q) => q.id === id);

/** POST /api/quest/accept {id} : 주민에게 부탁을 받는다 (오늘의 부탁 또는 특별 부탁) */
export const accept = (request: Request, env: Env) =>
  withWallet(request, env, (w, body, { houseNo }) => {
    const id = typeof body.id === 'string' ? body.id : '';
    const dq = dailyQuest(id);
    if (dq) {
      if (!isToday(w, houseNo, id)) return error(400, 'not_today', '오늘의 부탁이 아니에요');
      if (w.data.daily.claimed.includes(id)) return error(400, 'claimed', '오늘은 이미 끝낸 부탁이에요');
      if (!(id in w.data.daily.accepted)) w.data.daily.accepted[id] = questBase(w.data, dq.key);
      return { accepted: id };
    }
    const sq = storyQuest(id);
    if (sq) {
      if (w.data.story.includes(id)) return error(400, 'claimed', '이미 끝낸 부탁이에요');
      if (!w.data.storyTaken.includes(id)) w.data.storyTaken.push(id);
      return { accepted: id };
    }
    return error(400, 'no_quest', '없는 부탁이에요');
  });

/** POST /api/quest/claim {id} : 받은 부탁의 보상 (오늘의 부탁, 오늘 셋 끝내기 보너스, 특별 부탁) */
export const claim = (request: Request, env: Env) =>
  withWallet(request, env, (w, body, { houseNo }) => {
    const id = typeof body.id === 'string' ? body.id : '';
    const d = w.data.daily;
    if (id === DAILY_ALL_ID) {
      if (d.claimed.includes(id)) return error(400, 'claimed', '이미 받았어요');
      if (d.claimed.filter((c) => !!dailyQuest(c)).length < DAILY_COUNT) return error(400, 'not_done', `오늘 부탁을 ${DAILY_COUNT}개 끝내면 받을 수 있어요`);
      d.claimed.push(id);
      w.coins += DAILY_ALL_COINS;
      return { coins: DAILY_ALL_COINS };
    }
    const dq = dailyQuest(id);
    if (dq) {
      if (!isToday(w, houseNo, id)) return error(400, 'not_today', '오늘의 부탁이 아니에요');
      if (d.claimed.includes(id)) return error(400, 'claimed', '이미 받았어요');
      if (!(id in d.accepted)) return error(400, 'not_accepted', '먼저 주민에게 부탁을 받아 주세요');
      if (questValue(w.data, dq) < dq.target) return error(400, 'not_done', '아직 다 못 했어요');
      d.claimed.push(id);
      w.coins += dq.coins;
      return { coins: dq.coins };
    }
    const sq = storyQuest(id);
    if (sq) {
      if (w.data.story.includes(id)) return error(400, 'claimed', '이미 받았어요');
      if (!w.data.storyTaken.includes(id)) return error(400, 'not_accepted', '먼저 주민에게 부탁을 받아 주세요');
      if (w.data.life[sq.key] < sq.target) return error(400, 'not_done', '아직 다 못 했어요');
      w.data.story.push(id);
      w.data.storyTaken = w.data.storyTaken.filter((x) => x !== id);
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

/** 가방에 하나 넣는다. 가득 차면 false */
function putInBag(w: Wallet, id: string): boolean {
  const bag = w.data.bag;
  if ((bag[id] ?? 0) >= BAG_STACK || bagCount(bag) >= BAG_MAX) return false;
  bag[id] = (bag[id] ?? 0) + 1;
  return true;
}

/**
 * POST /api/game/fish {catches: [{id, cm}]} : 낚은 물고기를 모아서 알린다 (낚시를 마칠 때 한 번).
 * 물고기는 가방에 들어가고, 잡화점에 팔아야 츄르가 된다 (2026-11-15).
 * 물고기 하나에 FISH_MIN_SEC 초는 걸리므로, 지난번 알린 뒤 지난 시간보다 많이 잡았다고 하면 그만큼만 친다.
 */
export const fish = (request: Request, env: Env) =>
  withWallet(request, env, (w, body) => {
    if (!Array.isArray(body.catches) || !body.catches.length) return error(400, 'bad_request', '잡은 물고기가 없어요');
    const now = Math.floor(Date.now() / 1000);
    const since = w.data.lastFish ? now - w.data.lastFish : 3600;
    const allowed = Math.min(FISH_PER_REPORT, Math.floor(since / FISH_MIN_SEC));
    let counted = 0;
    let full = false;
    for (const c of (body.catches as Array<Record<string, unknown>>).slice(0, allowed)) {
      const def = typeof c?.id === 'string' ? fishDef(c.id) : undefined;
      if (!def) continue;
      counted++;
      w.data.daily.fish += 1;
      w.data.life.fish += 1;
      if (isRareFish(def.id)) {
        w.data.daily.rare += 1;
        w.data.life.rare += 1;
      }
      if (!w.data.dex.includes(def.id)) w.data.dex.push(def.id);
      if (!putInBag(w, def.id)) full = true;
    }
    if (counted) w.data.lastFish = now;
    return { counted, coins: 0, full };
  });

/** POST /api/game/mine {ores: [{id, level}]} : 동굴에서 캔 광석을 모아서 알린다. 가방에 들어간다 */
export const mine = (request: Request, env: Env) =>
  withWallet(request, env, (w, body) => {
    if (!Array.isArray(body.ores) || !body.ores.length) return error(400, 'bad_request', '캔 광석이 없어요');
    const now = Math.floor(Date.now() / 1000);
    const since = w.data.lastMine ? now - w.data.lastMine : 3600;
    const allowed = Math.min(MINE_PER_REPORT, Math.floor(since / MINE_MIN_SEC));
    let counted = 0;
    let full = false;
    for (const o of (body.ores as Array<Record<string, unknown>>).slice(0, allowed)) {
      const def = typeof o?.id === 'string' ? oreDef(o.id) : undefined;
      const level = typeof o?.level === 'number' ? o.level : 0;
      if (!def || !(level >= def.level && level <= CAVE_LEVELS)) continue;
      counted++;
      w.data.daily.mine += 1;
      w.data.life.mine += 1;
      if (!w.data.dex.includes(def.id)) w.data.dex.push(def.id);
      if (!putInBag(w, def.id)) full = true;
    }
    if (counted) w.data.lastMine = now;
    return { counted, full };
  });

/** POST /api/shop/sell {items: {id: 수}} : 잡화점에 물고기/광석을 판다. 하루 미니게임 츄르 상한까지만 팔린다 */
export const sell = (request: Request, env: Env) =>
  withWallet(request, env, (w, body) => {
    const want = body.items && typeof body.items === 'object' ? (body.items as Record<string, unknown>) : null;
    if (!want) return error(400, 'bad_request', '팔 물건이 없어요');
    let sold = 0;
    let coins = 0;
    let capped = false;
    for (const [id, n] of Object.entries(want)) {
      const def = bagDef(id);
      const have = w.data.bag[id] ?? 0;
      if (!def || typeof n !== 'number' || !Number.isFinite(n)) continue;
      const count = Math.min(have, Math.max(0, Math.floor(n)));
      for (let i = 0; i < count; i++) {
        const paid = payGame(w, def.price);
        if (paid < def.price) {
          // 하루 상한에 닿았으면 그 물건은 팔지 않는다 (받은 만큼은 되돌린다)
          w.coins -= paid;
          w.data.daily.earned -= paid;
          capped = true;
          break;
        }
        coins += paid;
        sold++;
        w.data.bag[id] -= 1;
      }
      if (!w.data.bag[id]) delete w.data.bag[id];
      if (capped) break;
    }
    w.data.daily.sold += sold;
    w.data.life.sold += sold;
    return { sold, coins, capped };
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

/** POST /api/game/visit {home} : 섬 모서리의 주민 집에 들어가 보기. 하루에 한 집 한 번, 다섯 곳까지 */
export const visit = (request: Request, env: Env) =>
  withWallet(request, env, (w, body) => {
    const home = body.home;
    if (!Number.isInteger(home) || (home as number) < 0 || (home as number) > 80_000) return error(400, 'bad_home', '주민 집이 이상해요');
    void homeRole(home as number);
    const key = -((home as number) + 1);
    const d = w.data.daily;
    if (d.visits.includes(key)) return { coins: 0, already: true };
    if (d.visits.length >= VISIT_MAX) return { coins: 0, full: true };
    d.visits.push(key);
    w.data.life.visits += 1;
    return { coins: payGame(w, VISIT_COINS) };
  });
