// 인스타 아이디 → 고양이. 같은 아이디는 언제 어디서나 같은 고양이가 나온다 (서버와 화면이 같이 쓴다).
import { ROOF_COLORS } from './config';
import type { CatLook, CatPattern } from './types';

export interface CatProfile extends CatLook {
  /** 고양이 이름 (한국어) */
  name: string;
  /** 무늬 이름 (한국어) */
  patternLabel: string;
  /** 성격 한 줄 */
  personality: string;
}

/** FNV-1a 32비트 해시 */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 해시에서 여러 개의 독립적인 값을 뽑는다 */
function picker(seed: number) {
  let s = seed || 1;
  return <T>(list: readonly T[]): T => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return list[(s >>> 0) % list.length];
  };
}

const KINDS: ReadonlyArray<{ pattern: CatPattern; label: string; furs: string[]; eyes: string[]; weight: number }> = [
  { pattern: 'cheese', label: '치즈', furs: ['#f4a650', '#f0b060', '#e99a48'], eyes: ['#7ac36a', '#e0a13a'], weight: 5 },
  { pattern: 'black', label: '까망', furs: ['#34313a', '#3a3438'], eyes: ['#f2c94c', '#8fd16a'], weight: 3 },
  { pattern: 'calico', label: '삼색', furs: ['#f0a04b', '#eb9a4a'], eyes: ['#e0a13a', '#7ac36a'], weight: 2 },
  { pattern: 'white', label: '하양', furs: ['#fffaf2', '#fbf3e6'], eyes: ['#6fb7e8', '#f0b44a'], weight: 3 },
  { pattern: 'gray', label: '회색', furs: ['#a9adb8', '#9aa0ad', '#b9bcc6'], eyes: ['#f0b44a', '#8fd16a'], weight: 3 },
  { pattern: 'tuxedo', label: '턱시도', furs: ['#35323a', '#3b363c'], eyes: ['#8fd16a', '#f2c94c'], weight: 3 },
];
const WEIGHTED = KINDS.flatMap((k) => Array<typeof k>(k.weight).fill(k));

const NAMES = [
  '모찌', '보리', '나비', '콩이', '두부', '코코', '하루', '초코', '밤이', '달이',
  '가을', '토리', '유자', '꼬미', '루루', '소미', '호떡', '감자', '망고', '쿠키',
  '젤리', '마루', '구름', '별이', '솜이', '치즈', '라떼', '모카', '찹쌀', '인절미',
  '복실', '단비', '봄이', '눈송', '탱이', '까미', '우유', '호두', '땅콩', '꿀떡',
];

const PERSONALITIES = [
  '야식 좋아하는 집사형',
  '창가 햇볕 독점형',
  '박스만 보면 들어가는 형',
  '새벽 4시 운동회 주최자',
  '간식 소리에 순간이동하는 형',
  '집사 키보드 위가 제일 좋은 형',
  '처음 본 사람한테도 배 보여 주는 형',
  '츤데레, 근데 꼭 옆에서 자는 형',
  '물은 꼭 흐르는 물로만 마시는 미식가',
  '세상 모든 끈의 사냥꾼',
  '하루 18시간 낮잠 장인',
  '택배 오면 제일 먼저 검사하는 형',
  '집사 퇴근 시간 정확히 아는 형',
  '빗질하면 골골송 콘서트 여는 형',
  '높은 곳 정복해야 직성이 풀리는 형',
  '거울 속 고양이랑 아직도 싸우는 형',
  '이불 속 동굴 탐험가',
  '꾹꾹이로 하루를 시작하는 형',
  '사진 찍으려면 꼭 고개 돌리는 형',
  '츄르 앞에서는 체면 버리는 형',
  '손님 오면 커튼 뒤 첩보원',
  '빈 화분 위가 내 자리인 형',
  '집사 머리맡 알람 담당',
  '물컵 쓰러뜨리기 연구원',
  '장난감보다 포장지가 좋은 형',
  '조용히 다가와 옆에 앉는 형',
  '수다쟁이 냥냥 토크쇼 진행자',
  '창밖 새 구경 생중계 해설자',
  '햇살 따라 자리 옮기는 형',
  '밥그릇 바닥 보이면 비상사태 선포형',
  '집사 무릎은 예약석인 형',
  '빨래 바구니 점령군',
  '노트북 열면 바로 출근하는 형',
  '느긋하게 걷는 섬 산책 대장',
  '동네 고양이 모임 반장',
  '첫눈 오면 제일 신난 형',
  '생선 냄새 탐지기',
  '꼬리로 기분 다 말하는 솔직형',
  '잠꼬대도 냥냥 하는 형',
  '오늘도 예쁨 담당',
];

