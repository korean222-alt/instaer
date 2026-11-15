// 츄르(돈), 퀘스트, 낚시, 미니게임 규칙. 서버(api)와 화면(src/app)이 같이 쓴다.
// 서버가 최종 판단(지급, 한도)을 하고, 화면은 같은 규칙으로 진행도를 미리 보여 준다.
import { DECOR_ITEMS, STARTER_ITEMS } from './config';

export const CURRENCY = '츄르';
/** 입주하면 처음 받는 츄르 */
export const WELCOME_COINS = 50;
/** 미니게임(낚시, 생선 받기, 주민 집 방문)으로 하루에 받을 수 있는 츄르 상한. 퀘스트 보상은 따로 */
export const DAILY_GAME_CAP = 300;

/** 한국 시간 날짜 'YYYY-MM-DD' (퀘스트는 한국 시간 자정에 바뀐다) */
export const kstDay = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

// ── 낚시 ──

export type FishRarity = 'junk' | 'common' | 'rare' | 'legend';
export interface FishDef {
  id: string;
  label: string;
  rarity: FishRarity;
  /** 잡힐 확률 가중치 */
  weight: number;
  /** 츄르 */
  price: number;
  /** 크기 범위 (cm) */
  min: number;
  max: number;
  /** 낚아 올리기 어려운 정도 0~1 (화면의 줄다리기 세기) */
  pull: number;
  /** 도감 그림 색 */
  color: string;
  /** 잡히는 곳: 연못, 바다(부두), 둘 다 */
  where: FishWhere | 'both';
}
/** 낚시하는 곳: 동네 연못 또는 1구역 항구 부두 */
export type FishWhere = 'pond' | 'sea';

export const FISH: readonly FishDef[] = [
  { id: 'minnow', label: '피라미', rarity: 'common', weight: 26, price: 3, min: 6, max: 14, pull: 0.15, color: '#a9c7d8', where: 'pond' },
  { id: 'crucian', label: '붕어', rarity: 'common', weight: 28, price: 4, min: 10, max: 28, pull: 0.25, color: '#b9a77a', where: 'pond' },
  { id: 'loach', label: '미꾸라지', rarity: 'common', weight: 14, price: 6, min: 9, max: 20, pull: 0.35, color: '#a08a62', where: 'pond' },
  { id: 'carp', label: '잉어', rarity: 'common', weight: 11, price: 12, min: 30, max: 70, pull: 0.5, color: '#9c8f70', where: 'pond' },
  { id: 'catfish', label: '메기', rarity: 'common', weight: 7, price: 18, min: 35, max: 90, pull: 0.62, color: '#6f6a64', where: 'pond' },
  { id: 'boot', label: '낡은 장화', rarity: 'junk', weight: 6, price: 1, min: 24, max: 30, pull: 0.1, color: '#7b6a5a', where: 'both' },
  { id: 'goldfish', label: '금붕어', rarity: 'rare', weight: 4, price: 30, min: 8, max: 18, pull: 0.55, color: '#ff8f3d', where: 'pond' },
  { id: 'koi', label: '비단잉어', rarity: 'rare', weight: 3, price: 45, min: 40, max: 80, pull: 0.72, color: '#ff6b5b', where: 'pond' },
  { id: 'goldkoi', label: '황금 잉어', rarity: 'legend', weight: 1, price: 80, min: 60, max: 100, pull: 0.85, color: '#ffc94a', where: 'pond' },
  // 바다 (부두 낚시, 씬 작업 5)
  { id: 'mackerel', label: '고등어', rarity: 'common', weight: 26, price: 5, min: 20, max: 40, pull: 0.3, color: '#5f8fa8', where: 'sea' },
  { id: 'flounder', label: '가자미', rarity: 'common', weight: 20, price: 8, min: 15, max: 40, pull: 0.4, color: '#b59a78', where: 'sea' },
  { id: 'rockfish', label: '우럭', rarity: 'common', weight: 14, price: 12, min: 20, max: 45, pull: 0.5, color: '#6d6560', where: 'sea' },
  { id: 'can', label: '빈 깡통', rarity: 'junk', weight: 5, price: 1, min: 10, max: 12, pull: 0.1, color: '#9aa3a8', where: 'sea' },
  { id: 'seabream', label: '참돔', rarity: 'rare', weight: 4, price: 40, min: 30, max: 70, pull: 0.7, color: '#ff8a8a', where: 'sea' },
  { id: 'bluefin', label: '참다랑어', rarity: 'legend', weight: 1, price: 90, min: 80, max: 150, pull: 0.9, color: '#3d5a80', where: 'sea' },
];
export const fishDef = (id: string) => FISH.find((f) => f.id === id);
export const isRareFish = (id: string) => {
  const r = fishDef(id)?.rarity;
  return r === 'rare' || r === 'legend';
};

