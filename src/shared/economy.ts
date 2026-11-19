// 츄르(돈), 퀘스트, 낚시, 미니게임 규칙. 서버(api)와 화면(src/app)이 같이 쓴다.
// 서버가 최종 판단(지급, 한도)을 하고, 화면은 같은 규칙으로 진행도를 미리 보여 준다.
import { DECOR_ITEMS, isWinter, STARTER_ITEMS } from './config';

export const CURRENCY = '츄르';
/** 입주하면 처음 받는 츄르 */
export const WELCOME_COINS = 50;
/** 미니게임(물고기/광석 팔기, 생선 받기, 주민 집 방문)으로 하루에 받을 수 있는 츄르 상한. 퀘스트 보상은 따로 */
export const DAILY_GAME_CAP = 400;
/** 닉네임(= 고양이 이름) 바꾸기 값 */
export const RENAME_COST = 500;
/** 이사 (2026-11-18 사용자 요청): 첫 이사는 무료, 그다음부터 이 값. 지갑 owned 에 'moved_once' 가 남는다 */
export const MOVE_HOUSE_COST = 200;

// ── 한 번 사면 계속 쓰는 것 (2026-11-16 사용자 요청). 지갑 owned 에 key 로 들어간다 ──
export const UPGRADES = [
  { key: 'cat_car', label: '고양이 자동차', price: 500, desc: '타고 내릴 수 있어요. 더 빠르고, 뒤에 한 명 더 탈 수 있어요' },
  { key: 'room_big', label: '집 넓히기', price: 400, desc: '집 안이 8m에서 11m로 넓어지고 가구를 40개까지 놓아요' },
  { key: 'yard_big', label: '마당 넓히기', price: 300, desc: '마당이 6m에서 7.2m로 넓어져요. 이웃 화면에도 넓은 마당으로 보여요' },
  { key: 'roof_art', label: '지붕 그림 그리기', price: 100, desc: '한 번 사면 지붕 앞뒤에 그림을 계속 바꿔 그릴 수 있어요' },
] as const;
export type UpgradeKey = (typeof UPGRADES)[number]['key'];
export const upgradeDef = (key: string) => UPGRADES.find((u) => u.key === key);
/** 넓힌 집 안에 놓을 수 있는 가구 수, 방 한 변 절반 (씬 ROOM_HALF_BIG 과 같다) */
export const FREE_ROOM_MAX_BIG = 40;
export const ROOM_HALF_BIG = 5.5;

// ── 우편함 (2026-11-16): 집 앞 우편함에서 편지를 받는다. 처음 입주하면 환영 편지에 WELCOME_COINS ──
export interface MailItem {
  id: string;
  from: string;
  title: string;
  text: string;
  /** 같이 든 츄르 (받으면 0 이 된다) */
  coins: number;
  /** 같이 든 아이템 종류 (받으면 없어진다). 2026-11-16 겨울 눈사람 선물 */
  item?: string;
  /** 읽음 (편지를 열었음) */
  read: boolean;
}
export const MAIL_MAX = 20;
export const welcomeMail = (): MailItem => ({
  id: 'welcome',
  from: '이장 냥냥',
  title: '고양이섬에 온 걸 환영한다냥!',
  text: `입주를 축하한다냥! 이웃들이랑 사이좋게 지내자냥. 작은 선물로 ${WELCOME_COINS} 츄르를 넣어 두었다냥. 주민들에게 말을 걸면 부탁도 들어줄 수 있다냥.`,
  coins: WELCOME_COINS,
  read: false,
});

/** 겨울 선물 편지 (겨울 기간에 아직 눈사람이 없으면 우편함에 온다) */
export const WINTER_MAIL_ID = 'winter2026';
export const winterMail = (): MailItem => ({
  id: WINTER_MAIL_ID,
  from: '이장 냥냥',
  title: '섬에 눈이 왔다냥! 겨울 선물',
  text: '메리 크리스마스다냥! 겨울 한정 눈사람을 선물로 넣어 두었다냥. 눈사람은 마당에만 놓을 수 있다냥. 꾸미기 → 마당 꾸미기에서 찾아 보자냥.',
  coins: 0,
  item: 'snowman',
  read: false,
});
/** 겨울이면 아직 눈사람을 안 받은 사람 우편함에 선물 편지를 넣는다. 넣었으면 true */
export function addSeasonMail(data: WalletData, day = kstDay()): boolean {
  if (!isWinter(day) || data.owned.includes('snowman') || data.mail.some((m) => m.id === WINTER_MAIL_ID)) return false;
  data.mail.unshift(winterMail());
  data.mail.length = Math.min(data.mail.length, MAIL_MAX);
  return true;
}

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

