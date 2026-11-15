// 고양이섬 앱 입구: 씬 캔버스 + 상단 HUD + 하단 메뉴 + 화면 전환 + 걷기.
// 씬은 src/scene 의 공개 함수(createIslandScene 등)로만 쓴다. 씬 내부 파일은 import 하지 않는다.
import './style.css';
import { createIslandScene } from '../scene';
import { fetchMe } from './net/api';
import { createRealtime } from './net/realtime';
import { currentRoute, go, onRoute, type Route, type ScreenId } from './router';
import { decorateScreen } from './screens/decorate';
import { houseScreen, openHouse } from './screens/house';
import { moveInScreen } from './screens/moveIn';
import { rankScreen } from './screens/rank';
import { searchScreen } from './screens/search';
import { settingsScreen } from './screens/settings';
import { drawScreen } from './screens/draw';
import { npcScreen } from './screens/npc';
import { questsScreen } from './screens/quests';
import { shopScreen } from './screens/shop';
import { debugPlaceWalker, houseSlot } from '../scene';
import { CURRENCY, type FishWhere } from '../shared/economy';
import { loadMyDrawings, setArtCenter, syncArt } from './art';
import { startArcade } from './play/arcade';
import { ctl } from './play/ctl';
import { createExplore, type Explore } from './play/explore';
import { startFishing } from './play/fishing';
import { pondsOf, townNpcs } from './play/npcs';
import { createPlacement } from './play/placement';
import { claimableCount, coins, refreshWallet } from './wallet';
import { initSound, play, setMusicMood } from './audio/sound';
import type { Screen } from './screens/types';
import {
  initState,
  onChange,
  refreshRegions,
  refreshVillage,
  regionLabel,
  setHighlightedRegion,
  setMe,
  state,
  toNextIsland,
  totalHouses,
} from './state';
import { pushHousesToScene } from './state';
import { esc } from './ui/dom';
import { toast } from './ui/toast';

const ICON: Record<string, string> = {
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  'move-in': '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h11V10"/><path d="M10.5 19.5v-5h3v5"/>',
  rank: '<path d="M5 20v-6M12 20V6M19 20v-9"/><path d="M3 20h18"/>',
  decorate: '<path d="M12 21c-4.5 0-8-3.2-8-7.5C4 8 8 4 12 3c4 1 8 5 8 10.5 0 4.3-3.5 7.5-8 7.5z"/><path d="M12 21V11"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="m9 21 2.5-6 2.5 2.5V21M8 11l3-3.5 3.5 1L17 12M11 8.5 9.5 15"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  quests: '<path d="M7 3.5h10a2 2 0 0 1 2 2v15l-3-2-2 2-2-2-2 2-2-2-3 2v-15a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h4"/>',
  chat: '<path d="M4 5.5h16v10H10l-4.5 4v-4H4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
  fish: '<path d="M3 12c3-4.5 9-6 14-3l4-3v12l-4-3c-5 3-11 1.5-14-3z"/><path d="M8 11.5h.01"/>',
  door: '<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"/><path d="M4 21h16M14.5 12.5h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const SCREENS: Record<Exclude<ScreenId, 'map'>, Screen> = {
  'move-in': moveInScreen,
  rank: rankScreen,
  decorate: decorateScreen,
  house: houseScreen,
  search: searchScreen,
  settings: settingsScreen,
  quests: questsScreen,
  shop: shopScreen,
  draw: drawScreen,
  npc: npcScreen,
};
const TABS: Array<{ id: ScreenId; label: string }> = [
  { id: 'map', label: '지도' },
  { id: 'move-in', label: '입주' },
  { id: 'rank', label: '순위' },
  { id: 'decorate', label: '꾸미기' },
  { id: 'quests', label: '퀘스트' },
];

// ── 화면 높이: 인스타 앱 안 브라우저는 dvh 를 늦게 반영할 때가 있어서 innerHeight 도 같이 쓴다 ──
const setVh = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
setVh();
window.addEventListener('resize', setVh);

// ── 씬 ──
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const scene = createIslandScene(canvas);
initState(scene);
pushHousesToScene(true);
const hour = new Date().getHours();
const isNight = hour >= 19 || hour < 6;
scene.setTimeOfDay(isNight ? 'night' : 'day');
initSound();
setMusicMood(isNight);

