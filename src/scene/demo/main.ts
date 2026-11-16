// 씬 데모: createIslandScene 을 가짜 데이터로 돌려 보는 화면.
// 버튼은 전부 확인용 임시 UI다. (정식 화면 UI는 앱 쪽 작업)
import { REGIONS } from '../../shared/config';
import type { House, RegionId } from '../../shared/types';
import { mockHouses, mockYardItems } from '../dev/mockHouses';
import {
  createIslandScene,
  debugPlaceWalker,
  debugProject,
  debugSetCamera,
  debugSetQuality,
  dockArea,
  encodeDrawing,
  fishingSpotAt,
  FREE_ITEM_LIST,
  getSceneStats,
  houseSlot,
  neighborhoodArea,
  POND_R,
  type Drawing,
  type FishingState,
  type LocalState,
  type PlacedItem,
  type SceneNpc,
} from '../index';
import { startFakePlayers, type FakePlayers } from './fakePlayers';

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
  focusedNo = houseNo;
  renderT4();
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
  if (fake) {
    setFake(false);
    setFake(true);
  }
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
  else insideNo = decorNo = null;
  renderT4();
}
$('btn-walk')?.addEventListener('click', () => setWalking(!walking));
island.onNearHouse((houseNo) => {
  visitNo = houseNo;
  renderT4();
  if (!visit) return;
  const h = houseNo === null ? undefined : byNo.get(houseNo);
  visit.hidden = !h;
  if (h) visit.textContent = h.igHandle ? `@${h.igHandle} 집 구경하기` : `${houseNo}번지 구경하기`;
});
visit?.addEventListener('click', () => {
  if (visitNo !== null) say(`${visitNo}번지를 구경해요 (앱에서 팝업을 띄울 자리)`);
});

// ── 다른 유저 20명 시험 (setRemotePlayers / onLocalMove / getLocalState 확인용) ──
let fake: FakePlayers | null = null;
const moves: LocalState[] = [];
let moveCount = 0;
island.onLocalMove((state) => {
  // 앱에서는 여기서 받은 값을 1초에 8번으로 줄여서 서버로 보낸다
  moveCount++;
  moves.push(state);
  if (moves.length > 40) moves.shift();
});
function setFake(on: boolean) {
  if (on === !!fake) return;
  if (on) {
    if (!walking) setWalking(true);
    fake = startFakePlayers(island, houses, Number(params.get('bots')) || 28, params.get('warp') === '1');
    say('다른 유저 20명이 주변을 돌아다녀요');
  } else {
    fake?.stop();
    fake = null;
    say('다른 유저를 껐어요');
  }
  $('btn-bots')!.textContent = on ? '다른 유저 끄기' : '다른 유저 20명 시험';
}
$('btn-bots')?.addEventListener('click', () => setFake(!fake));

// ── 작업 4: 집 안, 자유 배치, 직접 그린 그림 (확인용 임시 UI) ──
// 앱이 할 일을 흉내 낸다: 집마다 아이템 목록을 들고 있다가 onPlace 가 오면 같은 id 를 덮어쓴다.
const css = document.createElement('style');
css.textContent = `
  #t4 { position: fixed; left: 0; right: 0; top: calc(100px + env(safe-area-inset-top, 0px)); z-index: 6; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
  #t4 .row { display: flex; gap: 6px; overflow-x: auto; padding: 2px 16px; pointer-events: auto; scrollbar-width: none; }
  #t4 .row::-webkit-scrollbar { display: none; }
  #t4 .row:empty { display: none; }
  #t4 button { flex: none; appearance: none; border: 0; cursor: pointer; font: inherit; font-weight: 700; font-size: 12px; color: #5b4636; background: rgba(255,252,245,0.93); border-radius: 999px; padding: 8px 12px; box-shadow: 0 2px 8px rgba(70,50,30,0.16); white-space: nowrap; }
  #t4 button.on { background: #5b4636; color: #fff; }
  #t4 button.go { background: #ff8f7a; color: #fff; }
  #t4 button[hidden] { display: none; }
`;
document.head.append(css);
const t4 = document.createElement('div');
t4.id = 't4';
const rowA = document.createElement('div');
const rowB = document.createElement('div');
rowA.className = rowB.className = 'row';
t4.append(rowA, rowB);
document.body.append(t4);
const btn = (row: HTMLElement, label: string, fn: () => void, cls = '') => {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = cls;
  b.addEventListener('click', fn);
  row.append(b);
  return b;
};