// ── 동굴 광석 (2026-11-15) ──
// 낚은 물고기와 캔 광석은 바로 츄르가 되지 않고 가방(bag)에 들어간다. 잡화점 보리에게 팔면 츄르가 된다.

export interface OreDef {
  id: string;
  label: string;
  rarity: FishRarity;
  weight: number;
  price: number;
  color: string;
  /** 이 깊이(1~3)부터 나온다 */
  level: number;
}
export const ORES: readonly OreDef[] = [
  { id: 'pebble', label: '조약돌', rarity: 'junk', weight: 22, price: 1, color: '#c4bcae', level: 1 },
  { id: 'coal', label: '석탄', rarity: 'common', weight: 26, price: 4, color: '#4a4448', level: 1 },
  { id: 'copper', label: '구리 광석', rarity: 'common', weight: 22, price: 7, color: '#d9884e', level: 1 },
  { id: 'iron', label: '철광석', rarity: 'common', weight: 16, price: 11, color: '#a8adbb', level: 2 },
  { id: 'amethyst', label: '자수정', rarity: 'rare', weight: 6, price: 32, color: '#b07ce8', level: 2 },
  { id: 'gold', label: '금덩이', rarity: 'rare', weight: 4, price: 48, color: '#ffcf3f', level: 3 },
  { id: 'diamond', label: '반짝 다이아', rarity: 'legend', weight: 1, price: 120, color: '#8fe3ff', level: 3 },
];
export const oreDef = (id: string) => ORES.find((o) => o.id === id);
/** 동굴 깊이 수 (입구 방 → 더 깊은 방 → 가장 깊은 방) */
export const CAVE_LEVELS = 3;
/** 한 방에 있는 광석 바위 수 */
export const CAVE_NODES = 7;
/** 광석 하나 캐는 데 걸리는 최소 시간(초)과 한 번에 알릴 수 있는 수 */
export const MINE_MIN_SEC = 2;
export const MINE_PER_REPORT = 12;

/** 깊이 level 에서 캔 광석 */
export function rollOre(level: number, rand: () => number = Math.random): string {
  const pool = ORES.filter((o) => o.level <= level);
  const total = pool.reduce((s, o) => s + o.weight * (o.level === level ? 1.6 : 1), 0);
  let r = rand() * total;
  for (const o of pool) {
    r -= o.weight * (o.level === level ? 1.6 : 1);
    if (r < 0) return o.id;
  }
  return pool[0].id;
}

// ── 곤충 채집 (2026-11-19 사용자: "컨텐츠 더 추가") ──
// 걷는 동안 섬 여기저기에 곤충이 나타난다 (화면이 시간과 자리로 정한다). 가까이 가서 "잡기" → 가방에 들어가고 잡화점에서 판다.
// fly: 날아다니는 것(나비, 잠자리), ground: 땅에 있는 것(무당벌레, 사슴벌레), glow: 밤에만 빛나는 반딧불이.
export interface BugDef {
  id: string;
  label: string;
  rarity: FishRarity;
  weight: number;
  price: number;
  color: string;
  kind: 'fly' | 'ground' | 'glow';
  /** 나오는 때: 낮만, 밤만, 아무 때나 */
  time: 'day' | 'night' | 'any';
  /** 크기 배율 */
  size: number;
  /** 잡힐 확률 (0~1, 나머지는 놓쳐서 날아간다) */
  catchRate: number;
}
export const BUGS: readonly BugDef[] = [
  { id: 'cabbage_white', label: '배추흰나비', rarity: 'common', weight: 26, price: 3, color: '#f7f4ea', kind: 'fly', time: 'day', size: 1, catchRate: 0.9 },
  { id: 'yellow_butterfly', label: '노랑나비', rarity: 'common', weight: 20, price: 4, color: '#ffd84a', kind: 'fly', time: 'day', size: 1, catchRate: 0.88 },
  { id: 'ladybug', label: '무당벌레', rarity: 'common', weight: 18, price: 5, color: '#e8463c', kind: 'ground', time: 'any', size: 0.8, catchRate: 0.95 },
  { id: 'dragonfly', label: '고추잠자리', rarity: 'common', weight: 16, price: 8, color: '#ff6b3d', kind: 'fly', time: 'day', size: 1.15, catchRate: 0.75 },
  { id: 'cricket', label: '귀뚜라미', rarity: 'common', weight: 14, price: 6, color: '#8a6a3c', kind: 'ground', time: 'night', size: 0.9, catchRate: 0.85 },
  { id: 'firefly', label: '반딧불이', rarity: 'common', weight: 24, price: 7, color: '#e6ff6b', kind: 'glow', time: 'night', size: 0.8, catchRate: 0.85 },
  { id: 'swallowtail', label: '호랑나비', rarity: 'rare', weight: 5, price: 28, color: '#ffbf3a', kind: 'fly', time: 'day', size: 1.3, catchRate: 0.6 },
  { id: 'stag_beetle', label: '사슴벌레', rarity: 'rare', weight: 4, price: 35, color: '#5a3a28', kind: 'ground', time: 'night', size: 1.2, catchRate: 0.6 },
  { id: 'rhino_beetle', label: '장수풍뎅이', rarity: 'rare', weight: 4, price: 40, color: '#3d2a22', kind: 'ground', time: 'any', size: 1.3, catchRate: 0.55 },
  { id: 'blue_morpho', label: '파랑 나비', rarity: 'rare', weight: 3, price: 45, color: '#4aa8ff', kind: 'fly', time: 'any', size: 1.3, catchRate: 0.55 },
  { id: 'golden_stag', label: '황금 사슴벌레', rarity: 'legend', weight: 1, price: 100, color: '#ffcf3f', kind: 'ground', time: 'any', size: 1.4, catchRate: 0.4 },
];
export const bugDef = (id: string) => BUGS.find((b) => b.id === id);
/** 지금 때(낮/밤)에 나오는 곤충 중 하나 (r: 0~1) */
export function rollBug(r: number, night: boolean): BugDef {
  const pool = BUGS.filter((b) => b.time === 'any' || (b.time === 'night') === night);
  const total = pool.reduce((s, b) => s + b.weight, 0);
  let x = r * total;
  for (const b of pool) {
    x -= b.weight;
    if (x < 0) return b;
  }
  return pool[0];
}
/** 곤충 하나 잡는 데 걸리는 최소 시간(초)과 한 번에 알릴 수 있는 수 */
export const BUG_MIN_SEC = 3;
export const BUG_PER_REPORT = 10;