// ── 화면 뼈대 ──
const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="hud">
    <div class="hud-row">
      <div class="pill brand"><b>고양이섬</b><span id="hud-count">불러오는 중</span></div>
      <div class="hud-btns">
        <button class="pill coin-pill" id="hud-coin" hidden aria-label="${CURRENCY} 와 퀘스트"><i class="coin-dot"></i><span></span><em hidden></em></button>
        <button class="round" id="btn-search" aria-label="아이디로 집 찾기">${icon('search')}</button>
        <button class="round" id="btn-settings" aria-label="설정">${icon('gear')}</button>
      </div>
    </div>
    <div class="hud-row left">
      <div class="pill soft" id="hud-next" hidden></div>
      <button class="pill chip-top" id="hud-top" hidden></button>
      <button class="pill chip-region" id="hud-region" hidden></button>
    </div>
  </header>
  <div class="status" id="status" hidden></div>
  <button class="walk-btn" id="btn-walk" aria-pressed="false">${icon('walk')}<span>걷기</span></button>
  <button class="walk-end" id="btn-walk-end" hidden>${icon('close')}<span>걷기 끝</span></button>
  <section class="sheet" id="sheet" aria-hidden="true" role="dialog" aria-labelledby="sheet-title">
    <div class="sheet-head">
      <h2 id="sheet-title"></h2>
      <button class="close" id="sheet-close" aria-label="닫기">${icon('close')}</button>
    </div>
    <div class="sheet-body" id="sheet-body"></div>
  </section>
  <nav class="tabbar" aria-label="메뉴">
    ${TABS.map((t) => `<a href="${t.id === 'map' ? '#/' : `#/${t.id}`}" data-tab="${t.id}">${icon(t.id)}<span>${t.label}</span></a>`).join('')}
  </nav>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sheet = $('sheet');
const sheetBody = $('sheet-body');
let cleanup: (() => void) | void;
let ready = false;

const TAB_OF: Partial<Record<ScreenId, ScreenId>> = { house: 'map', search: 'map', settings: 'map', npc: 'map', shop: 'decorate', draw: 'decorate' };
function show(route: Route) {
  const tabId = TAB_OF[route.id] ?? route.id;
  for (const a of app.querySelectorAll<HTMLAnchorElement>('[data-tab]')) {
    const on = a.dataset.tab === tabId;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  cleanup?.();
  cleanup = undefined;
  const wasOpen = sheet.classList.contains('open');
  if (route.id === 'map' || !ready) {
    if (wasOpen) play('close');
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    explore.refresh();
    return;
  }
  const screen = SCREENS[route.id];
  $('sheet-title').textContent = screen.title;
  sheetBody.scrollTop = 0;
  sheetBody.innerHTML = '';
  // 판마다 새 요소를 써서 이전 판의 이벤트가 남지 않게 한다
  const root = document.createElement('div');
  sheetBody.appendChild(root);
  cleanup = screen.render(root, route.param, {
    setTitle: (t) => ($('sheet-title').textContent = t),
    close: () => go('map'),
  });
  if (!wasOpen) play('open');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  explore.refresh();
}

$('sheet-close').addEventListener('click', () => go('map'));
$('btn-search').addEventListener('click', () => go('search'));
$('btn-settings').addEventListener('click', () => go('settings'));
onRoute(show);
scene.onHouseTap((no) => {
  if (ctl.placement?.active()) return;
  play('meow');
  const s = houseSlot(no);
  setArtCenter(s.x, s.z);
  openHouse(no);
});

// ── 상단 HUD ──
function drawHud() {
  const count = $('hud-count');
  const next = $('hud-next');
  if (state.offline && totalHouses() === 0) {
    count.textContent = '구경 중';
    next.hidden = true;
  } else {
    count.textContent = `입주 ${totalHouses().toLocaleString()}마리`;
    next.textContent = `다음 섬까지 ${toNextIsland().toLocaleString()}마리`;
    next.hidden = false;
  }
  const top = $('hud-top');
  const t = state.todayTop ? state.houses.get(state.todayTop.houseNo) : null;
  top.hidden = !t;
  if (t) top.innerHTML = `${icon('star')}<span>오늘의 특이한 집 @${esc(t.igHandle ?? '')}</span>`;
  const reg = $('hud-region');
  reg.hidden = !state.highlightedRegion;
  if (state.highlightedRegion) reg.innerHTML = `<span>${esc(regionLabel(state.highlightedRegion))} 강조 중</span>${icon('close')}`;
  const coin = $('hud-coin');
  coin.hidden = !state.me || !state.wallet;
  coin.querySelector('span')!.textContent = `${coins().toLocaleString()} ${CURRENCY}`;
  const ready = claimableCount();
  const dot = coin.querySelector('em')!;
  dot.hidden = ready === 0;
  dot.textContent = String(ready);
  drawStatus();
}
$('hud-coin').addEventListener('click', () => go('quests'));
$('hud-top').addEventListener('click', () => state.todayTop && openHouse(state.todayTop.houseNo));
$('hud-region').addEventListener('click', () => setHighlightedRegion(null));
onChange(drawHud);
// 마을을 새로 받으면 (마당/지붕 그림이 바뀌었을 수 있으니) 주변 그림을 다시 모은다
let seenYards = state.yards;
onChange(() => {
  if (seenYards === state.yards) return;
  seenYards = state.yards;
  syncArt();
});

// ── 상태 줄 (혼자 둘러보는 중 등) ──
let rtSolo = false;
function drawStatus() {
  const el = $('status');
  const walking = explore?.walking() ?? false;
  const text = state.offline ? '서버에 연결할 수 없어 혼자 둘러보는 중' : walking && rtSolo && state.me ? '혼자 둘러보는 중' : '';
  el.textContent = text;
  el.hidden = !text;
}

// ── 걷기, 집 안, 주민, 낚시 (단계 B + 작업 4 연결) ──
let lastAnim = 'idle';
// 실시간이 받은 다른 유저는 explore 를 거쳐 주민(NPC)과 섞어서 씬에 넘긴다
let explore: Explore;
const rtScene = Object.create(scene) as typeof scene;
rtScene.setRemotePlayers = (players) => explore?.setNetPlayers(players);
const realtime = createRealtime(rtScene, {
  onSolo(solo) {
    rtSolo = solo;
    drawStatus();
  },
  onLocalMove(s) {
    if (s.anim === 'jump' && lastAnim !== 'jump') play('jump');
    lastAnim = s.anim;
  },
});

// 미니게임 방 시험: 주소에 ?room=test 를 붙이고 걷기를 누르면 방 'test' 에 들어간다 (방 안은 거리와 상관없이 모두 보임)
const testRoom = new URLSearchParams(location.search).get('room');
if (testRoom) realtime.joinRoom(testRoom);

explore = createExplore(scene, realtime, {
  icon,
  onWalking(on) {
    $('btn-walk').setAttribute('aria-pressed', String(on));
    $('btn-walk-end').hidden = !on;
    if (on) {
      go('map');
      if (state.me && testRoom) toast(`미니게임 시험 방 '${testRoom}' 에 들어왔어요`);
    } else {
      ctl.placement?.cancel();
      rtSolo = false;
    }
    drawStatus();
  },
  onInside() {
    if (ctl.placement?.active()) ctl.placement.cancel();
  },
  talk(npc) {
    go('npc', npc.role === 'resident' ? `resident-${npc.houseNo}` : npc.role);
  },
  fish(where) {
    play('tap');
    fishHere(where);
  },
});

/** 낚시 판을 열고, 판의 단계에 맞춰 내 고양이 낚시 모습(씬)과 다른 유저에게 보낼 낚시 단계(실시간)를 바꾼다 */
function fishHere(where: FishWhere) {
  startFishing({
    where,
    onPose(pose) {
      scene.setFishing(pose);
      realtime.setFishing(pose);
    },
    onEnd: () => explore.refresh(),
  });
  explore.refresh();
}
ctl.explore = explore;
ctl.placement = createPlacement(scene, explore);
ctl.arcade = () => {
  startArcade(() => explore.refresh());
  explore.refresh();
};
ctl.fishing = () => fishHere(explore.fishSpot() ?? 'pond');
// 확인용 (콘솔에서 __catIsland.realtime.debug())
(window as unknown as { __catIsland: unknown }).__catIsland = { realtime, state, ctl, place: (x: number, z: number) => debugPlaceWalker(scene, x, z), moveTo: (x: number, z: number) => scene.setLocalPosition(x, z), local: () => scene.getLocalState(), npcs: () => townNpcs(state.unlockedZones), ponds: () => pondsOf(state.unlockedZones) };

$('btn-walk').addEventListener('click', () => explore.setWalking(true));
$('btn-walk-end').addEventListener('click', () => explore.setWalking(false));

// ── 데이터 불러오기 ──
async function boot() {
  const [meRes] = await Promise.allSettled([fetchMe(), refreshVillage()]);
  if (meRes.status === 'fulfilled' && meRes.value.house) {
    state.hideHandle = !!meRes.value.hideHandle;
    setMe(meRes.value.house);
    pushHousesToScene();
    const s = houseSlot(meRes.value.house.houseNo);
    setArtCenter(s.x, s.z);
    void refreshWallet();
    void loadMyDrawings().then(syncArt);
  }
  syncArt();
  ready = true;
  drawHud();
  const route = currentRoute();
  if (route.id === 'house' && route.param) scene.focusHouse(Number(route.param));
  else if (state.me && route.id === 'map') scene.focusHouse(state.me.houseNo);
  show(route);
  refreshRegions();
  // 맨 처음 온 사람: 바로 고양이 고르기(입주 화면)를 연다. 닫으면 섬을 그냥 둘러볼 수 있다 (한 번만)
  if (!state.me && !state.offline && route.id === 'map' && !welcomed()) go('move-in');
}
boot();

function welcomed(): boolean {
  try {
    if (localStorage.getItem('ci_welcomed')) return true;
    localStorage.setItem('ci_welcomed', '1');
  } catch {
    /* 저장이 막힌 브라우저: 매번 열어 준다 */
  }
  return false;
}

// 화면에 돌아오면 (1분 넘게 지났으면) 마을을 새로 불러온다
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 60_000) {
    lastRefresh = Date.now();
    refreshVillage();
  }
});
setInterval(() => {
  if (document.visibilityState === 'visible' && !explore.walking()) {
    lastRefresh = Date.now();
    refreshVillage();
  }
}, 120_000);