/** rand: 0~1 난수 함수, where: 낚시하는 곳 → 잡힌 물고기와 크기 */
export function rollFish(rand: () => number = Math.random, where: FishWhere = 'pond'): { id: string; cm: number } {
  const pool = FISH.filter((f) => f.where === where || f.where === 'both');
  const total = pool.reduce((s, f) => s + f.weight, 0);
  let r = rand() * total;
  let pick = pool[0];
  for (const f of pool) {
    r -= f.weight;
    if (r < 0) {
      pick = f;
      break;
    }
  }
  return { id: pick.id, cm: Math.round(pick.min + (pick.max - pick.min) * rand()) };
}
/** 한 번에 알릴 수 있는 물고기 수, 한 마리 낚는 데 걸리는 최소 시간(초) */
export const FISH_PER_REPORT = 12;
export const FISH_MIN_SEC = 4;

// ── 생선 받기 (오락실 미니게임) ──

export const ARCADE_SEC = 30;
/** 30초 동안 낼 수 있는 점수 상한 (이보다 크면 서버가 거절) */
export const ARCADE_MAX_SCORE = 160;
/** 점수 → 츄르. 가장 높은 단계 하나만 받는다 */
export const ARCADE_TIERS = [
  { score: 15, coins: 10 },
  { score: 30, coins: 25 },
  { score: 50, coins: 40 },
] as const;
/** 하루에 처음 이 점수를 넘기면 선물 상자 (아직 없는 아이템 하나) */
export const ARCADE_PRIZE_SCORE = 50;
/** 하루에 츄르를 받을 수 있는 판 수 */
export const ARCADE_PAID_PLAYS = 8;
export const arcadeCoins = (score: number) => ARCADE_TIERS.reduce((c, t) => (score >= t.score ? t.coins : c), 0);

// ── 주민 집 방문 ──

/** 주민(빈 집) 한 곳에 하루 한 번, 하루 다섯 곳까지 */
export const VISIT_COINS = 5;
export const VISIT_MAX = 5;

// ── 지갑 (wallets.data JSON) ──

export interface WalletDaily {
  fish: number;
  rare: number;
  arcadeBest: number;
  arcadePlays: number;
  /** 오늘 방문한 주민 집 번지 */
  visits: number[];
  like: number;
  draw: number;
  decorate: number;
  /** 오늘 미니게임으로 받은 츄르 (DAILY_GAME_CAP 까지) */
  earned: number;
  /** 오늘 받은 퀘스트 보상 id */
  claimed: string[];
  /** 오늘 생선 받기 선물 상자를 받았는지 */
  prize: boolean;
}
export interface WalletLife {
  fish: number;
  rare: number;
  visits: number;
  arcadeBest: number;
  draw: number;
}
export interface WalletData {
  /** daily 가 어느 날 것인지 (한국 시간) */
  day: string;
  daily: WalletDaily;
  life: WalletLife;
  /** 상점이나 퀘스트로 얻은 아이템 종류 (기본 아이템은 빼고) */
  owned: string[];
  /** 끝낸 이야기 퀘스트 id */
  story: string[];
  /** 한 번이라도 잡은 물고기 id (도감) */
  dex: string[];
  /** 마지막으로 물고기를 알린 시각 (unix 초) */
  lastFish: number;
}

export interface Wallet {
  coins: number;
  data: WalletData;
}