/** 가방 한 칸에 담을 수 있는 수, 가방 전체 */
export const BAG_STACK = 99;
export const BAG_MAX = 300;
/** 가방에 든 것 (물고기 또는 광석) */
export const bagDef = (id: string): { id: string; label: string; price: number; color: string; kind: 'fish' | 'ore' | 'bug'; rarity: FishRarity } | null => {
  const f = fishDef(id);
  if (f) return { id, label: f.label, price: f.price, color: f.color, kind: 'fish', rarity: f.rarity };
  const o = oreDef(id);
  if (o) return { id, label: o.label, price: o.price, color: o.color, kind: 'ore', rarity: o.rarity };
  const b = bugDef(id);
  if (b) return { id, label: b.label, price: b.price, color: b.color, kind: 'bug', rarity: b.rarity };
  return null;
};
export const bagCount = (bag: Record<string, number>) => Object.values(bag).reduce((s, n) => s + n, 0);

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

/** 주민 집(섬 모서리마다 있는 주민들의 집) 한 곳에 하루 한 번, 하루 다섯 곳까지 */
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
  /** 오늘 캔 광석 수, 판 물건 수 */
  mine: number;
  sold: number;
  /** 오늘 잡은 곤충 수 (2026-11-19) */
  bug: number;
  /** 오늘 주민에게 받은 퀘스트: id → 받을 때의 진행값 (그 뒤로 한 만큼만 친다) */
  accepted: Record<string, number>;
}
export interface WalletLife {
  fish: number;
  rare: number;
  visits: number;
  arcadeBest: number;
  draw: number;
  mine: number;
  sold: number;
  bug: number;
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
  /** 받아 둔 (아직 안 끝낸) 이야기 퀘스트 id */
  storyTaken: string[];
  /** 가방: 물고기/광석 id → 수 */
  bag: Record<string, number>;
  /** 마지막으로 광석을 알린 시각 (unix 초) */
  lastMine: number;
  /** 한 번이라도 잡은 물고기 id (도감) */
  dex: string[];
  /** 마지막으로 물고기를 알린 시각 (unix 초) */
  lastFish: number;
  /** 마지막으로 곤충을 알린 시각 (unix 초) */
  lastBug: number;
  /** 우편함 편지 (새것이 앞) */
  mail: MailItem[];
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
  mine: 0,
  sold: 0,
  bug: 0,
  accepted: {},
});

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** 이름 → 수. zero: 0 도 남긴다 (받은 퀘스트의 시작값은 0 일 수 있다) */
const numMap = (v: unknown, zero = false): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v))
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && Number.isFinite(n) && (n > 0 || (zero && n === 0))) out[k] = Math.floor(n);
  return out;
};
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
        mine: num(d.mine),
        sold: num(d.sold),
        bug: num(d.bug),
        accepted: numMap(d.accepted, true),
      }
    : emptyDaily();
  return {
    day: today,
    daily,
    life: { fish: num(l.fish), rare: num(l.rare), visits: num(l.visits), arcadeBest: num(l.arcadeBest), draw: num(l.draw), mine: num(l.mine), sold: num(l.sold), bug: num(l.bug) },
    owned: strs(o.owned),
    story: strs(o.story),
    storyTaken: strs(o.storyTaken),
    bag: numMap(o.bag),
    dex: strs(o.dex),
    lastFish: num(o.lastFish),
    lastMine: num(o.lastMine),
    lastBug: num(o.lastBug),
    mail: Array.isArray(o.mail)
      ? (o.mail as Array<Record<string, unknown>>)
          .filter((m) => m && typeof m.id === 'string')
          .slice(0, MAIL_MAX)
          .map((m) => ({
            id: String(m.id),
            from: String(m.from ?? ''),
            title: String(m.title ?? ''),
            text: String(m.text ?? ''),
            coins: num(m.coins),
            ...(typeof m.item === 'string' && m.item ? { item: m.item } : {}),
            read: m.read === true,
          }))
      : [],
  };
}
/** 안 읽었거나 츄르/선물이 든 편지 수 */
export const unreadMail = (data: WalletData) => data.mail.filter((m) => !m.read || m.coins > 0 || !!m.item).length;

