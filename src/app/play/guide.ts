// 처음 할 일 안내 (2026-11-18 사용자: "집 얻고 뭐 하라는 게 없으니까 이게 뭔가 싶다").
// 입주한 사람에게 해 볼 일 6가지를 차례로 알려 준다: 걷기 → 우편함 → 주민 부탁 → 낚시/캐기 → 팔기 → 마당 꾸미기.
// - 다 했는지는 되도록 서버 지갑(편지 읽음, 평생 기록, 받은 부탁)으로 보고, 걷기와 꾸미기만 이 브라우저에 적는다.
// - 한 번 다 한 단계는 이 브라우저에 적어 두어 다음 날(일일 부탁이 지워져도) 다시 안 한 걸로 돌아가지 않는다.
// - 위쪽 HUD 에 "처음 할 일 2/6 · 다음 일" 칩, 걷는 동안에는 왼쪽에 다음 일 알약, 판(#/guide)에 목록과 길 안내 버튼.
import { houseSlot, mailboxPos } from '../../scene';
import { bagCount, kstDay, normalizeWallet } from '../../shared/economy';
import { play } from '../audio/sound';
import { go } from '../router';
import { onChange, state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { ctl } from './ctl';
import { pondsOf, townNpcs } from './npcs';

export type GuideStepId = 'walk' | 'mail' | 'talk' | 'catch' | 'sell' | 'decorate';

export interface GuideStep {
  id: GuideStepId;
  emoji: string;
  title: string;
  how: string;
  /** 바로 하기 버튼 글자 */
  act: string;
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: 'walk', emoji: '🐾', title: '섬 걸어 보기', how: '오른쪽 아래 "걷기"를 누르고 왼쪽 아래를 끌면 내 고양이가 걸어요. 점프 버튼도 있어요.', act: '걷기 시작' },
  { id: 'mail', emoji: '📮', title: '우편함 열기', how: '우리 집 앞 우편함에 이장님 환영 편지가 와 있어요. 가까이 가서 "우편함 열기"를 누르면 츄르 선물!', act: '우편함으로 길 안내' },
  { id: 'talk', emoji: '💬', title: '주민 부탁 받기', how: '섬 모서리에 사는 주민 고양이에게 다가가 "말 걸기" → 부탁을 받아요. 들어주면 츄르를 줘요. 부탁은 매일 새로 생겨요.', act: '가까운 주민에게 길 안내' },
  { id: 'catch', emoji: '🎣', title: '물고기 낚기', how: '연못 둘레나 부두 끝에 서면 "낚시하기"가 떠요. 산 동굴에서 광석을 캐도 돼요. 잡은 건 가방에 들어가요.', act: '연못으로 길 안내' },
  { id: 'sell', emoji: '🪙', title: '잡화점에서 팔기', how: '마을 광장 장터의 잡화점 보리에게 말을 걸고 "팔기"에서 가방 속 물고기를 팔면 츄르가 돼요.', act: '잡화점으로 길 안내' },
  { id: 'decorate', emoji: '🪴', title: '마당 꾸미기', how: '아래 "꾸미기"에서 가구를 골라 마당에 놓고 저장해요. 모은 츄르로 새 가구도 살 수 있어요.', act: '꾸미기 열기' },
];

export const GUIDE_DAILY: readonly string[] = [
  '주민 부탁 3개 들어주기 (한국 시간 자정에 새로 생겨요, 셋 다 하면 보너스)',
  '광장 오락실 콩이의 생선 받기 한 판',
  '이웃 집 구경하고 예뻐요 누르기, 친구 맺기',
  '희귀한 물고기 잡아 도감 채우기, 동굴 깊이 캐러 가기',
  '그림 그려서 지붕이나 캔버스에 걸기',
];