/** 아이디로 정해지는 고양이 (털, 무늬, 눈, 이름, 성격) */
export function catLook(handle: string): CatProfile {
  const key = handle.trim().toLowerCase();
  const pick = picker(hashString(key));
  const kind = pick(WEIGHTED);
  return {
    pattern: kind.pattern,
    fur: pick(kind.furs),
    eyeColor: pick(kind.eyes),
    name: pick(NAMES),
    patternLabel: kind.label,
    personality: pick(PERSONALITIES),
  };
}

/** 입주할 때 처음 정해지는 지붕 색 (꾸미기에서 바꿀 수 있다) */
export function defaultRoofColor(handle: string): string {
  return ROOF_COLORS[hashString(`roof:${handle.toLowerCase()}`) % ROOF_COLORS.length];
}

// ── 입주할 때 고르는 고양이 (2026-11-15) ──
// 고른 고양이는 DB houses.cat 에 'pattern|털색|눈색' 으로 저장한다. 고르지 않은 예전 집은 아이디로 정해진 고양이(catLook)를 쓴다.
// 이름과 성격은 고르지 않고 아이디로 정해진다.

/** 고를 수 있는 무늬와 털색 (무늬마다 2~3가지, 서로 눈에 띄게 다른 색) */
export const CAT_CHOICES: ReadonlyArray<{ pattern: CatPattern; label: string; furs: readonly string[] }> = [
  { pattern: 'cheese', label: '치즈', furs: ['#f4a650', '#f7c27a', '#e0843a'] },
  { pattern: 'black', label: '까망', furs: ['#34313a', '#4b3e3a'] },
  { pattern: 'calico', label: '삼색', furs: ['#f0a04b', '#e8b878'] },
  { pattern: 'white', label: '하양', furs: ['#fffaf2', '#f1e2c8'] },
  { pattern: 'gray', label: '회색', furs: ['#a9adb8', '#7d8392', '#c9ccd4'] },
  { pattern: 'tuxedo', label: '턱시도', furs: ['#35323a', '#5d6270'] },
];
/** 고를 수 있는 눈 색 */
export const EYE_CHOICES: readonly string[] = ['#7ac36a', '#f2c94c', '#e0a13a', '#6fb7e8', '#a3b75a', '#d9773a'];

/** 아무 고양이 → 고를 수 있는 값 중 가장 가까운 것 (아이디 추천 고양이를 고르기 화면에 보여 줄 때) */
export function snapCatChoice(c: CatLook): CatLook {
  const kind = CAT_CHOICES.find((k) => k.pattern === c.pattern) ?? CAT_CHOICES[0];
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const near = (list: readonly string[], h: string) => {
    if (list.includes(h)) return h;
    const a = rgb(h);
    let best = list[0];
    let bd = Infinity;
    for (const x of list) {
      const b = rgb(x);
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < bd) [best, bd] = [x, d];
    }
    return best;
  };
  return { pattern: kind.pattern, fur: near(kind.furs, c.fur), eyeColor: near(EYE_CHOICES, c.eyeColor) };
}

export const patternLabelOf = (pattern: CatPattern) => KINDS.find((k) => k.pattern === pattern)?.label ?? '';

/** 화면이 보낸 고양이가 고를 수 있는 값인지 확인한다 (아니면 null) */
export function parseCatChoice(v: unknown): CatLook | null {
  if (!v || typeof v !== 'object') return null;
  const { pattern, fur, eyeColor } = v as Record<string, unknown>;
  const kind = CAT_CHOICES.find((k) => k.pattern === pattern);
  if (!kind || typeof fur !== 'string' || typeof eyeColor !== 'string') return null;
  if (!kind.furs.includes(fur) || !EYE_CHOICES.includes(eyeColor)) return null;
  return { pattern: kind.pattern, fur, eyeColor };
}

export const encodeCat = (c: CatLook) => `${c.pattern}|${c.fur}|${c.eyeColor}`;

/** DB 에 저장한 값 → 고양이 (없거나 이상하면 null) */
export function decodeCat(s: string | null | undefined): CatLook | null {
  if (!s) return null;
  const [pattern, fur, eyeColor] = s.split('|');
  return parseCatChoice({ pattern, fur, eyeColor });
}

/** 그 집의 고양이: 고른 고양이가 있으면 그것, 없으면 아이디로 정해진 고양이 */
export function houseCat(handle: string, stored: string | null | undefined): CatLook {
  const chosen = decodeCat(stored);
  if (chosen) return chosen;
  const look = catLook(handle);
  return { pattern: look.pattern, fur: look.fur, eyeColor: look.eyeColor };
}