/** 그 아이템을 가졌는지 (기본 아이템은 늘 가짐) */
export const owns = (data: WalletData, type: string) => STARTER_ITEMS.includes(type) || data.owned.includes(type);

/** 아직 없는 상점 아이템 중 하나 (선물 상자). 다 있으면 null */
export function prizeItem(data: WalletData, rand: () => number = Math.random, maxPrice = 100): string | null {
  const pool = DECOR_ITEMS.filter((i) => i.price !== null && i.price <= maxPrice && !owns(data, i.type));
  return pool.length ? pool[Math.floor(rand() * pool.length)].type : null;
}

// ── 퀘스트 (2026-11-15: 주민에게 말을 걸어 받는다) ──
// 주민마다 하루에 부탁 하나(오늘의 부탁)를 준다. 받으면 퀘스트 탭에 뜨고, 받은 뒤에 한 만큼만 친다.
// 한국 시간 자정에 모두 새로 바뀐다. 이야기 부탁(아이템 보상)은 한 번만 하는 특별 부탁이고 역시 받아야 시작된다.

export type QuestKey = 'fish' | 'rare' | 'arcadeBest' | 'visits' | 'like' | 'draw' | 'decorate' | 'mine' | 'sold' | 'bug';

/** 주민 역할. resident 는 그냥 이웃 (부탁은 없고 방문만) */
export type NpcRole = 'shop' | 'arcade' | 'fisher' | 'gardener' | 'explorer' | 'painter' | 'mailman';
export type HomeRole = NpcRole | 'resident';

export interface DailyQuestDef {
  id: string;
  /** 부탁하는 주민 */
  npc: NpcRole;
  label: string;
  /** 주민이 하는 말 */
  ask: string;
  key: QuestKey;
  target: number;
  coins: number;
  /** 어디서 하는지 (화면 안내) */
  hint: string;
}