// 가짜 그림 4장 (32x32, 16색): 하트, 고양이 얼굴, 체크, 무지개 줄
function mockDrawings(): Drawing[] {
  const make = (id: string, at: (x: number, y: number) => number): Drawing => {
    const px = new Uint8Array(1024);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px[y * 32 + x] = at(x, y);
    return { id, pixels: encodeDrawing(px), palette: [] };
  };
  return [
    make('heart', (x, y) => {
      const u = (x - 15.5) / 11;
      const v = (17 - y) / 11;
      const h = (u * u + v * v - 1) ** 3 - u * u * v * v * v;
      return h < 0 ? 2 : 0;
    }),
    make('cat', (x, y) => {
      const dx = x - 15.5;
      const dy = y - 18;
      const ear = y < 12 && y > 3 && Math.abs(Math.abs(dx) - 8) < (y - 3) * 0.55;
      if ((Math.abs(dx) === 4.5 || Math.abs(dx) === 5.5) && y >= 15 && y <= 17) return 1;
      if (Math.abs(dx) < 1.5 && y >= 20 && y <= 21) return 12;
      return dx * dx + dy * dy * 1.3 < 130 || ear ? 4 : 8;
    }),
    make('check', (x, y) => ((x >> 3) + (y >> 3)) % 2 ? 6 : 0),
    make('rainbow', (_x, y) => [2, 3, 4, 5, 8, 10, 11, 12][y >> 2]),
  ];
}
island.setDrawings(mockDrawings());