// ── 이 브라우저에 적는 것 ──
const KEY = 'ci_guide';
interface Saved {
  house: number;
  /** 다 한 단계 */
  done: GuideStepId[];
  /** 안내 숨기기를 눌렀는지 */
  hidden: boolean;
}
let saved: Saved = { house: 0, done: [], hidden: false };
function load(houseNo: number) {
  if (saved.house === houseNo) return;
  saved = { house: houseNo, done: [], hidden: false };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (raw && raw.house === houseNo) saved = { house: houseNo, done: Array.isArray(raw.done) ? (raw.done.filter((d) => GUIDE_STEPS.some((s) => s.id === d)) as GuideStepId[]) : [], hidden: !!raw.hidden };
  } catch {
    /* 저장 막힘 */
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* 저장 막힘: 이번 창에서만 기억 */
  }
}

/** 지금 상태로 본 단계별 완료 여부 (지갑을 아직 못 받았으면 null) */
function check(): Record<GuideStepId, boolean> | null {
  const me = state.me;
  const w = state.wallet;
  if (!me || !w) return null;
  load(me.houseNo);
  const data = normalizeWallet(w.data, kstDay());
  const has = (id: GuideStepId) => saved.done.includes(id);
  const welcome = data.mail.find((m) => m.id === 'welcome');
  const r: Record<GuideStepId, boolean> = {
    walk: has('walk'),
    mail: has('mail') || !welcome || (welcome.read && welcome.coins === 0),
    talk: has('talk') || Object.keys(data.daily.accepted).length > 0 || data.daily.claimed.length > 0 || data.story.length > 0 || data.storyTaken.length > 0,
    catch: has('catch') || data.life.fish + data.life.mine > 0 || bagCount(data.bag) > 0,
    sell: has('sell') || data.life.sold > 0,
    decorate: has('decorate') || (state.yards.get(me.houseNo)?.length ?? 0) > 0,
  };
  // 걷지 않고는 할 수 없는 일을 했으면 걷기도 한 것
  if (r.mail && welcome?.read) r.walk = true;
  if (r.talk || r.catch || r.sell) r.walk = true;
  return r;
}

export interface GuideProgress {
  done: Record<GuideStepId, boolean>;
  count: number;
  total: number;
  next: GuideStep | null;
}
export function guideProgress(): GuideProgress | null {
  const done = check();
  if (!done) return null;
  const count = GUIDE_STEPS.filter((s) => done[s.id]).length;
  return { done, count, total: GUIDE_STEPS.length, next: GUIDE_STEPS.find((s) => !done[s.id]) ?? null };
}

/** 이 브라우저에서 한 일 (걷기, 꾸미기 저장) */
export function markGuide(id: GuideStepId) {
  if (!state.me) return;
  load(state.me.houseNo);
  if (saved.done.includes(id)) return;
  saved.done.push(id);
  persist();
  refresh();
}

export const guideHidden = () => {
  if (state.me) load(state.me.houseNo);
  return saved.hidden;
};
export function setGuideHidden(on: boolean) {
  if (!state.me) return;
  load(state.me.houseNo);
  saved.hidden = on;
  persist();
  refresh();
}