// 2026-11-16: 주민 말투를 "~냥" 으로
export const DAILY_QUESTS: readonly DailyQuestDef[] = [
  { id: 'd_fish3', npc: 'fisher', label: '물고기 3마리 낚기', ask: '오늘 저녁거리가 없다냥... 물고기 3마리만 낚아 줄래냥?', key: 'fish', target: 3, coins: 30, hint: '연못이나 부두 끝에서 "낚시하기"' },
  { id: 'd_fish6', npc: 'fisher', label: '물고기 6마리 낚기', ask: '낚시 대회 연습 중이다냥. 6마리 낚으면 인정해 줄게냥!', key: 'fish', target: 6, coins: 45, hint: '연못이나 부두에서 낚시' },
  { id: 'd_rare', npc: 'fisher', label: '희귀한 물고기 낚기', ask: '금붕어나 참돔 같은 귀한 물고기 본 적 있냥? 하나만 낚아 오자냥!', key: 'rare', target: 1, coins: 50, hint: '금붕어, 비단잉어, 참돔, 황금 잉어, 참다랑어' },
  { id: 'd_arcade20', npc: 'arcade', label: '생선 받기 20점', ask: '오늘의 목표 점수는 20점이다냥! 넘겨 보자냥!', key: 'arcadeBest', target: 20, coins: 30, hint: '마을 광장 오락실 콩이에게 말 걸고 한 판' },
  { id: 'd_arcade35', npc: 'arcade', label: '생선 받기 35점', ask: '35점 넘기면 진짜 고수 인정이다냥.', key: 'arcadeBest', target: 35, coins: 45, hint: '마을 광장 오락실 콩이에게 말 걸고 한 판' },
  { id: 'd_sell5', npc: 'shop', label: '물건 5개 팔기', ask: '가게 진열대가 텅 비었다냥. 물고기든 광석이든 5개만 팔아 주자냥!', key: 'sold', target: 5, coins: 25, hint: '마을 광장 잡화점 보리에게 "팔기"' },
  { id: 'd_sell10', npc: 'shop', label: '물건 10개 팔기', ask: '오늘은 손님이 많다냥. 10개만 팔아 주면 고맙겠다냥!', key: 'sold', target: 10, coins: 40, hint: '마을 광장 잡화점 보리에게 "팔기"' },
  { id: 'd_visit2', npc: 'mailman', label: '이웃 집 2곳 들르기', ask: '편지가 너무 많다냥! 이웃 두 집에 안부 좀 전해 주자냥.', key: 'visits', target: 2, coins: 25, hint: '섬 모서리의 주민 집 문 앞에서 "들어가기"' },
  { id: 'd_visit3', npc: 'mailman', label: '이웃 집 3곳 들르기', ask: '오늘은 소포까지 있다냥. 이웃 세 집만 같이 돌자냥!', key: 'visits', target: 3, coins: 35, hint: '섬 모서리의 주민 집 문 앞에서 "들어가기"' },
  { id: 'd_decorate', npc: 'gardener', label: '내 집 꾸미기 저장하기', ask: '집 앞을 예쁘게 꾸미면 동네가 환해진다냥! 같이 꾸미자냥.', key: 'decorate', target: 1, coins: 20, hint: '꾸미기 탭' },
  { id: 'd_like2', npc: 'gardener', label: '다른 집에 예뻐요 2번', ask: '예쁜 집을 보면 칭찬해 주자냥. 두 집만!', key: 'like', target: 2, coins: 25, hint: '집을 누르고 예뻐요' },
  { id: 'd_bug3', npc: 'gardener', label: '곤충 3마리 잡기', ask: '꽃밭에 놀러 온 곤충들을 보고 싶다냥. 3마리만 잡아 와 줘냥!', key: 'bug', target: 3, coins: 30, hint: '걷다가 날아다니는 곤충 옆에서 "잡기"' },
  { id: 'd_bug6', npc: 'gardener', label: '곤충 6마리 잡기', ask: '곤충 도감을 만들고 있다냥! 6마리 잡아 오자냥.', key: 'bug', target: 6, coins: 45, hint: '밤에는 반딧불이와 사슴벌레가 나온다냥' },
  { id: 'd_draw', npc: 'painter', label: '그림 한 장 그리기', ask: '오늘은 영감이 안 떠오른다냥... 그림 하나 그려 줄래냥?', key: 'draw', target: 1, coins: 25, hint: '꾸미기 탭 → 그림 그리기' },
  { id: 'd_draw2', npc: 'painter', label: '그림 두 장 그리기', ask: '전시회를 열 거다냥! 그림 두 장만 그려 주자냥.', key: 'draw', target: 2, coins: 40, hint: '꾸미기 탭 → 그림 그리기' },
  { id: 'd_mine3', npc: 'explorer', label: '광석 3개 캐기', ask: '동굴에 반짝이는 바위가 있다냥. 3개만 캐 오자냥!', key: 'mine', target: 3, coins: 30, hint: '섬 북서쪽 산의 동굴에서 "캐기" 꾹 누르기' },
  { id: 'd_mine8', npc: 'explorer', label: '광석 8개 캐기', ask: '깊은 곳까지 가 볼 용기 있냥? 8개 캐 오자냥!', key: 'mine', target: 8, coins: 50, hint: '동굴 안쪽으로 더 들어가면 귀한 광석' },
];
/** 하루에 부탁을 이만큼 끝내면 받는 보너스 */
export const DAILY_ALL_ID = 'd_all';
export const DAILY_ALL_COINS = 30;
export const DAILY_COUNT = 3;
export const dailyQuest = (id: string) => DAILY_QUESTS.find((q) => q.id === id);

