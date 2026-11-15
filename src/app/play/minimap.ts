// 섬 지도 (2026-11-15 개편)
// - 걷는 동안 왼쪽 위 작은 지도 (누르면 큰 지도). 큰 지도는 "지도" 탭으로 걷지 않을 때도 연다.
// - 큰 지도: 두 손가락으로 확대/축소, 끌어서 이동, +/- 버튼. 표시를 누르면 이름과 설명, "길 안내", "집 보기".
// - 우리 집은 따로 표시한다. 길 안내를 고르면 걷는 길(route.ts)을 지도와 작은 지도에 그리고, 위에 남은 거리를 띄운다.
// 씬의 공개 값(landAt, npcHomes, caveMouths, mapHills, dockArea, houseSlot, townSquares)만 쓴다.
import { caveMouths, dockArea, houseSlot, landAt, mapHills, townSquares, type IslandScene } from '../../scene';
import { ZONE_CAPACITY } from '../../shared/config';
import { NPC_INFO } from '../../shared/economy';
import type { RemotePlayer } from '../../shared/types';
import { play } from '../audio/sound';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { townNpcs, type NpcKind } from './npcs';
import { findRoute, routeLength, type Pt } from './route';

const ROLE_MARK: Record<NpcKind, { c: string; t: string; desc: string }> = {
  shop: { c: '#ff8f7a', t: '상', desc: '물건 사기, 물고기·광석 팔기 (마을 광장 장터)' },
  arcade: { c: '#9f8cf0', t: '오', desc: '생선 받기 미니게임 (마을 광장 장터)' },
  fisher: { c: '#3fb6b0', t: '낚', desc: '낚시 부탁을 줘요' },
  gardener: { c: '#6fc275', t: '정', desc: '꾸미기, 그림 부탁을 줘요' },
  explorer: { c: '#b8875c', t: '탐', desc: '동굴 탐험 부탁을 줘요' },
  resident: { c: '#9ab3d6', t: '이', desc: '놀러 가면 방문 보상' },
  mayor: { c: '#3d5a80', t: '장', desc: '업데이트 소식을 알려 줘요' },
};

interface LandImage {
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  scale: number;
  zones: number;
}

/** 섬 땅 모양 그림 (열린 구역이 바뀔 때만 다시 만든다) */
function buildLand(zones: number): LandImage {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let z = 0; z < zones; z++) {
    for (const no of [1, 25, 50, 75, 100]) {
      const s = houseSlot(z * ZONE_CAPACITY + no);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
  }
  minX -= 45;
  maxX += 45;
  minZ -= 45;
  maxZ += 45;
  const scale = 1;
  const w = Math.ceil((maxX - minX) / scale);
  const h = Math.ceil((maxZ - minZ) / scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = landAt(minX + x * scale, minZ + y * scale);
      const i = (y * w + x) * 4;
      if (d > 1.2) {
        img.data[i] = 150;
        img.data[i + 1] = 206;
        img.data[i + 2] = 120;
      } else if (d > 0) {
        img.data[i] = 243;
        img.data[i + 1] = 226;
        img.data[i + 2] = 178;
      } else {
        img.data[i] = 120;
        img.data[i + 1] = 196;
        img.data[i + 2] = 226;
      }
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, minX, minZ, scale, zones };
}

/** 지도 위 표시 하나 */
interface Mark {
  kind: 'npc' | 'house' | 'myhouse' | 'square' | 'pond' | 'dock' | 'cave' | 'player';
  x: number;
  z: number;
  title: string;
  sub: string;
  houseNo?: number;
  /** 누를 수 있는 반지름 (px) */
  hit: number;
}

export interface MapHooks {
  walking(): boolean;
  /** 걷기를 켠다 (길 안내를 고르면) */
  startWalking(): void;
  /** 집(프로필) 보기 */
  openHouse(houseNo: number): void;
}

