// 고양이섬 앱 입구: 씬 캔버스 + 상단 HUD + 하단 메뉴 + 화면 전환 + 걷기.
// 씬은 src/scene 의 공개 함수(createIslandScene 등)로만 쓴다. 씬 내부 파일은 import 하지 않는다.
import './style.css';
import { createIslandScene } from '../scene';
import { getGraphicsMode, rememberAutoLow, rememberedAutoLow } from './graphics';
import { isWinter } from '../shared/config';
import { kstDay } from '../shared/economy';
import { fetchMe } from './net/api';
import { createRealtime } from './net/realtime';
import { currentRoute, go, onRoute, type Route, type ScreenId } from './router';
import { decorateScreen } from './screens/decorate';
import { houseScreen, openHouse } from './screens/house';
import { moveInScreen } from './screens/moveIn';
import { rankScreen } from './screens/rank';
import { searchScreen } from './screens/search';
import { settingsScreen } from './screens/settings';
import { adminScreen, reclaimScreen, reportScreen, wishScreen } from './screens/auth';
import { drawScreen } from './screens/draw';
import { npcScreen } from './screens/npc';
import { questsScreen } from './screens/quests';
import { shopScreen } from './screens/shop';
import { boardScreen, friendsScreen, newsUnseen } from './screens/social';
import { mailScreen } from './screens/mail';
import { createWalkQuests } from './play/walkQuests';
import { showArt } from './ui/artView';
import { debugPlaceWalker, houseSlot, mailboxPos } from '../scene';
import { CURRENCY, type FishWhere } from '../shared/economy';
import { loadMyDrawings, setArtCenter, syncArt } from './art';
import { startArcade } from './play/arcade';
import { ctl } from './play/ctl';
import { createExplore, type Explore } from './play/explore';
import { startFishing } from './play/fishing';
import { pondsOf, townNpcs } from './play/npcs';
import { createPlacement } from './play/placement';
import { createMinimap } from './play/minimap';
import { createSocial, type Social } from './play/social';
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
  pick: '<path d="M4 20 14 10"/><path d="M9.5 5.5c4-2.5 8.5-1.5 11 1-3-.8-6.5 0-9 2.5"/><path d="m12.5 7.5 4 4"/>',
  zoom: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  cat: '<path d="M5 20v-8l-1-7 4.5 3h7L20 5l-1 7v8z"/><path d="M9.5 13h.01M14.5 13h.01"/>',
  friends: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16 14.4c2.6.1 4.4 1.8 5 4.6"/>',
  board: '<path d="M4 5h16v11H4z"/><path d="M8 20l1.5-4M16 20l-1.5-4M8 9h4M8 12h7"/>',
  news: '<path d="M4 10v4l3 .5L15 19V5L7 9.5z"/><path d="M18 9.5c1.2.9 1.2 4.1 0 5"/>',
  sit: '<path d="M6 12h12v3H6z"/><path d="M7 15v5M17 15v5M8 12V6"/>',
  mail: '<path d="M4 9a4 4 0 0 1 8 0v9H4z"/><path d="M12 9h6a2 2 0 0 1 2 2v7h-8"/><path d="M8 14v-2M16 6V3h3"/>',
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
  board: boardScreen,
  friends: friendsScreen,
  mail: mailScreen,
  wish: wishScreen,
  report: reportScreen,
  reclaim: reclaimScreen,
  admin: adminScreen,
};
// 2026-11-15: 입주 탭은 뺐다 (입주 전에는 위쪽 "입주하기" 버튼, 내 고양이 카드는 설정에서)
const TABS: Array<{ id: ScreenId; label: string }> = [
  { id: 'map', label: '지도' },
  { id: 'rank', label: '순위' },
  { id: 'decorate', label: '꾸미기' },
  { id: 'quests', label: '퀘스트' },
  { id: 'friends', label: '친구' },
];

// ── 화면 높이: 인스타 앱 안 브라우저는 dvh 를 늦게 반영할 때가 있어서 innerHeight 도 같이 쓴다 ──
const setVh = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
setVh();
window.addEventListener('resize', setVh);