function mix(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** 그날 그 집에 주민마다 주는 오늘의 부탁 (날짜와 번지로 항상 같은 결과). 주민 일곱 명 → 부탁 일곱 개 */
export function dailyQuests(day: string, houseNo: number): DailyQuestDef[] {
  const seed = houseNo * 31 + [...day].reduce((s, c) => s * 33 + c.charCodeAt(0), 7);
  const roles: NpcRole[] = ['fisher', 'arcade', 'shop', 'gardener', 'explorer', 'painter', 'mailman'];
  return roles.map((role, i) => {
    const pool = DAILY_QUESTS.filter((q) => q.npc === role);
    return pool[mix(seed + i * 977) % pool.length];
  });
}

const rawValue = (data: WalletData, key: QuestKey) => (key === 'visits' ? data.daily.visits.length : data.daily[key]);
/** 받은 퀘스트의 진행값 (받은 뒤에 한 만큼. 최고 점수는 오늘 최고 점수 그대로) */
export function questValue(data: WalletData, q: { id: string; key: QuestKey }): number {
  const v = rawValue(data, q.key);
  if (q.key === 'arcadeBest') return v;
  const base = data.daily.accepted[q.id] ?? v;
  return Math.max(0, v - base);
}
/** 퀘스트를 받을 때 적어 두는 값 */
export const questBase = (data: WalletData, key: QuestKey) => rawValue(data, key);

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

/** 한 번만 하는 특별 부탁. 끝내면 아이템을 준다 (평생 누적으로 센다) */
export const STORY_QUESTS: readonly StoryQuestDef[] = [
  { id: 's_garden_plant', npc: 'gardener', label: '물고기 3마리 낚아 오기', ask: '화분에 줄 거름이 필요하다냥. 물고기 3마리만 잡아 주자냥!', key: 'fish', target: 3, item: 'plant', coins: 10 },
  { id: 's_garden_lamp', npc: 'gardener', label: '그림 2장 그리기', ask: '정원에 걸 그림이 보고 싶다냥. 2장만 그려 줘냥!', key: 'draw', target: 2, item: 'floor_lamp', coins: 10 },
  { id: 's_fisher_rack', npc: 'fisher', label: '희귀한 물고기 1마리', ask: '금붕어나 비단잉어를 낚으면 건조대를 하나 준다냥.', key: 'rare', target: 1, item: 'fish_rack', coins: 20 },
  { id: 's_fisher_hammock', npc: 'fisher', label: '물고기 20마리 낚기', ask: '진짜 낚시꾼이라면 20마리는 잡아야지냥. 해먹을 걸고 내기하자냥!', key: 'fish', target: 20, item: 'hammock', coins: 30 },
  { id: 's_shop_window', npc: 'shop', label: '물건 15개 팔기', ask: '단골이 되어 줘냥! 15개 팔면 창문을 하나 준다냥.', key: 'sold', target: 15, item: 'window', coins: 10 },
  { id: 's_arcade_tower', npc: 'arcade', label: '생선 받기 40점', ask: '40점을 넘기면 내 캣타워를 준다냥. 해 보자냥!', key: 'arcadeBest', target: 40, item: 'cat_tower', coins: 20 },
  { id: 's_explorer_shelf', npc: 'explorer', label: '광석 20개 캐기', ask: '동굴 지도를 만들고 있다냥. 광석 20개를 캐 오면 책장을 준다냥.', key: 'mine', target: 20, item: 'bookshelf', coins: 20 },
  { id: 's_garden_bugs', npc: 'gardener', label: '곤충 15마리 잡기', ask: '곤충을 15마리 잡아 오면 내 꽃밭 하나를 떼어 준다냥!', key: 'bug', target: 15, item: 'flower_bed', coins: 20 },
  { id: 's_explorer_bug', npc: 'explorer', label: '곤충 40마리 잡기', ask: '동굴 밖 숲에도 보물이 있다냥. 곤충 40마리를 잡으면 모닥불을 준다냥!', key: 'bug', target: 40, item: 'campfire', coins: 30 },
  { id: 's_painter_easel', npc: 'painter', label: '그림 3장 그리기', ask: '그림 세 장을 그려 오면 내 캔버스를 하나 준다냥. 그림을 걸어 두고 자랑하자냥!', key: 'draw', target: 3, item: 'easel', coins: 15 },
  { id: 's_mailman_bench', npc: 'mailman', label: '주민 집 6곳 방문', ask: '우편 배달을 도와주면 쉬어 갈 의자를 준다냥. 주민 집 6곳만 들르자냥!', key: 'visits', target: 6, item: 'sofa', coins: 20 },
];
export const storyQuest = (id: string) => STORY_QUESTS.find((q) => q.id === id);

export const NPC_INFO: Record<NpcRole, { name: string; title: string; hello: string }> = {
  shop: { name: '보리', title: '잡화점', hello: '어서 오라냥! 사고 싶은 것도, 팔고 싶은 것도 다 여기서 하자냥.' },
  arcade: { name: '콩이', title: '오락실', hello: '생선 받기 한 판 하자냥! 점수가 높으면 상품을 준다냥!' },
  fisher: { name: '멸치', title: '낚시꾼', hello: '연못에 큰 놈이 산다던데냥... 너도 낚아 보자냥?' },
  gardener: { name: '쑥이', title: '정원사', hello: '꽃이 예쁘게 폈지냥? 부탁 하나만 들어주자냥.' },
  explorer: { name: '두더지', title: '탐험가', hello: '저 산 동굴 안쪽에 반짝이는 게 있다냥. 같이 탐험하자냥!' },
  painter: { name: '물감', title: '화가', hello: '오늘도 그림 그리기 좋은 날이다냥! 그린 그림은 캔버스에 걸어 두자냥.' },
  mailman: { name: '편지', title: '우체부', hello: '편지 왔다냥! 집 앞 우편함도 꼭 열어 보자냥.' },
};

/** 이웃 주민(부탁 없이 방문만 하는 주민) 이름 */
export const RESIDENT_NAMES = ['모찌', '호두', '라떼', '구름', '두유', '밤톨', '나비', '단추'] as const;
export const residentName = (i: number) => RESIDENT_NAMES[mix(i) % RESIDENT_NAMES.length];

/**
 * 섬 모서리의 주민 집 8채의 주인 (씬 layout.ts 의 HOME_SPOTS 순서와 같다. 구역마다 같은 배치).
 * 0,1: 북서(동굴 산 앞) / 2,3: 북동(화가, 우체부) / 4,5: 남서 / 6,7: 남동
 */
export const HOME_ROLES: readonly HomeRole[] = ['explorer', 'resident', 'painter', 'mailman', 'fisher', 'resident', 'gardener', 'resident'];
/** 2026-11-16: 잡화점, 오락실 주인은 집 없이 마을 광장 장터 가판대에만 있다 (모서리에 빈 가게 집이 남던 것을 정리) */
export const STALL_ROLES: readonly NpcRole[] = ['shop', 'arcade'];
/** 주민 집 번호(구역 * 8 + 순번) → 주인 역할 */
export const homeRole = (homeId: number): HomeRole => HOME_ROLES[((homeId % HOME_ROLES.length) + HOME_ROLES.length) % HOME_ROLES.length];

// ── 산책냥 부탁 (2026-11-19 사용자: "주민들이 멀리 있으니 지나가면서 자연스럽게 퀘스트를 주면 좋겠다, 머리 위에 느낌표") ──
// 섬을 돌아다니는 산책냥(app/play/wanderers.ts, 구역마다 셋)이 하루에 한 마리당 부탁 하나를 들고 다닌다(머리 위 "!").
// 옆을 지나가면 말을 걸어 온다. 둘 중 하나:
//   give : 가방에 그 종류(물고기/광석/곤충)가 있으면 바로 하나 건네고 그 자리에서 츄르를 받는다 (팔 때보다 후하다)
//   count: 오늘의 부탁처럼 받은 뒤에 한 만큼 센다. 다 하면 산책냥을 다시 찾을 필요 없이 퀘스트에서 받는다
// 퀘스트 id 는 `w<산책냥 번호>:<부탁 id>` (예: w4:wg_fish). 그날 그 산책냥이 든 부탁만 받을 수 있다. 하루 WANDER_DAILY_MAX 개까지.

export interface WanderQuestDef {
  id: string;
  kind: 'give' | 'count';
  label: string;
  ask: string;
  /** give: 건네줄 가방 물건 종류 */
  bag?: 'fish' | 'ore' | 'bug';
  /** count: 셀 값과 목표 */
  key?: QuestKey;
  target?: number;
  coins: number;
  hint: string;
}

export const WANDER_QUESTS: readonly WanderQuestDef[] = [
  { id: 'wg_fish', kind: 'give', bag: 'fish', label: '물고기 한 마리 건네주기', ask: '배가 너무 고프다냥... 가방에 물고기 있으면 한 마리만 줄래냥?', coins: 25, hint: '연못이나 부두에서 낚은 물고기' },
  { id: 'wg_ore', kind: 'give', bag: 'ore', label: '광석 하나 건네주기', ask: '반짝이는 돌을 모으고 있다냥! 광석 하나만 나눠 줄래냥?', coins: 30, hint: '동굴에서 캔 광석' },
  { id: 'wg_bug', kind: 'give', bag: 'bug', label: '곤충 한 마리 건네주기', ask: '곤충 친구를 사귀고 싶다냥. 가방에 곤충 있으면 한 마리 보여 줄래냥?', coins: 25, hint: '걷다가 "잡기"로 잡은 곤충' },
  { id: 'wc_fish2', kind: 'count', key: 'fish', target: 2, label: '물고기 2마리 낚기', ask: '오늘 저녁은 생선 구이다냥! 2마리만 낚아 주면 고맙겠다냥.', coins: 20, hint: '연못이나 부두에서 낚시' },
  { id: 'wc_bug2', kind: 'count', key: 'bug', target: 2, label: '곤충 2마리 잡기', ask: '산책하다 나비를 놓쳤다냥... 곤충 2마리만 잡아 줄래냥?', coins: 20, hint: '날아다니는 곤충 옆에서 "잡기"' },
  { id: 'wc_mine2', kind: 'count', key: 'mine', target: 2, label: '광석 2개 캐기', ask: '동굴에 같이 가고 싶은데 무섭다냥. 광석 2개만 캐 와 줄래냥?', coins: 22, hint: '섬 북서쪽 산의 동굴에서 "캐기"' },
  { id: 'wc_like1', kind: 'count', key: 'like', target: 1, label: '이웃 집에 예뻐요 1번', ask: '이 동네에 예쁜 집이 많다냥! 마음에 드는 집에 예뻐요 하나 눌러 주자냥.', coins: 12, hint: '집을 누르고 예뻐요' },
  { id: 'wc_sell3', kind: 'count', key: 'sold', target: 3, label: '물건 3개 팔기', ask: '잡화점 보리가 손님을 기다린다냥. 물건 3개만 팔아 주자냥!', coins: 15, hint: '마을 광장 잡화점 보리에게 "팔기"' },
];
export const WANDER_DAILY_MAX = 5;
/** 산책냥 번호 상한 (구역 수 * 3 보다 넉넉히) */
export const WANDER_ID_MAX = 60;
export const wanderQuestDef = (id: string) => WANDER_QUESTS.find((q) => q.id === id);

/** 그날 그 집에게 그 산책냥이 든 부탁 (날짜, 번지, 산책냥 번호로 항상 같다) */
export function wanderQuestFor(day: string, houseNo: number, walker: number): WanderQuestDef {
  const seed = houseNo * 17 + [...day].reduce((s, c) => s * 31 + c.charCodeAt(0), 11);
  return WANDER_QUESTS[mix(seed + walker * 7919) % WANDER_QUESTS.length];
}
export const wanderQuestId = (walker: number, def: WanderQuestDef) => `w${walker}:${def.id}`;
/** `w4:wg_fish` → 산책냥 번호와 부탁 (모양이 틀리면 null. 오늘 그 산책냥 부탁인지는 따로 본다) */
export function parseWanderId(id: string): { walker: number; def: WanderQuestDef } | null {
  const m = /^w(\d{1,3}):([a-z0-9_]+)$/.exec(id);
  if (!m) return null;
  const walker = Number(m[1]);
  const def = wanderQuestDef(m[2]);
  return def && walker < WANDER_ID_MAX ? { walker, def } : null;
}
/** 오늘 받거나 끝낸 산책냥 부탁 수 */
export const wanderTakenToday = (data: WalletData) =>
  new Set([...Object.keys(data.daily.accepted), ...data.daily.claimed].filter((id) => parseWanderId(id))).size;
/** 가방에서 그 종류 물건 중 가장 싼 것 (건네줄 것, 잡동사니는 빼고). 없으면 null */
export function cheapestInBag(data: WalletData, kind: 'fish' | 'ore' | 'bug'): string | null {
  let best: string | null = null;
  let bestPrice = Infinity;
  for (const [id, n] of Object.entries(data.bag)) {
    const d = n > 0 ? bagDef(id) : null;
    if (d && d.kind === kind && d.rarity !== 'junk' && d.price < bestPrice) {
      best = id;
      bestPrice = d.price;
    }
  }
  return best;
}
/** 지금 이 산책냥이 나에게 줄 부탁이 남았는가 (머리 위 "!") */
export function wanderHasQuest(data: WalletData, houseNo: number, walker: number): boolean {
  const def = wanderQuestFor(data.day, houseNo, walker);
  const id = wanderQuestId(walker, def);
  if (id in data.daily.accepted || data.daily.claimed.includes(id)) return false;
  return wanderTakenToday(data) < WANDER_DAILY_MAX;
}