export interface Minimap {
  setVisible(on: boolean): void;
  /** 큰 지도 열기 */
  open(): void;
  close(): void;
}

export function createMinimap(scene: IslandScene, players: () => RemotePlayer[], hooks: MapHooks): Minimap {
  const app = document.getElementById('app')!;
  const box = document.createElement('button');
  box.className = 'minimap';
  box.hidden = true;
  box.setAttribute('aria-label', '섬 지도 크게 보기');
  const small = document.createElement('canvas');
  box.appendChild(small);
  app.appendChild(box);

  const routePill = document.createElement('div');
  routePill.className = 'route-pill';
  routePill.hidden = true;
  app.appendChild(routePill);

  const big = document.createElement('div');
  big.className = 'bigmap';
  big.hidden = true;
  big.innerHTML = `<div class="bigmap-card">
      <div class="bigmap-head"><b>섬 지도</b><span class="map-hint">두 손가락으로 확대, 표시를 눌러 보세요</span><button class="pill btn-pill" data-close>닫기</button></div>
      <div class="map-wrap"><canvas></canvas>
        <div class="map-zoom"><button data-zoom="in" aria-label="확대">+</button><button data-zoom="out" aria-label="축소">−</button><button data-zoom="home" aria-label="우리 집 / 내 위치">◎</button></div>
      </div>
      <div class="map-info" hidden></div>
      <div class="legend">${(['mayor', 'shop', 'arcade', 'fisher', 'gardener', 'explorer', 'resident'] as NpcKind[])
        .map((r) => `<span><i style="background:${ROLE_MARK[r].c}">${ROLE_MARK[r].t}</i>${r === 'resident' ? '이웃' : r === 'mayor' ? '이장' : NPC_INFO[r].title}</span>`)
        .join('')}<span><i style="background:#e2574c">광</i>마을 광장</span><span><i style="background:#4a90c8">물</i>낚시터</span><span><i style="background:#3b2f2a">굴</i>동굴</span><span><i class="home">집</i>우리 집</span><span><i class="me"></i>나</span></div></div>`;
  app.appendChild(big);
  const bigCanvas = big.querySelector('canvas')!;
  const info = big.querySelector<HTMLElement>('.map-info')!;

  let land: LandImage | null = null;
  let visible = false;
  let timer = 0;
  let bigTimer = 0;
  /** 큰 지도 보는 곳 (세계 좌표 가운데, 짧은 변 절반에 들어가는 세계 길이) */
  const view = { cx: 0, cz: 0, radius: 120 };
  let marks: Mark[] = [];
  let selected: Mark | null = null;

  // ── 길 안내 ──
  let dest: { x: number; z: number; title: string } | null = null;
  let route: Pt[] | null = null;
  let routeAt = 0;

  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const fullRadius = () => (state.unlockedZones <= 1 ? 118 : 118 + Math.sqrt(state.unlockedZones) * 110);
  /** 지도의 기준점: 걷는 중이면 내 고양이, 아니면 우리 집, 없으면 마을 광장 */
  const anchor = (): Pt => {
    if (hooks.walking()) {
      const s = scene.getLocalState();
      return { x: s.x, z: s.z };
    }
    if (state.me) {
      const s = houseSlot(state.me.houseNo);
      return { x: s.x, z: s.z };
    }
    const sq = townSquares(1)[0];
    return { x: sq.x, z: sq.z };
  };

  function collectMarks(): Mark[] {
    const out: Mark[] = [];
    const zones = state.unlockedZones;
    for (const sq of townSquares(zones)) out.push({ kind: 'square', x: sq.x, z: sq.z, title: '마을 광장', sub: '마을 게시판, 이장님, 장터(잡화점·오락실), 벤치', hit: 16 });
    for (const n of townNpcs(zones)) {
      const mk = ROLE_MARK[n.role];
      out.push({ kind: 'npc', x: n.x, z: n.z, title: n.name, sub: mk.desc, hit: 14 });
    }
    const { ponds } = mapHills(zones);
    for (const p of ponds) out.push({ kind: 'pond', x: p.x, z: p.z, title: '연못 낚시터', sub: '연못 둘레에서 "낚시하기"', hit: 12 });
    const dock = dockArea();
    out.push({ kind: 'dock', x: dock.x, z: dock.z1, title: '부두 바다 낚시터', sub: '부두 끝에서 바다 낚시 (고등어, 참돔, 참다랑어)', hit: 12 });
    for (const m of caveMouths(zones)) out.push({ kind: 'cave', x: m.x, z: m.z, title: '동굴', sub: '광석 캐기 (안으로 들어갈수록 귀한 광석)', hit: 12 });
    for (const [no, h] of state.houses) {
      const s = houseSlot(no);
      const mine = state.me?.houseNo === no;
      out.push({ kind: mine ? 'myhouse' : 'house', x: s.x, z: s.z, title: mine ? `우리 집 · ${no}번지` : `${h.igHandle ?? ''}의 집`, sub: `${no}번지 · 예뻐요 ${h.likes}`, houseNo: no, hit: mine ? 16 : 7 });
    }
    for (const p of players())
      out.push({ kind: 'player', x: p.x, z: p.z, title: p.handle || '고양이', sub: p.houseNo ? `${p.houseNo}번지에 사는 고양이` : '지나가는 고양이', houseNo: p.houseNo ?? undefined, hit: 10 });
    return out;
  }

  /** cx, cz 가운데, 짧은 변 절반 = radius(세계 단위) 로 w x h 픽셀에 그린다 */
  function render(canvas: HTMLCanvasElement, w: number, h: number, cx: number, cz: number, radius: number, detail: boolean) {
    const k = dpr();
    if (canvas.width !== Math.round(w * k) || canvas.height !== Math.round(h * k)) {
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#78c4e2';
    g.fillRect(0, 0, w, h);
    if (!land || land.zones !== state.unlockedZones) land = buildLand(state.unlockedZones);
    const px = Math.min(w, h) / (radius * 2);
    const toX = (x: number) => (x - cx) * px + w / 2;
    const toY = (z: number) => (z - cz) * px + h / 2;
    g.imageSmoothingEnabled = true;
    g.drawImage(land.canvas, toX(land.minX), toY(land.minZ), land.canvas.width * land.scale * px, land.canvas.height * land.scale * px);

    const zones = state.unlockedZones;
    const { hills, ponds } = mapHills(zones);
    g.fillStyle = '#b8ab9c';
    for (const hl of hills) {
      g.beginPath();
      g.arc(toX(hl.x), toY(hl.z), Math.max(1.5, hl.r * px), 0, Math.PI * 2);
      g.fill();
    }
    const caves = caveMouths(zones);
    for (const m of caves) {
      g.fillStyle = '#9d8f82';
      g.beginPath();
      g.arc(toX(m.hillX), toY(m.hillZ), Math.max(3, m.r * px), 0, Math.PI * 2);
      g.fill();
    }
    // 마을 광장 바닥
    const squares = townSquares(zones);
    g.fillStyle = '#efe0c4';
    for (const sq of squares) {
      g.beginPath();
      g.arc(toX(sq.x), toY(sq.z), Math.max(3, sq.r * px), 0, Math.PI * 2);
      g.fill();
    }
    // 집 (입주한 집은 지붕 색, 빈 집은 흐리게)
    const maxNo = zones * ZONE_CAPACITY;
    const dot = Math.max(1.5, 2.6 * px);
    for (let no = 1; no <= maxNo; no++) {
      const s = houseSlot(no);
      const x = toX(s.x);
      const y = toY(s.z);
      if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue;
      const hs = state.houses.get(no);
      g.fillStyle = hs ? hs.roofColor : 'rgba(255,255,255,0.55)';
      g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    const icon = (x: number, y: number, color: string, text: string, r: number) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `700 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, x, y + 0.5);
    };
    const label = (x: number, y: number, text: string) => {
      g.font = '700 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,250,242,0.9)';
      g.strokeText(text, x, y);
      g.fillStyle = '#5b4636';
      g.fillText(text, x, y);
    };
    const r = detail ? 9 : 7;
    const showLabels = detail && radius < 75;
    for (const p of ponds) icon(toX(p.x), toY(p.z), '#4a90c8', '물', r);
    const dock = dockArea();
    icon(toX(dock.x), toY(dock.z1), '#4a90c8', '물', r);
    for (const m of caves) icon(toX(m.x), toY(m.z), '#3b2f2a', '굴', r);
    for (const sq of squares) {
      icon(toX(sq.board.x), toY(sq.board.z), '#e2574c', '광', r + 1);
      if (detail) label(toX(sq.board.x), toY(sq.board.z) - r - 8, '마을 광장');
    }
    for (const n of townNpcs(zones)) {
      const mk = ROLE_MARK[n.role];
      icon(toX(n.x), toY(n.z), mk.c, mk.t, r);
      if (showLabels && n.role !== 'resident') label(toX(n.x), toY(n.z) + r + 8, n.role === 'mayor' ? '이장' : NPC_INFO[n.role].name);
    }
    // 집 이름 (많이 확대했을 때만)
    if (detail && radius < 38) {
      for (const [no, hs] of state.houses) {
        const s = houseSlot(no);
        const x = toX(s.x);
        const y = toY(s.z);
        if (x < 0 || y < 0 || x > w || y > h || no === state.me?.houseNo) continue;
        label(x, y - dot - 6, hs.igHandle ?? '');
      }
    }
    // 우리 집
    if (state.me) {
      const s = houseSlot(state.me.houseNo);
      const x = toX(s.x);
      const y = toY(s.z);
      g.fillStyle = '#ff7a59';
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      const hr = detail ? 10 : 7;
      g.beginPath();
      g.moveTo(x, y - hr * 1.25);
      g.lineTo(x + hr, y - hr * 0.2);
      g.lineTo(x + hr * 0.75, y + hr * 0.85);
      g.lineTo(x - hr * 0.75, y + hr * 0.85);
      g.lineTo(x - hr, y - hr * 0.2);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `800 ${Math.round(hr * 0.95)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('집', x, y + hr * 0.15);
      if (detail) label(x, y + hr + 9, '우리 집');
    }
    // 길 안내
    if (route && route.length > 1) {
      g.strokeStyle = '#ff7a59';
      g.lineWidth = detail ? 4 : 3;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.setLineDash([1, detail ? 8 : 6]);
      g.beginPath();
      g.moveTo(toX(route[0].x), toY(route[0].z));
      for (const p of route.slice(1)) g.lineTo(toX(p.x), toY(p.z));
      g.stroke();
      g.setLineDash([]);
    }
    if (dest) {
      const x = toX(dest.x);
      const y = toY(dest.z);
      g.strokeStyle = '#5b4636';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - 16);
      g.stroke();
      g.fillStyle = '#ff7a59';
      g.beginPath();
      g.moveTo(x, y - 16);
      g.lineTo(x + 11, y - 12);
      g.lineTo(x, y - 8);
      g.closePath();
      g.fill();
    }
    // 다른 고양이
    for (const p of players()) {
      g.fillStyle = '#fffaf2';
      g.strokeStyle = '#5b4636';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(toX(p.x), toY(p.z), detail ? 3.4 : 2.6, 0, Math.PI * 2);
      g.fill();
      if (detail) g.stroke();
    }
    // 고른 표시
    if (selected && detail) {
      g.strokeStyle = '#ff7a59';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(toX(selected.x), toY(selected.z), selected.hit + 3, 0, Math.PI * 2);
      g.stroke();
    }
    // 나: 바라보는 쪽 화살표 (걷는 중만)
    if (hooks.walking()) {
      const me = scene.getLocalState();
      const mx = toX(me.x);
      const my = toY(me.z);
      const dx = Math.sin(me.rotY);
      const dz = Math.cos(me.rotY);
      g.fillStyle = '#ff7a59';
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(mx + dx * 8, my + dz * 8);
      g.lineTo(mx - dz * 5 - dx * 4, my + dx * 5 - dz * 4);
      g.lineTo(mx + dz * 5 - dx * 4, my - dx * 5 - dz * 4);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  // ── 큰 지도 크기, 그리기 ──
  const bigSize = () => {
    const w = Math.min(window.innerWidth - 32, 560);
    const h = Math.round(Math.min(window.innerHeight * 0.56, w * 1.15));
    return { w, h };
  };
  function drawBig() {
    if (big.hidden) return;
    const { w, h } = bigSize();
    view.radius = Math.max(16, Math.min(fullRadius(), view.radius));
    render(bigCanvas, w, h, view.cx, view.cz, view.radius, true);
  }

  function tick() {
    if (visible) {
      const me = scene.getLocalState();
      render(small, 112, 112, me.x, me.z, 46, false);
    }
    updateRoute();
    if (!big.hidden) {
      marks = collectMarks();
      drawBig();
    }
  }

  // ── 길 안내 ──
  function updateRoute(force = false) {
    if (!dest) return;
    if (!hooks.walking()) {
      routePill.hidden = true;
      return;
    }
    const me = scene.getLocalState();
    const left = Math.hypot(dest.x - me.x, dest.z - me.z);
    if (left < 3.2) {
      play('fanfare');
      toast(`${dest.title}에 도착했어요!`);
      clearRoute();
      return;
    }
    const now = performance.now();
    if (force || !route || now - routeAt > 1500) {
      routeAt = now;
      route = findRoute({ x: me.x, z: me.z }, dest);
    } else if (route.length) route[0] = { x: me.x, z: me.z };
    const dist = route ? routeLength(route) : left;
    routePill.hidden = document.body.classList.contains('playing');
    routePill.innerHTML = `<span>🚩 ${esc(dest.title)} · ${Math.round(dist)}m${route ? '' : ' (길이 막혀 있어요)'}</span><button aria-label="길 안내 끄기">끄기</button>`;
  }
  function clearRoute() {
    dest = null;
    route = null;
    routePill.hidden = true;
  }
  function setRoute(m: Mark) {
    // 집이면 대문 앞, 그 밖에는 표시 자리 (막혀 있으면 길 찾기가 가까운 빈 곳으로)
    let x = m.x;
    let z = m.z;
    if (m.houseNo && (m.kind === 'house' || m.kind === 'myhouse')) {
      const s = houseSlot(m.houseNo);
      x = s.x + Math.sin(s.rot) * 4.2;
      z = s.z + Math.cos(s.rot) * 4.2;
    }
    dest = { x, z, title: m.title };
    route = null;
    play('ding');
    if (!hooks.walking()) hooks.startWalking();
    closeBig();
    updateRoute(true);
    toast('길 안내를 시작해요. 주황 점선을 따라가요', 2200);
  }
  routePill.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) {
      play('tap');
      clearRoute();
    }
  });

  // ── 고른 표시 정보 ──
  function showInfo(m: Mark | null) {
    selected = m;
    if (!m) {
      info.hidden = true;
      drawBig();
      return;
    }
    const me = hooks.walking() ? scene.getLocalState() : null;
    const far = me ? ` · 여기서 ${Math.round(Math.hypot(m.x - me.x, m.z - me.z))}m` : '';
    const btns: string[] = [];
    if (m.kind !== 'player' || !me) btns.push('<button class="btn small primary" data-go>길 안내</button>');
    if (m.houseNo) btns.push(`<button class="btn small" data-house="${m.houseNo}">${m.kind === 'player' ? '프로필' : '집 보기'}</button>`);
    info.innerHTML = `<div><b>${esc(m.title)}</b><small>${esc(m.sub)}${far}</small></div><div class="row-btns">${btns.join('')}</div>`;
    info.hidden = false;
    drawBig();
  }
  info.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-go]') && selected) setRoute(selected);
    const h = t.closest<HTMLElement>('[data-house]');
    if (h) {
      closeBig();
      hooks.openHouse(Number(h.dataset.house));
    }
  });

  // ── 큰 지도 조작: 끌기, 두 손가락 확대, 누르기 ──
  const pts = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let moved = 0;
  let pinch0 = 0;
  let radius0 = 0;
  const pxPer = () => {
    const { w, h } = bigSize();
    return Math.min(w, h) / (view.radius * 2);
  };
  bigCanvas.addEventListener('pointerdown', (e) => {
    bigCanvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      downAt = performance.now();
      moved = 0;
    }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      radius0 = view.radius;
      moved = 99;
    }
  });
  bigCanvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (pts.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      const k = pxPer();
      view.cx -= dx / k;
      view.cz -= dy / k;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 2 && pinch0 > 0) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      view.radius = radius0 * (pinch0 / Math.max(10, d));
    }
    drawBig();
  });
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = 0;
    if (pts.size === 0 && moved < 8 && performance.now() - downAt < 450) {
      // 누르기: 가장 가까운 표시 (사람, 주민, 우리 집이 먼저)
      const rect = bigCanvas.getBoundingClientRect();
      const { w, h } = bigSize();
      const k = pxPer();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      let best: Mark | null = null;
      let bestD = Infinity;
      for (const m of marks) {
        const x = (m.x - view.cx) * k + w / 2;
        const y = (m.z - view.cz) * k + h / 2;
        const d = Math.hypot(x - sx, y - sy);
        const prio = m.kind === 'house' ? 4 : 0;
        if (d < m.hit + 4 && d + prio < bestD) {
          bestD = d + prio;
          best = m;
        }
      }
      if (best) play('tap');
      showInfo(best);
    }
  };
  bigCanvas.addEventListener('pointerup', up);
  bigCanvas.addEventListener('pointercancel', up);
  bigCanvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.radius *= e.deltaY > 0 ? 1.15 : 1 / 1.15;
      drawBig();
    },
    { passive: false },
  );
  big.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]') || e.target === big) {
      play('close');
      closeBig();
      return;
    }
    const z = t.closest<HTMLElement>('[data-zoom]');
    if (z) {
      play('tap');
      if (z.dataset.zoom === 'in') view.radius /= 1.5;
      else if (z.dataset.zoom === 'out') view.radius *= 1.5;
      else {
        const a = anchor();
        view.cx = a.x;
        view.cz = a.z;
        view.radius = 45;
      }
      drawBig();
    }
  });

  function openBig() {
    play('open');
    const a = anchor();
    view.cx = a.x;
    view.cz = a.z;
    view.radius = hooks.walking() ? 70 : state.unlockedZones <= 1 ? 105 : 140;
    big.hidden = false;
    document.body.classList.add('map-open');
    showInfo(null);
    marks = collectMarks();
    drawBig();
    clearInterval(bigTimer);
    bigTimer = window.setInterval(() => {
      if (!big.hidden) tick();
    }, 400);
  }
  function closeBig() {
    big.hidden = true;
    document.body.classList.remove('map-open');
    clearInterval(bigTimer);
  }

  box.addEventListener('click', openBig);
  window.addEventListener('resize', () => drawBig());

  return {
    setVisible(on) {
      if (visible === on) return;
      visible = on;
      box.hidden = !on;
      if (!on) routePill.hidden = true;
      clearInterval(timer);
      if (on) {
        tick();
        timer = window.setInterval(tick, 250);
      }
    },
    open: openBig,
    close: closeBig,
  };
}
