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
};
const TABS: Array<{ id: ScreenId; label: string }> = [
  { id: 'map', label: '지도' },
  { id: 'move-in', label: '입주' },
  { id: 'rank', label: '순위' },
  { id: 'decorate', label: '꾸미기' },
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
  <button class="near-btn" id="btn-near" hidden>${icon('eye')}<span>이 집 구경하기</span></button>
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

function show(route: Route) {
  const tabId = route.id === 'house' || route.id === 'search' || route.id === 'settings' ? 'map' : route.id;
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
}

$('sheet-close').addEventListener('click', () => go('map'));
$('btn-search').addEventListener('click', () => go('search'));
$('btn-settings').addEventListener('click', () => go('settings'));
onRoute(show);
scene.onHouseTap((no) => {
  play('meow');
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
  drawStatus();
}
$('hud-top').addEventListener('click', () => state.todayTop && openHouse(state.todayTop.houseNo));
$('hud-region').addEventListener('click', () => setHighlightedRegion(null));
onChange(drawHud);

// ── 상태 줄 (혼자 둘러보는 중 등) ──
let rtSolo = false;
let walking = false;
let nearHouse: number | null = null;
function drawStatus() {
  const el = $('status');
  const text = state.offline ? '서버에 연결할 수 없어 혼자 둘러보는 중' : walking && rtSolo ? '혼자 둘러보는 중' : '';
  el.textContent = text;
  el.hidden = !text;
}

// ── 걷기 (단계 B) ──
let lastAnim = 'idle';
const realtime = createRealtime(scene, {
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
// 확인용 (콘솔에서 __catIsland.realtime.debug())
(window as unknown as { __catIsland: unknown }).__catIsland = { realtime, state };

function setWalking(on: boolean) {
  if (walking === on) return;
  walking = on;
  play('tap');
  document.body.classList.toggle('walking', on);
  $('btn-walk').setAttribute('aria-pressed', String(on));
  $('btn-walk-end').hidden = !on;
  if (on) {
    go('map');
    scene.setWalkMode(true, state.me?.houseNo);
    if (state.me) {
      realtime.start();
      if (testRoom) toast(`미니게임 시험 방 '${testRoom}' 에 들어왔어요`);
    }
    else {
      rtSolo = true;
      toast('입주하면 다른 고양이들도 보여요');
    }
  } else {
    scene.setWalkMode(false);
    realtime.stop();
    rtSolo = false;
    nearHouse = null;
    $('btn-near').hidden = true;
  }
  drawStatus();
}
$('btn-walk').addEventListener('click', () => setWalking(true));
$('btn-walk-end').addEventListener('click', () => setWalking(false));
scene.onNearHouse((no) => {
  nearHouse = no;
  const btn = $('btn-near');
  const h = no !== null ? state.houses.get(no) : null;
  if (no !== null && btn.hidden && walking) play('ding');
  btn.hidden = no === null || !walking;
  if (no !== null) btn.querySelector('span')!.textContent = h?.igHandle ? `@${h.igHandle} 집 구경하기` : '이 집 구경하기';
});
$('btn-near').addEventListener('click', () => nearHouse !== null && go('house', nearHouse));

// ── 데이터 불러오기 ──
async function boot() {
  const [meRes] = await Promise.allSettled([fetchMe(), refreshVillage()]);
  if (meRes.status === 'fulfilled' && meRes.value.house) {
    state.hideHandle = !!meRes.value.hideHandle;
    setMe(meRes.value.house);
    pushHousesToScene();
  }
  ready = true;
  drawHud();
  const route = currentRoute();
  if (route.id === 'house' && route.param) scene.focusHouse(Number(route.param));
  else if (state.me && route.id === 'map') scene.focusHouse(state.me.houseNo);
  show(route);
  refreshRegions();
}
boot();

// 화면에 돌아오면 (1분 넘게 지났으면) 마을을 새로 불러온다
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 60_000) {
    lastRefresh = Date.now();
    refreshVillage();
  }
});
setInterval(() => {
  if (document.visibilityState === 'visible' && !walking) {
    lastRefresh = Date.now();
    refreshVillage();
  }
}, 120_000);