// ── 씬 ──
const canvas = document.getElementById('scene') as HTMLCanvasElement;
// 화면 품질 (2026-11-17): 설정에서 고른 값. '자동'이면 약한 폰이나 버거워하는 폰은 저사양으로 바뀐다
const scene = createIslandScene(canvas, { graphics: getGraphicsMode(), rememberLow: rememberedAutoLow() });
scene.onAutoLowSpec(() => {
  rememberAutoLow(true);
  toast('화면이 끊겨서 저사양 모드로 바꿨어요. 설정에서 바꿀 수 있어요');
});
initState(scene);
pushHousesToScene(true);
const hour = new Date().getHours();
const isNight = hour >= 19 || hour < 6;
scene.setTimeOfDay(isNight ? 'night' : 'day');
// 겨울 (2026-11-16): 기간 안이면 눈 쌓인 크리스마스 섬 (낮에는 나무에만 눈, 밤에는 땅과 빈 집 지붕에도)
scene.setWinter(isWinter(kstDay()));
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
      <button class="pill primary-pill" id="hud-movein" hidden>${icon('move-in')}<span>입주하기</span></button>
      <div class="pill soft" id="hud-next" hidden></div>
      <button class="pill chip-top" id="hud-top" hidden></button>
      <button class="pill chip-region" id="hud-region" hidden></button>
      <button class="pill chip-news" id="hud-news" hidden>${icon('news')}<span>이장님 새 소식</span></button>
    </div>
  </header>
  <div class="status" id="status" hidden></div>
  <button class="walk-btn" id="btn-walk" aria-pressed="false">${icon('walk')}<span>걷기</span></button>
  <button class="walk-end" id="btn-walk-end" hidden>${icon('close')}<span>걷기 끝</span></button>
  <button class="walk-zoom" id="btn-zoom" hidden aria-label="시야 넓히기">${icon('zoom')}<span>보통</span></button>
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

const TAB_OF: Partial<Record<ScreenId, ScreenId>> = { house: 'map', search: 'map', settings: 'map', npc: 'map', board: 'map', mail: 'map', wish: 'map', report: 'map', reclaim: 'map', admin: 'map', shop: 'decorate', draw: 'decorate', 'move-in': 'map' };
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
  if (t) top.innerHTML = `${icon('star')}<span>오늘의 특이한 집 ${esc(t.igHandle ?? '')}</span>`;
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
  $('hud-movein').hidden = !!state.me || state.offline;
  $('hud-news').hidden = !newsUnseen() || state.offline;
  const fr = app.querySelector<HTMLElement>('[data-tab="friends"]');
  fr?.classList.toggle('dot', state.friendRequests > 0);
  drawStatus();
}
$('hud-movein').addEventListener('click', () => go('move-in'));
$('hud-news').addEventListener('click', () => go('npc', 'mayor'));
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
let netPlayers: import('../shared/types').RemotePlayer[] = [];
rtScene.setRemotePlayers = (players) => {
  netPlayers = players;
  explore?.setNetPlayers(players);
};
const realtime = createRealtime(rtScene, {
  onSolo(solo) {
    rtSolo = solo;
    drawStatus();
  },
  onReplaced() {
    toast('다른 창에서 같은 고양이로 접속했어요. 이 창에서는 혼자 걸어요', 3200);
  },
  myHouseNo: () => state.me?.houseNo ?? null,
  onCar: (c) => explore?.carAck(c),
  onLocalMove(s) {
    if (s.anim === 'jump' && lastAnim !== 'jump') play('jump');
    lastAnim = s.anim;
    social?.onLocalMove(s);
  },
  onChat: (id, text) => social?.onChat(id, text),
  onEmote: (id, e) => social?.onEmote(id, e),
});
let social: Social | undefined;

// 미니게임 방 시험: 주소에 ?room=test 를 붙이고 걷기를 누르면 방 'test' 에 들어간다 (방 안은 거리와 상관없이 모두 보임)
const testRoom = new URLSearchParams(location.search).get('room');
if (testRoom) realtime.joinRoom(testRoom);