const emptyDaily = (): WalletDaily => ({
  fish: 0,
  rare: 0,
  arcadeBest: 0,
  arcadePlays: 0,
  visits: [],
  like: 0,
  draw: 0,
  decorate: 0,
  earned: 0,
  claimed: [],
  prize: false,
});

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** 저장된 JSON(어떤 모양이든) → 빠진 값을 채우고, 날짜가 바뀌었으면 오늘 것을 새로 시작한 지갑 데이터 */
export function normalizeWallet(raw: unknown, today = kstDay()): WalletData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = (o.daily && typeof o.daily === 'object' ? o.daily : {}) as Record<string, unknown>;
  const l = (o.life && typeof o.life === 'object' ? o.life : {}) as Record<string, unknown>;
  const sameDay = o.day === today;
  const daily: WalletDaily = sameDay
    ? {
        fish: num(d.fish),
        rare: num(d.rare),
        arcadeBest: num(d.arcadeBest),
        arcadePlays: num(d.arcadePlays),
        visits: Array.isArray(d.visits) ? d.visits.filter((n): n is number => Number.isInteger(n)) : [],
        like: num(d.like),
        draw: num(d.draw),
        decorate: num(d.decorate),
        earned: num(d.earned),
        claimed: strs(d.claimed),
        prize: d.prize === true,
      }
    : emptyDaily();
  return {
    day: today,
    daily,
    life: { fish: num(l.fish), rare: num(l.rare), visits: num(l.visits), arcadeBest: num(l.arcadeBest), draw: num(l.draw) },
    owned: strs(o.owned),
    story: strs(o.story),
    dex: strs(o.dex),
    lastFish: num(o.lastFish),
  };
}

/** 그 아이템을 가졌는지 (기본 아이템은 늘 가짐) */
export const owns = (data: WalletData, type: string) => STARTER_ITEMS.includes(type) || data.owned.includes(type);

/** 아직 없는 상점 아이템 중 하나 (선물 상자). 다 있으면 null */
export function prizeItem(data: WalletData, rand: () => number = Math.random, maxPrice = 100): string | null {
  const pool = DECOR_ITEMS.filter((i) => i.price !== null && i.price <= maxPrice && !owns(data, i.type));
  return pool.length ? pool[Math.floor(rand() * pool.length)].type : null;
}

// ── 퀘스트 ──

export type QuestKey = 'fish' | 'rare' | 'arcadeBest' | 'visits' | 'like' | 'draw' | 'decorate';

export interface DailyQuestDef {
  id: string;
  label: string;
  key: QuestKey;
  target: number;
  coins: number;
  /** 어디서 하는지 (화면 안내) */
  hint: string;
}

export const DAILY_QUESTS: readonly DailyQuestDef[] = [
  { id: 'd_fish3', label: '물고기 3마리 낚기', key: 'fish', target: 3, coins: 30, hint: '연못 동네에서 걷다가 연못 가까이 가면 "낚시하기"' },
  { id: 'd_fish6', label: '물고기 6마리 낚기', key: 'fish', target: 6, coins: 45, hint: '연못 동네에서 낚시' },
  { id: 'd_rare', label: '희귀한 물고기 낚기', key: 'rare', target: 1, coins: 50, hint: '금붕어, 비단잉어, 황금 잉어' },
  { id: 'd_arcade20', label: '생선 받기 20점', key: 'arcadeBest', target: 20, coins: 30, hint: '광장 동네의 오락실 냥이에게 말 걸기' },
  { id: 'd_arcade35', label: '생선 받기 35점', key: 'arcadeBest', target: 35, coins: 45, hint: '광장 동네의 오락실 냥이' },
  { id: 'd_visit2', label: '주민 집 2곳 들어가 보기', key: 'visits', target: 2, coins: 25, hint: '빈 집(주민 집) 문 앞에서 "들어가기"' },
  { id: 'd_like2', label: '다른 집에 예뻐요 2번', key: 'like', target: 2, coins: 25, hint: '집을 누르고 예뻐요' },
  { id: 'd_decorate', label: '내 집 꾸미기 저장하기', key: 'decorate', target: 1, coins: 20, hint: '꾸미기 탭' },
  { id: 'd_draw', label: '그림 한 장 그리기', key: 'draw', target: 1, coins: 25, hint: '꾸미기 탭 → 그림 그리기' },
];
/** 오늘의 퀘스트 셋을 모두 끝내면 더 받는 보너스 */
export const DAILY_ALL_ID = 'd_all';
export const DAILY_ALL_COINS = 30;
export const DAILY_COUNT = 3;