const rooms = new Map<number, PlacedItem[]>();
const yards = new Map<number, PlacedItem[]>();
const BACK = -4;
function roomOf(houseNo: number): PlacedItem[] {
  let list = rooms.get(houseNo);
  if (!list) {
    const art = ['heart', 'cat', 'check', 'rainbow'];
    list = [
      { id: 'bed', type: 'bed', x: -3.2, z: -2.7, rotY: 0 },
      { id: 'shelf', type: 'bookshelf', x: 1.4, z: -3.7, rotY: 0 },
      { id: 'sofa', type: 'sofa', x: -3.4, z: 1.0, rotY: Math.PI / 2 },
      { id: 'rug', type: 'rug', x: -0.4, z: 0.6, rotY: 0, drawingId: art[(houseNo + 2) % 4] },
      { id: 'table', type: 'table', x: -0.4, z: 0.6, rotY: 0 },
      { id: 'lamp', type: 'floor_lamp', x: 3.4, z: -3.4, rotY: 0 },
      { id: 'tower', type: 'cat_tower', x: 3.2, z: 0.4, rotY: -0.5 },
      { id: 'plant', type: 'plant', x: -1.6, z: -3.5, rotY: 0 },
      { id: 'frame1', type: 'frame', x: -0.3, z: BACK, rotY: 0, drawingId: art[houseNo % 4] },
      { id: 'frame2', type: 'frame', x: BACK, z: -0.6, rotY: Math.PI / 2, drawingId: art[(houseNo + 1) % 4] },
      { id: 'win', type: 'window', x: 2.9, z: BACK, rotY: 0 },
    ];
    rooms.set(houseNo, list);
  }
  return list;
}
const STYLES: Array<[string, string]> = [['cream', 'wood'], ['stripe', 'tile'], ['dots', 'carpet'], ['#cfe6e0', '#e8d2b0'], ['drawing:check', 'wood']];
let insideNo: number | null = null;
let doorNo: number | null = null;
let decorNo: number | null = null; // 꾸미는 집 (마당이든 집 안이든)
let picked: string | null = null;
let styleNo = 0;
const upsert = (list: PlacedItem[], item: PlacedItem) => {
  const i = list.findIndex((it) => it.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
};
const currentList = () => (decorNo === null ? null : insideNo !== null ? roomOf(insideNo) : (yards.get(decorNo) ?? yards.set(decorNo, []).get(decorNo)!));

function enter(houseNo: number) {
  if (!walking) setWalking(true, houseNo);
  setDecor(null);
  insideNo = houseNo;
  styleNo = houseNo % 3;
  island.enterHouse(houseNo, roomOf(houseNo), ...STYLES[styleNo]);
  document.body.classList.add('walking');
  say(`${houseNo}번지 집 안 · 앞쪽 발판으로 걸어 나가면 밖으로 나가요`);
  renderT4();
}
function setDecor(houseNo: number | null, typeOrId: string | null = null) {
  decorNo = houseNo;
  picked = null;
  if (houseNo === null) island.stopPlacing();
  else island.startPlacing(typeOrId, houseNo);
  renderT4();
}
island.onDoor((houseNo) => {
  doorNo = houseNo;
  renderT4();
});
island.onExitHouse((houseNo) => {
  insideNo = null;
  decorNo = null;
  say(`${houseNo}번지에서 나왔어요`);
  renderT4();
});
const placedLog: PlacedItem[] = [];
island.onPlace((item) => {
  placedLog.push(item);
  const list = currentList();
  if (list) upsert(list, item);
  picked = item.id;
  renderT4();
});
island.onPick((itemId) => {
  picked = itemId;
  const it = (insideNo !== null ? roomOf(insideNo) : currentList())?.find((i) => i.id === itemId);
  say(it ? `${FREE_ITEM_LIST.find((f) => f.type === it.type)?.label ?? it.type} 을(를) 골랐어요` : '아이템을 골랐어요');
  if (decorNo !== null) island.startPlacing(itemId, decorNo);
  renderT4();
});

function renderT4() {
  rowA.textContent = '';
  rowB.textContent = '';
  const decorating = decorNo !== null;
  if (insideNo !== null) {
    btn(rowA, '나가기', () => {
      island.exitHouse();
      insideNo = null;
      decorNo = null;
      renderT4();
    }, 'go');
    btn(rowA, '벽지/바닥 바꾸기', () => {
      styleNo = (styleNo + 1) % STYLES.length;
      island.enterHouse(insideNo!, roomOf(insideNo!), ...STYLES[styleNo]);
    });
  } else if (doorNo !== null) {
    btn(rowA, `${doorNo}번지 들어가기`, () => enter(doorNo!), 'go');
  }
  const target = insideNo ?? visitNo ?? (walking ? null : focusedNo);
  if (decorating) btn(rowA, '꾸미기 끝', () => setDecor(null), 'on');
  else if (target !== null) btn(rowA, insideNo !== null ? '집 안 꾸미기' : `${target}번지 마당 꾸미기`, () => setDecor(target));
  if (decorating && picked) {
    btn(rowA, '돌리기', () => island.rotatePlacing());
    btn(rowA, '치우기', () => {
      const list = currentList();
      if (!list || !picked) return;
      const i = list.findIndex((it) => it.id === picked);
      if (i >= 0) list.splice(i, 1);
      picked = null;
      if (insideNo !== null) island.setInteriorItems(list);
      else island.setYardItemsFree(decorNo!, list);
      renderT4();
    });
    btn(rowA, '그림 바꾸기', () => {
      const list = currentList();
      const it = list?.find((i) => i.id === picked);
      if (!list || !it) return;
      const ids = ['heart', 'cat', 'check', 'rainbow', undefined];
      it.drawingId = ids[(ids.indexOf(it.drawingId as string) + 1) % ids.length] as string | undefined;
      if (insideNo !== null) island.setInteriorItems(list);
      else island.setYardItemsFree(decorNo!, list);
    });
  }
  if (decorating) {
    for (const f of FREE_ITEM_LIST) {
      if (f.mount === 'wall' && insideNo === null) continue;
      btn(rowB, `+ ${f.label}`, () => island.startPlacing(f.type, decorNo!));
    }
  }
}
let focusedNo: number | null = 1;

// ── 작업 5: 지붕 그림, 주민, 낚시, 위치 되돌리기, 고양이 그림 (확인용 임시 UI) ──
const rowC = document.createElement('div');
rowC.className = 'row';
t4.append(rowC);
// 지붕 그림: 사는 사람이 있는 집 셋 중 둘에 가짜 그림을 붙인다
let roofOn = false;
function setRoof(on: boolean) {
  roofOn = on;
  const art = ['heart', 'cat', 'check', 'rainbow'];
  island.setRoofArt(on ? houses.filter((h) => !h.isNpc && h.houseNo % 3 !== 0).map((h) => ({ houseNo: h.houseNo, drawingId: art[h.houseNo % 4] })) : []);
  say(on ? '지붕에 그림을 붙였어요' : '지붕 그림을 뗐어요');
}
// 주민: 앱(src/app/play/npcs.ts)과 같은 자리 (광장: 잡화점/오락실, 연못: 낚시꾼, 큰 나무: 정원사)
function townNpcs(): SceneNpc[] {
  const list: SceneNpc[] = [];
  let plazas = 0;
  for (let n = 0; n < Math.ceil(count / 100) * 10; n++) {
    const a = neighborhoodArea(n);
    if (a.feature === 'pond') list.push({ id: `npc-fisher-${n}`, role: 'fisher', name: '낚시꾼 고등어', x: a.x + 1.3, z: a.z + POND_R + 0.8, rotY: Math.PI, cat: { fur: '#a9adb8', pattern: 'gray', eyeColor: '#f0b44a' } });
    else if (a.feature === 'tree') list.push({ id: `npc-gardener-${n}`, role: 'gardener', name: '정원사 삼색이', x: a.x - 2.4, z: a.z + 2.6, rotY: -0.6, cat: { fur: '#f0a04b', pattern: 'calico', eyeColor: '#6fb7e8' } });
    else if (plazas++ % 2 === 0) list.push({ id: `npc-shop-${n}`, role: 'shop', name: '잡화점 보리', x: a.x + 2.4, z: a.z + 2.1, rotY: 0.5, cat: { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' } });
    else list.push({ id: `npc-arcade-${n}`, role: 'arcade', name: '오락실 턱시도', x: a.x + 2.4, z: a.z + 2.1, rotY: 0.5, cat: { fur: '#35323a', pattern: 'tuxedo', eyeColor: '#f2c94c' } });
  }
  return list;
}
let npcOn = false;
function setNpc(on: boolean) {
  npcOn = on;
  if (!on) island.setNpcs([]);
  else if (insideNo !== null) island.setNpcs([{ id: `npc-resident-${insideNo}`, role: 'resident', name: '주민 나비', x: 1.5, z: -1.2, rotY: -0.4, cat: { fur: '#fffaf2', pattern: 'white', eyeColor: '#6fb7e8' } }]);
  else island.setNpcs(townNpcs());
}
island.onNpcTap((id) => say(`주민을 눌렀어요: ${id}`));
// 낚시: 낚시터로 옮긴 뒤 상태를 차례로 넘긴다
const FISH_STEPS: Array<FishingState | null> = ['cast', 'wait', 'bite', 'reel', 'caught', null];
let fishStep = -1;
function goFish(where: 'pond' | 'pier') {
  if (!walking) setWalking(true, 1);
  if (where === 'pier') {
    const d = dockArea();
    island.setLocalPosition(d.x, d.z1 - 0.8, 0);
  } else {
    for (let n = 0; n < 10; n++) {
      const a = neighborhoodArea(n);
      if (a.feature !== 'pond') continue;
      island.setLocalPosition(a.x - 1.2, a.z + POND_R + 1.0, Math.PI);
      break;
    }
  }
  fishStep = -1;
  island.setFishing(null);
}
function nextFish() {
  const me = island.getLocalState();
  fishStep = (fishStep + 1) % FISH_STEPS.length;
  island.setFishing(FISH_STEPS[fishStep]);
  say(`낚시: ${FISH_STEPS[fishStep] ?? '끝'} · 낚시터 ${fishingSpotAt(me.x, me.z)?.kind ?? '아님'}`);
}
// 고양이 그림: 가짜 입양 카드 자리에 3D 고양이를 찍어 넣는다
const previewBox = document.createElement('div');
previewBox.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9;background:#fff8ec;border-radius:24px;padding:14px;box-shadow:0 8px 30px rgba(70,50,30,.3);display:none;gap:8px;flex-wrap:wrap;width:300px;justify-content:center';
document.body.append(previewBox);
function showPreview(on: boolean) {
  previewBox.style.display = on ? 'flex' : 'none';
  previewBox.textContent = '';
  if (!on) return;
  const cats = houses.filter((h) => h.cat).slice(0, 6);
  cats.forEach((h, i) => {
    const img = new Image();
    img.width = img.height = 128;
    img.src = island.renderCatPreview(h.cat!, 128, { houseNo: h.houseNo, pose: i % 3 === 2 ? 'sit' : 'stand' });
    previewBox.append(img);
  });
}
previewBox.addEventListener('click', () => showPreview(false));
btn(rowC, '지붕 그림', () => setRoof(!roofOn));
btn(rowC, '주민', () => setNpc(!npcOn));
btn(rowC, '연못으로', () => goFish('pond'));
btn(rowC, '부두로', () => goFish('pier'));
btn(rowC, '낚시 다음 단계', () => nextFish());
btn(rowC, '되돌리기(1번지)', () => {
  const s = houseSlot(1);
  island.setLocalPosition(s.x, s.z + 4.4);
});
btn(rowC, '고양이 그림', () => showPreview(previewBox.style.display === 'none'));

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
      const users = fake ? ` · 유저 ${s.remotes.shown}` : '';
      fpsEl.textContent = `${Math.round(fps)} fps · 그리기 ${s.calls} · 삼각형 ${(s.triangles / 1000).toFixed(0)}k · 품질 ${s.quality}${users}`;
    }
    frames = 0;
    lastT = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// 주소에 값을 붙여서 처음 화면을 정할 수 있다 (확인용)
//   ?n=3000  ?time=night  ?region=seoul  ?house=12  ?dist=200
// 2026-11-16: 겨울 (?winter=0 이면 끔), 넓힌 마당 (?bigyard=1,2,3)
island.setWinter(params.get('winter') !== '0');
if (params.get('bigyard')) island.setBigYards(params.get('bigyard')!.split(',').map(Number));
if (params.get('time') === 'night') $('btn-time')?.click();
if (params.get('region')) setRegion(params.get('region') as RegionId);
if (params.get('house')) island.focusHouse(Number(params.get('house')));
if (params.get('dist') || params.get('at')) {
  const s = houseSlot(Number(params.get('at') ?? 1));
  debugSetCamera(island, params.get('at') ? s.x : 0, params.get('at') ? s.z + 0.6 : 0, Number(params.get('dist') ?? 60));
}
//   ?walk=12 (12번지 고양이로 걷기 시작)  ?q=0 (자동 품질 끄고 단계 고정)
if (params.get('cam')) {
  const [cx, cz] = params.get('cam')!.split(',').map(Number);
  debugSetCamera(island, cx, cz, Number(params.get('dist') ?? 30));
}
if (params.get('q')) debugSetQuality(island, Number(params.get('q')));
if (params.get('walk')) setWalking(true, Number(params.get('walk')));
//   ?bots=28 (가짜 유저 수를 정해서 바로 시작)  ?warp=1 (가끔 순간이동하는 유저 넣기)
if (params.get('bots')) setFake(true);
//   ?inside=12 (12번지 집 안으로)  ?decor=1 (꾸미기 모드까지 켜기)  ?yard=12 (12번지 마당 꾸미기)
if (params.get('inside')) {
  enter(Number(params.get('inside')));
  if (params.get('decor')) setDecor(insideNo);
} else if (params.get('yard')) {
  focusedNo = Number(params.get('yard'));
  setDecor(focusedNo);
}
//   ?roof=1 (지붕 그림)  ?npc=1 (주민)  ?fish=pond|pier (낚시터로)  ?fishstep=3 (낚시 단계)  ?preview=1 (고양이 그림)
if (params.get('roof')) setRoof(true);
if (params.get('fish')) {
  goFish(params.get('fish') === 'pier' ? 'pier' : 'pond');
  for (let i = 0; i < Number(params.get('fishstep') ?? 0); i++) nextFish();
}
if (params.get('npc')) setNpc(true);
if (params.get('preview')) showPreview(true);
renderT4();
(window as unknown as Record<string, unknown>).__island = {
  island,
  stats: () => getSceneStats(island),
  fpsLog,
  debugSetCamera,
  placeWalker: (x: number, z: number, yaw?: number) => debugPlaceWalker(island, x, z, yaw),
  setQuality: (level: number | 'auto') => debugSetQuality(island, level),
  houseSlot,
  setFake,
  moves,
  moveCount: () => moveCount,
  enter,
  setDecor,
  project: (x: number, y: number, z: number) => debugProject(island, x, y, z),
  placed: () => placedLog,
  rooms,
  yards,
  setRoof,
  setNpc,
  goFish,
  nextFish,
  showPreview,
  fishingSpotAt,
};
