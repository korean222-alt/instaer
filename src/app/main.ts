// 고양이섬 앱 입구: 씬 캔버스 + 상단 HUD + 하단 메뉴 + 화면 전환.
// 씬은 src/scene 의 공개 함수(createIslandScene)로만 쓴다. 씬 내부 파일은 import 하지 않는다.
import './style.css';
import { createIslandScene } from '../scene';
import { ZONE_CAPACITY } from '../shared/config';
import { fetchHealth } from './net/api';
import { currentScreen, go, onRoute, type ScreenId } from './router';
import { decorateScreen } from './screens/decorate';
import { moveInScreen } from './screens/moveIn';
import { rankScreen } from './screens/rank';
import type { AppContext, Screen } from './screens/types';
import { withEmptyLots } from './village';

const ICONS: Record<ScreenId, string> = {
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  'move-in': '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h11V10"/><path d="M10.5 19.5v-5h3v5"/>',
  rank: '<path d="M5 20v-6M12 20V6M19 20v-9"/><path d="M3 20h18"/>',
  decorate: '<path d="M12 21c-4.5 0-8-3.2-8-7.5C4 8 8 4 12 3c4 1 8 5 8 10.5 0 4.3-3.5 7.5-8 7.5z"/><path d="M12 21V11"/>',
};
const icon = (id: ScreenId) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[id]}</svg>`;

const SCREENS: Record<Exclude<ScreenId, 'map'>, Screen> = {
  'move-in': moveInScreen,
  rank: rankScreen,
  decorate: decorateScreen,
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
const ctx: AppContext = { scene };
const unlockedZones = 1;
scene.setUnlockedZones(unlockedZones);
scene.setHouses(withEmptyLots([], unlockedZones));
const hour = new Date().getHours();
scene.setTimeOfDay(hour >= 19 || hour < 6 ? 'night' : 'day');

// ── 화면 뼈대 ──
const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="hud">
    <div class="pill brand"><b>고양이섬</b><span id="hud-count">불러오는 중</span></div>
    <div class="pill soft" id="hud-next" hidden></div>
  </header>
  <div class="offline" id="offline" hidden>혼자 둘러보는 중</div>
  <section class="sheet" id="sheet" aria-hidden="true">
    <div class="sheet-head">
      <h2 id="sheet-title"></h2>
      <button class="close" id="sheet-close" aria-label="닫기">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
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

function show(id: ScreenId) {
  for (const a of app.querySelectorAll<HTMLAnchorElement>('[data-tab]')) {
    const on = a.dataset.tab === id;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  cleanup?.();
  cleanup = undefined;
  if (id === 'map') {
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    return;
  }
  const screen = SCREENS[id];
  $('sheet-title').textContent = screen.title;
  sheetBody.scrollTop = 0;
  cleanup = screen.render(sheetBody, ctx);
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}

$('sheet-close').addEventListener('click', () => go('map'));
onRoute(show);
show(currentScreen());

// ── 서버 확인 → HUD ──
fetchHealth().then((h) => {
  const count = $('hud-count');
  if (h.ok && typeof h.houses === 'number') {
    count.textContent = `입주 ${h.houses.toLocaleString()}마리`;
    const left = ZONE_CAPACITY - (h.houses % ZONE_CAPACITY);
    const next = $('hud-next');
    next.textContent = `다음 섬까지 ${left}마리`;
    next.hidden = false;
  } else {
    count.textContent = '구경 중';
    $('offline').hidden = false;
    console.warn('[고양이섬] 서버 연결 안 됨, 단독 모드:', h.db, h.message ?? '');
  }
});