function mix(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** 그날 그 집의 퀘스트 3개 (날짜와 번지로 항상 같은 결과). 같은 종류(key)는 겹치지 않는다 */
export function dailyQuests(day: string, houseNo: number): DailyQuestDef[] {
  let seed = houseNo * 31 + [...day].reduce((s, c) => s * 33 + c.charCodeAt(0), 7);
  const pool = [...DAILY_QUESTS];
  const out: DailyQuestDef[] = [];
  while (out.length < DAILY_COUNT && pool.length) {
    seed = mix(seed + out.length + 1);
    const q = pool.splice(seed % pool.length, 1)[0];
    if (out.some((o) => o.key === q.key)) continue;
    out.push(q);
  }
  return out;
}

export const questValue = (data: WalletData, key: QuestKey) => (key === 'visits' ? data.daily.visits.length : data.daily[key]);

/** NPC 역할 (동네 가운데에 사는 주민) */
export type NpcRole = 'shop' | 'arcade' | 'fisher' | 'gardener';

export interface StoryQuestDef {
  id: string;
  npc: NpcRole;
  label: string;
  /** 주민이 하는 말 */
  ask: string;
  key: keyof WalletLife;
  target: number;
  /** 보상 아이템 종류 */
  item: string;
  coins: number;
}

/** 한 번만 하는 주민 부탁. 끝내면 아이템을 준다 */
export const STORY_QUESTS: readonly StoryQuestDef[] = [
  { id: 's_garden_plant', npc: 'gardener', label: '물고기 3마리 낚아 오기', ask: '화분에 줄 거름이 필요해. 물고기 3마리만 잡아 줄래?', key: 'fish', target: 3, item: 'plant', coins: 10 },
  { id: 's_garden_lamp', npc: 'gardener', label: '그림 2장 그리기', ask: '정원에 걸 그림이 보고 싶어. 2장만 그려 줘!', key: 'draw', target: 2, item: 'floor_lamp', coins: 10 },
  { id: 's_fisher_rack', npc: 'fisher', label: '희귀한 물고기 1마리', ask: '금붕어나 비단잉어를 낚으면 건조대를 하나 줄게.', key: 'rare', target: 1, item: 'fish_rack', coins: 20 },
  { id: 's_fisher_hammock', npc: 'fisher', label: '물고기 20마리 낚기', ask: '진짜 낚시꾼이라면 20마리는 잡아야지. 해먹을 걸고 내기!', key: 'fish', target: 20, item: 'hammock', coins: 30 },
  { id: 's_shop_window', npc: 'shop', label: '주민 집 3곳 들어가 보기', ask: '이웃들 집에 안부 좀 전해 줘. 세 집이면 돼.', key: 'visits', target: 3, item: 'window', coins: 10 },
  { id: 's_arcade_tower', npc: 'arcade', label: '생선 받기 40점', ask: '40점을 넘기면 내 캣타워를 줄게. 해 볼래?', key: 'arcadeBest', target: 40, item: 'cat_tower', coins: 20 },
];
export const storyQuest = (id: string) => STORY_QUESTS.find((q) => q.id === id);

export const NPC_INFO: Record<NpcRole, { name: string; title: string; hello: string }> = {
  shop: { name: '보리', title: '잡화점', hello: '어서 와! 츄르만 있으면 뭐든 팔아.' },
  arcade: { name: '콩이', title: '오락실', hello: '생선 받기 한 판 할래? 점수가 높으면 상품을 줘!' },
  fisher: { name: '멸치', title: '낚시꾼', hello: '연못에 큰 놈이 산다던데... 너도 낚아 볼래?' },
  gardener: { name: '쑥이', title: '정원사', hello: '꽃이 예쁘게 폈지? 부탁 하나만 들어줄래?' },
};

/** 빈 집(주민 집)에 사는 고양이 이름 */
export const RESIDENT_NAMES = ['모찌', '호두', '감자', '구름', '두유', '라떼', '밤톨', '치즈', '나비', '깜냥', '보송', '단추'] as const;
export const residentName = (houseNo: number) => RESIDENT_NAMES[mix(houseNo) % RESIDENT_NAMES.length];
