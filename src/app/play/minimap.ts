// 걷기 지도 (2026-11-15): 걷는 동안 화면 위에 작은 지도. 주민, 주민 집, 낚시터(연못, 부두), 동굴, 내 위치, 다른 고양이.
// 누르면 섬 전체 지도가 크게 열린다. 씬의 공개 값(landAt, npcHomes, caveMouths, mapHills, dockArea, houseSlot)만 쓴다.
import { caveMouths, dockArea, houseSlot, landAt, mapHills, type IslandScene } from '../../scene';
import { ZONE_CAPACITY } from '../../shared/config';
import { NPC_INFO, type HomeRole } from '../../shared/economy';
import type { RemotePlayer } from '../../shared/types';
import { play } from '../audio/sound';
import { state } from '../state';
import { townNpcs } from './npcs';

const ROLE_MARK: Record<HomeRole, { c: string; t: string }> = {
  shop: { c: '#ff8f7a', t: '상' },
  arcade: { c: '#9f8cf0', t: '오' },
  fisher: { c: '#3fb6b0', t: '낚' },
  gardener: { c: '#6fc275', t: '정' },
  explorer: { c: '#b8875c', t: '탐' },
  resident: { c: '#9ab3d6', t: '이' },
};

interface LandImage {
  canvas: HTMLCanvasElement;
  /** 세계 좌표 (minX, minZ) 가 그림의 (0, 0), 1 픽셀 = scale 단위 */
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
    const a = houseSlot(z * ZONE_CAPACITY + 1);
    // 구역 가운데는 houseSlot 으로 알 수 없으니 그 구역 집들의 범위로 잡는다
    for (const no of [1, 25, 50, 75, 100]) {
      const s = houseSlot(z * ZONE_CAPACITY + no);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    void a;
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

export interface Minimap {
  setVisible(on: boolean): void;
  close(): void;
}

export function createMinimap(scene: IslandScene, players: () => RemotePlayer[]): Minimap {
  const app = document.getElementById('app')!;
  const box = document.createElement('button');
  box.className = 'minimap';
  box.hidden = true;
  box.setAttribute('aria-label', '섬 지도 크게 보기');
  const small = document.createElement('canvas');
  box.appendChild(small);
  app.appendChild(box);

  const big = document.createElement('div');
  big.className = 'bigmap';
  big.hidden = true;
  big.innerHTML = `<div class="bigmap-card"><div class="bigmap-head"><b>섬 지도</b><button class="pill btn-pill" data-close>닫기</button></div><canvas></canvas>
    <div class="legend">${(Object.keys(ROLE_MARK) as HomeRole[])
      .map((r) => `<span><i style="background:${ROLE_MARK[r].c}">${ROLE_MARK[r].t}</i>${r === 'resident' ? '이웃' : NPC_INFO[r].title}</span>`)
      .join('')}<span><i style="background:#4a90c8">물</i>낚시터</span><span><i style="background:#3b2f2a">굴</i>동굴</span><span><i class="me"></i>나</span></div></div>`;
  app.appendChild(big);
  const bigCanvas = big.querySelector('canvas')!;

  let land: LandImage | null = null;
  let visible = false;
  let timer = 0;

  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  /** cx, cz 가운데, 반지름 radius(세계 단위)를 size 픽셀 정사각에 그린다 */
  function render(canvas: HTMLCanvasElement, size: number, cx: number, cz: number, radius: number, labels: boolean) {
    const k = dpr();
    if (canvas.width !== Math.round(size * k)) {
      canvas.width = canvas.height = Math.round(size * k);
      canvas.style.width = canvas.style.height = `${size}px`;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#78c4e2';
    g.fillRect(0, 0, size, size);
    if (!land || land.zones !== state.unlockedZones) land = buildLand(state.unlockedZones);
    const px = size / (radius * 2);
    const toX = (x: number) => (x - cx) * px + size / 2;
    const toY = (z: number) => (z - cz) * px + size / 2;
    g.imageSmoothingEnabled = true;
    g.drawImage(land.canvas, toX(land.minX), toY(land.minZ), land.canvas.width * land.scale * px, land.canvas.height * land.scale * px);

    // 언덕, 동굴 산
    const { hills, ponds } = mapHills(state.unlockedZones);
    g.fillStyle = '#b8ab9c';
    for (const h of hills) {
      g.beginPath();
      g.arc(toX(h.x), toY(h.z), Math.max(1.5, h.r * px), 0, Math.PI * 2);
      g.fill();
    }
    const caves = caveMouths(state.unlockedZones);
    for (const m of caves) {
      g.fillStyle = '#9d8f82';
      g.beginPath();
      g.arc(toX(m.hillX), toY(m.hillZ), Math.max(3, m.r * px), 0, Math.PI * 2);
      g.fill();
    }
    // 집 (입주한 집은 지붕 색, 빈 집은 흐리게)
    const maxNo = state.unlockedZones * ZONE_CAPACITY;
    const dot = Math.max(1.5, 2.6 * px);
    for (let no = 1; no <= maxNo; no++) {
      const s = houseSlot(no);
      const x = toX(s.x);
      const y = toY(s.z);
      if (x < -4 || y < -4 || x > size + 4 || y > size + 4) continue;
      const h = state.houses.get(no);
      g.fillStyle = h ? h.roofColor : 'rgba(255,255,255,0.55)';
      g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      if (state.me?.houseNo === no) {
        g.strokeStyle = '#5b4636';
        g.lineWidth = 1.5;
        g.strokeRect(x - dot / 2 - 1.5, y - dot / 2 - 1.5, dot + 3, dot + 3);
      }
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
    const r = labels ? 9 : 7;
    // 낚시터: 연못과 부두 끝
    for (const p of ponds) icon(toX(p.x), toY(p.z), '#4a90c8', '물', r);
    const dock = dockArea();
    icon(toX(dock.x), toY(dock.z1), '#4a90c8', '물', r);
    for (const m of caves) icon(toX(m.x), toY(m.z), '#3b2f2a', '굴', r);
    // 주민
    for (const n of townNpcs(state.unlockedZones)) {
      const mk = ROLE_MARK[n.role];
      icon(toX(n.x), toY(n.z), mk.c, mk.t, r);
      if (labels && n.role !== 'resident') {
        g.fillStyle = '#5b4636';
        g.font = '700 11px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(NPC_INFO[n.role].name, toX(n.x), toY(n.z) + r + 8);
      }
    }
    // 다른 고양이
    g.fillStyle = '#fffaf2';
    for (const p of players()) {
      g.beginPath();
      g.arc(toX(p.x), toY(p.z), 2.6, 0, Math.PI * 2);
      g.fill();
    }
    // 나: 바라보는 쪽 화살표
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

  function tick() {
    if (!visible) return;
    const me = scene.getLocalState();
    render(small, 112, me.x, me.z, 46, false);
    if (!big.hidden) {
      const size = Math.min(window.innerWidth - 40, 520);
      // 열린 섬 전체가 들어가게
      const zones = state.unlockedZones;
      const radius = zones <= 1 ? 112 : 112 + Math.sqrt(zones) * 110;
      const c0 = houseSlot(1);
      void c0;
      render(bigCanvas, size, zones <= 1 ? 0 : me.x, zones <= 1 ? 0 : me.z, radius, true);
    }
  }

  box.addEventListener('click', () => {
    play('open');
    big.hidden = false;
    tick();
  });
  big.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-close]') || e.target === big) {
      play('close');
      big.hidden = true;
    }
  });

  return {
    setVisible(on) {
      if (visible === on) return;
      visible = on;
      box.hidden = !on;
      if (!on) big.hidden = true;
      clearInterval(timer);
      if (on) {
        tick();
        timer = window.setInterval(tick, 250);
      }
    },
    close() {
      big.hidden = true;
    },
  };
}
