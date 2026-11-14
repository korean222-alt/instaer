// 씬 데모: createIslandScene 을 가짜 데이터로 돌려 보는 화면.
// 버튼은 전부 확인용 임시 UI다. (정식 화면 UI는 앱 쪽 작업)
import { REGIONS } from '../../shared/config';
import type { House, RegionId } from '../../shared/types';
import { mockHouses, mockYardItems } from '../dev/mockHouses';
import { createIslandScene, debugPlaceWalker, debugSetCamera, debugSetQuality, getSceneStats, houseSlot } from '../index';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const island = createIslandScene(canvas);
const $ = (id: string) => document.getElementById(id);

let houses: House[] = [];
let byNo = new Map<number, House>();
let night = false;
let region: RegionId | null = null;

function load(count: number) {
  houses = mockHouses(count);
  byNo = new Map(houses.map((h) => [h.houseNo, h]));
  island.setHouses(houses);
  island.setUnlockedZones(Math.ceil(count / 100));
  for (const h of houses) if (!h.isNpc) island.setYardItems(h.houseNo, mockYardItems(h.houseNo));
  // 오늘의 특이한 집: 예뻐요가 제일 많은 집
  const top = houses.reduce((a, b) => (b.likes > a.likes ? b : a));
  island.highlightHouse(top.houseNo);
  const b = $('btn-count');
  if (b) b.textContent = `집 ${count.toLocaleString()}채`;
  return top;
}

const COUNTS = [100, 1000, 3000];
let count = Number(params.get('n') ?? 100);
if (!COUNTS.includes(count)) COUNTS.push(count);
let top = load(count);

// ── 알림 한 줄 ──
const toast = $('toast');
let toastTimer = 0;
function say(text: string) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2000);
}
const regionLabel = (id: RegionId) => REGIONS.find((r) => r.id === id)?.label ?? '';

island.onHouseTap((houseNo) => {
  const h = byNo.get(houseNo);
  if (!h) return;
  island.focusHouse(houseNo);
  say(h.igHandle ? `${houseNo}번지 · @${h.igHandle} · ${regionLabel(h.region)} · ♥ ${h.likes}` : `${houseNo}번지 · 빈 집`);
});

// ── 버튼 ──
$('btn-time')?.addEventListener('click', () => {
  night = !night;
  island.setTimeOfDay(night ? 'night' : 'day');
  $('btn-time')!.textContent = night ? '낮으로' : '밤으로';
});
$('btn-count')?.addEventListener('click', () => {
  count = COUNTS[(COUNTS.indexOf(count) + 1) % COUNTS.length];
  top = load(count);
  say(`집 ${count.toLocaleString()}채로 바꿨어요`);
});
$('btn-find')?.addEventListener('click', () => {
  const lived = houses.filter((h) => !h.isNpc);
  const h = lived[Math.floor(Math.random() * lived.length)];
  island.focusHouse(h.houseNo);
  say(`${h.houseNo}번지 · @${h.igHandle}`);
});
$('btn-top')?.addEventListener('click', () => {
  island.focusHouse(top.houseNo);
  say(`오늘의 특이한 집 · ${top.houseNo}번지 · ♥ ${top.likes}`);
});

// ── 걷기 (setWalkMode / onNearHouse 확인용) ──
let walking = false;
let visitNo: number | null = null;
const visit = $('visit') as HTMLButtonElement | null;
function setWalking(on: boolean, houseNo?: number) {
  walking = on;
  // 내 집은 임의의 집 번호를 쓴다 (사는 사람이 있는 집 중 하나)
  const lived = houses.filter((h) => !h.isNpc);
  const mine = houseNo ?? lived[Math.floor(Math.random() * Math.min(lived.length, 30))]?.houseNo;
  island.setWalkMode(on, mine);
  document.body.classList.toggle('walking', on);
  $('btn-walk')!.textContent = on ? '걷기 끝' : '걷기';
  if (on) say(`${mine}번지 고양이로 걸어요 · 왼쪽 아래를 밀어서 이동`);
}
$('btn-walk')?.addEventListener('click', () => setWalking(!walking));
island.onNearHouse((houseNo) => {
  visitNo = houseNo;
  if (!visit) return;
  const h = houseNo === null ? undefined : byNo.get(houseNo);
  visit.hidden = !h;
  if (h) visit.textContent = h.igHandle ? `@${h.igHandle} 집 구경하기` : `${houseNo}번지 구경하기`;
});
visit?.addEventListener('click', () => {
  if (visitNo !== null) say(`${visitNo}번지를 구경해요 (앱에서 팝업을 띄울 자리)`);
});

// ── 지역 버튼 (highlightRegion 확인용) ──
const chips = $('regions');
function setRegion(id: RegionId | null) {
  region = id;
  island.highlightRegion(id);
  chips?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === (id ?? '')));
  if (id) {
    const n = houses.filter((h) => !h.isNpc && h.region === id).length;
    say(`${regionLabel(id)} · ${n.toLocaleString()}채`);
  }
}
if (chips) {
  const mk = (id: string, label: string, color: string | null) => {
    const b = document.createElement('button');
    b.dataset.id = id;
    if (color) {
      const dot = document.createElement('i');
      dot.style.background = color;
      b.append(dot);
    }
    b.append(label);
    b.addEventListener('click', () => setRegion(id === '' || region === id ? null : (id as RegionId)));
    chips.append(b);
  };
  mk('', '전체', null);
  for (const r of REGIONS) mk(r.id, r.label, r.color);
  setRegion(null);
}

// ── 수치 표시 ──
const fpsEl = $('fps');
let frames = 0;
let lastT = performance.now();
const fpsLog: number[] = [];
function tick(now: number) {
  frames++;
  if (now - lastT > 500) {
    const fps = (frames * 1000) / (now - lastT);
    fpsLog.push(fps);
    const s = getSceneStats(island);
    if (fpsEl && s) {
      fpsEl.textContent = `${Math.round(fps)} fps · 그리기 ${s.calls} · 삼각형 ${(s.triangles / 1000).toFixed(0)}k · 품질 ${s.quality}`;
    }
    frames = 0;
    lastT = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// 주소에 값을 붙여서 처음 화면을 정할 수 있다 (확인용)
//   ?n=3000  ?time=night  ?region=seoul  ?house=12  ?dist=200
if (params.get('time') === 'night') $('btn-time')?.click();
if (params.get('region')) setRegion(params.get('region') as RegionId);
if (params.get('house')) island.focusHouse(Number(params.get('house')));
if (params.get('dist') || params.get('at')) {
  const s = houseSlot(Number(params.get('at') ?? 1));
  debugSetCamera(island, params.get('at') ? s.x : 0, params.get('at') ? s.z + 0.6 : 0, Number(params.get('dist') ?? 60));
}
//   ?walk=12 (12번지 고양이로 걷기 시작)  ?q=0 (자동 품질 끄고 단계 고정)
if (params.get('q')) debugSetQuality(island, Number(params.get('q')));
if (params.get('walk')) setWalking(true, Number(params.get('walk')));
(window as unknown as Record<string, unknown>).__island = {
  island,
  stats: () => getSceneStats(island),
  fpsLog,
  debugSetCamera,
  placeWalker: (x: number, z: number, yaw?: number) => debugPlaceWalker(island, x, z, yaw),
  setQuality: (level: number | 'auto') => debugSetQuality(island, level),
  houseSlot,
};