explore = createExplore(scene, realtime, {
  icon,
  onWalking(on) {
    $('btn-walk').setAttribute('aria-pressed', String(on));
    $('btn-walk-end').hidden = !on;
    $('btn-zoom').hidden = !on;
    minimap.setVisible(on);
    social?.setWalking(on);
    if (on) {
      go('map');
      if (state.me && testRoom) toast(`미니게임 시험 방 '${testRoom}' 에 들어왔어요`);
    } else {
      ctl.placement?.cancel();
      rtSolo = false;
    }
    drawStatus();
  },
  onInside(no) {
    if (ctl.placement?.active()) ctl.placement.cancel();
    // 집 안이나 동굴 안에서는 섬 지도를 숨긴다
    minimap.setVisible(explore.walking() && no === null && explore.caveLevel() === 0 && explore.inside() === null);
  },
  talk(npc) {
    go('npc', npc.role === 'resident' ? `resident-${npc.homeId}` : npc.role);
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
// 걷는 동안 받은 퀘스트 보기 (2026-11-16)
const walkQuests = createWalkQuests(icon);
onChange(() => walkQuests.refresh());
// 그림이 붙은 가구(캔버스, 액자, 간판, 러그)를 누르면 크게 보기 (2026-11-16)
scene.onArtTap((id, type) => {
  if (ctl.placement?.active()) return;
  play('tap');
  showArt(id, type);
});
social = createSocial(scene, realtime, icon);
// 지나가는 고양이를 누르면 그 고양이의 집(프로필)
scene.onRemoteTap((id) => {
  const info = realtime.playerInfo(id);
  if (!info || info.houseNo === null) return;
  play('meow');
  go('house', info.houseNo);
});
const minimap = createMinimap(scene, () => netPlayers, {
  walking: () => explore.walking(),
  startWalking: () => explore.setWalking(true),
  openHouse: (no) => go('house', no),
});
// "지도" 탭을 누르면 (판을 닫고) 섬 지도를 크게 연다. 걷지 않을 때도 된다
app.querySelector('[data-tab="map"]')?.addEventListener('click', () => {
  if (ready) setTimeout(() => minimap.open(), 0);
});
// 시야 넓히기: 보통 → 넓게 → 더 넓게 (이 브라우저에 기억)
const ZOOMS = [
  { v: 0, label: '보통' },
  { v: 0.55, label: '넓게' },
  { v: 1, label: '더 넓게' },
];
let zoomStep = 0;
try {
  zoomStep = Math.max(0, Math.min(2, Number(localStorage.getItem('ci_zoom') ?? 0) || 0));
} catch {
  /* 저장 막힘 */
}
const applyZoom = () => {
  scene.setWalkZoom(ZOOMS[zoomStep].v);
  $('btn-zoom').querySelector('span')!.textContent = ZOOMS[zoomStep].label;
};
applyZoom();
$('btn-zoom').addEventListener('click', () => {
  zoomStep = (zoomStep + 1) % ZOOMS.length;
  play('tap');
  applyZoom();
  try {
    localStorage.setItem('ci_zoom', String(zoomStep));
  } catch {
    /* 저장 막힘 */
  }
});
ctl.placement = createPlacement(scene, explore);
ctl.arcade = () => {
  startArcade(() => explore.refresh());
  explore.refresh();
};
ctl.fishing = () => fishHere(explore.fishSpot() ?? 'pond');
// 확인용 (콘솔에서 __catIsland.realtime.debug())
(window as unknown as { __catIsland: unknown }).__catIsland = { realtime, state, ctl, place: (x: number, z: number) => debugPlaceWalker(scene, x, z), moveTo: (x: number, z: number) => scene.setLocalPosition(x, z), local: () => scene.getLocalState(), npcs: () => townNpcs(state.unlockedZones), ponds: () => pondsOf(state.unlockedZones), mailbox: (no: number) => mailboxPos(no) };

$('btn-walk').addEventListener('click', () => explore.setWalking(true));
$('btn-walk-end').addEventListener('click', () => explore.setWalking(false));

// ── 데이터 불러오기 ──
async function boot() {
  const [meRes] = await Promise.allSettled([fetchMe(), refreshVillage()]);
  if (meRes.status === 'fulfilled' && meRes.value.house) {
    state.hideHandle = !!meRes.value.hideHandle;
    state.friendRequests = meRes.value.friendRequests ?? 0;
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
  if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 120_000) {
    lastRefresh = Date.now();
    refreshVillage();
  }
});
setInterval(() => {
  if (document.visibilityState === 'visible' && !explore.walking()) {
    lastRefresh = Date.now();
    refreshVillage();
  }
}, 300_000);