// ── 바로 하기 (길 안내) ──
function myPos(): { x: number; z: number } {
  if (ctl.explore?.walking()) return state.scene.getLocalState();
  const s = houseSlot(state.me!.houseNo);
  return { x: s.x, z: s.z };
}
const nearest = <T extends { x: number; z: number }>(list: readonly T[], p: { x: number; z: number }) =>
  list.reduce<T | null>((best, it) => (!best || Math.hypot(it.x - p.x, it.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? it : best), null);

const QUEST_ROLES = ['fisher', 'gardener', 'explorer', 'painter', 'mailman'];

export function doGuideStep(id: GuideStepId) {
  if (!state.me) return;
  const ex = ctl.explore;
  const map = ctl.minimap;
  // 집 안이나 동굴 안이면 먼저 나온다 (길 안내는 섬 위에서만)
  if (ex && (ex.inside() !== null || ex.caveLevel() > 0)) ex.exit();
  const p = myPos();
  const zones = state.unlockedZones;
  if (id === 'walk') {
    go('map');
    ex?.setWalking(true);
    toast('왼쪽 아래를 끌어서 걸어 봐요', 2400);
  } else if (id === 'mail') {
    const mb = mailboxPos(state.me.houseNo);
    go('map');
    map?.guideTo(mb.x, mb.z, '우리 집 우편함');
  } else if (id === 'talk') {
    const n = nearest(townNpcs(zones).filter((n) => QUEST_ROLES.includes(n.role)), p);
    go('map');
    if (n) map?.guideTo(n.x, n.z, n.name);
  } else if (id === 'catch') {
    const pond = nearest(pondsOf(zones), p);
    go('map');
    if (pond) {
      // 연못 한가운데는 물이라 못 가니, 내 쪽 물가로 안내한다
      const d = Math.hypot(p.x - pond.x, p.z - pond.z) || 1;
      const k = (pond.r + 1.4) / d;
      map?.guideTo(pond.x + (p.x - pond.x) * k, pond.z + (p.z - pond.z) * k, '연못 낚시터');
    }
  } else if (id === 'sell') {
    const n = nearest(townNpcs(zones).filter((n) => n.role === 'shop'), p);
    go('map');
    if (n) map?.guideTo(n.x, n.z, n.name);
  } else if (id === 'decorate') {
    go('decorate');
  }
}

// ── 화면 (HUD 칩, 걷는 동안 알약, 완료 알림) ──
let chip: HTMLButtonElement | null = null;
let pill: HTMLButtonElement | null = null;
let last: Record<GuideStepId, boolean> | null = null;
let lastHouse = 0;
let doneTimer = 0;

function refresh() {
  if (!chip || !pill) return;
  const pr = state.me ? guideProgress() : null;
  const show = !!pr && !!pr.next && !guideHidden() && !state.offline;
  chip.hidden = !show;
  pill.hidden = !show;
  if (pr && pr.next) {
    chip.innerHTML = `<b>처음 할 일 ${pr.count}/${pr.total}</b><span>${pr.next.emoji} ${esc(pr.next.title)}</span>`;
    pill.innerHTML = `<small>다음 할 일</small><span>${pr.next.emoji} ${esc(pr.next.title)}</span>`;
  }
  // 새로 끝낸 단계를 알린다 (처음 불러올 때와 집이 바뀔 때는 알리지 않는다)
  if (!pr) return;
  const house = state.me!.houseNo;
  const prev = lastHouse === house ? last : null;
  last = { ...pr.done };
  lastHouse = house;
  // 끝낸 단계는 적어 둔다 (다음 날 일일 부탁이 지워져도 그대로)
  let changed = false;
  for (const s of GUIDE_STEPS)
    if (pr.done[s.id] && !saved.done.includes(s.id)) {
      saved.done.push(s.id);
      changed = true;
    }
  if (changed) persist();
  if (!prev || guideHidden()) return;
  const fresh = GUIDE_STEPS.filter((s) => pr.done[s.id] && !prev[s.id]);
  if (!fresh.length) return;
  // 츄르 받은 알림과 겹치지 않게 조금 뒤에 알린다
  clearTimeout(doneTimer);
  doneTimer = window.setTimeout(() => {
    if (!pr.next) {
      play('fanfare');
      toast('처음 할 일을 다 했어요! 이제 매일 주민 부탁을 들어주며 섬 생활을 즐겨요 🐾', 4200);
    } else {
      play('ding');
      toast(`✅ ${fresh[fresh.length - 1].title} 완료! 다음은 ${pr.next.emoji} ${pr.next.title}`, 3400);
    }
  }, 1800);
}

/** main.ts 가 한 번 부른다 */
export function initGuide() {
  const row = document.querySelector('.hud-row.left');
  chip = document.createElement('button');
  chip.className = 'pill chip-guide';
  chip.hidden = true;
  chip.addEventListener('click', () => {
    play('tap');
    go('guide');
  });
  row?.prepend(chip);
  pill = document.createElement('button');
  pill.className = 'guide-walk';
  pill.hidden = true;
  pill.addEventListener('click', () => {
    play('tap');
    go('guide');
  });
  document.getElementById('app')!.appendChild(pill);
  onChange(refresh);
  refresh();
}
