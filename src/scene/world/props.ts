import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { fillAttr, paint, paintGradientY } from '../util/geo';
import { mulberry32 } from '../util/rand';

/**
 * 섬 장식 소품. 각 함수는 원점(바닥 가운데)에 놓인 조각 목록을 돌려준다.
 * 조각마다 색(꼭짓점 색)과 aMask(x=0, y=밤에 빛남)가 붙어 있어서
 * 나중에 한 덩어리로 합쳐 그리기 1번으로 그린다.
 */
export type Pieces = THREE.BufferGeometry[];

function p(geo: THREE.BufferGeometry, color: string, glow = 0, shade = 1) {
  paint(geo, color, shade);
  fillAttr(geo, 'aMask', [0, glow]);
  return geo;
}
function pg(geo: THREE.BufferGeometry, bottom: string, top: string) {
  paintGradientY(geo, bottom, top);
  fillAttr(geo, 'aMask', [0, 0]);
  return geo;
}

/** 조각들을 크기 → 회전 → 위치 순으로 옮긴다 */
export function place(pieces: Pieces, x: number, y: number, z: number, rotY = 0, scale = 1): Pieces {
  for (const g of pieces) {
    if (scale !== 1) g.scale(scale, scale, scale);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
  }
  return pieces;
}

/** 몽실몽실한 잎 덩어리 */
function blob(r: number, x: number, y: number, z: number, squash = 0.86, bottom = '#62b565', top = '#a9df7c') {
  const g = new THREE.SphereGeometry(r, 9, 6);
  g.scale(1, squash, 1);
  g.translate(x, y, z);
  return pg(g, bottom, top);
}

/** 덤불용 가벼운 잎 덩어리 */
function lowBlob(r: number, x: number, y: number, z: number, squash: number, bottom: string, top: string) {
  const g = new THREE.SphereGeometry(r, 8, 5);
  g.scale(1, squash, 1);
  g.translate(x, y, z);
  return pg(g, bottom, top);
}

/** 광장의 큰 귤나무 */
export function plazaTree(): Pieces {
  const out: Pieces = [];
  const trunk = new THREE.CylinderGeometry(0.3, 0.52, 2.3, 10, 3);
  trunk.translate(0, 1.15, 0);
  out.push(pg(trunk, '#93643f', '#b98858'));
  // 뿌리 쪽 화단 테두리
  const ring = new THREE.TorusGeometry(1.05, 0.2, 8, 22).rotateX(Math.PI / 2);
  ring.scale(1, 0.9, 1);
  ring.translate(0, 0.12, 0);
  out.push(p(ring, '#e4d9c6'));
  const soil = new THREE.CylinderGeometry(1.05, 1.05, 0.14, 20).translate(0, 0.07, 0);
  out.push(p(soil, '#8fcf70'));
  // 잎
  out.push(blob(1.55, 0, 3.55, 0));
  out.push(blob(1.15, 1.15, 3.0, 0.35));
  out.push(blob(1.2, -1.15, 3.1, 0.25));
  out.push(blob(1.05, 0.15, 3.05, -1.05));
  out.push(blob(1.0, 0.1, 2.85, 1.1));
  out.push(blob(0.85, -0.75, 3.95, -0.35));
  // 귤
  const rnd = mulberry32(7);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const up = 0.15 + rnd() * 0.75;
    const r = 1.9 * Math.sqrt(1 - up * up * 0.55);
    const f = new THREE.SphereGeometry(0.15, 6, 5);
    f.translate(Math.cos(a) * r * 0.86, 2.75 + up * 1.55, Math.sin(a) * r * 0.86);
    out.push(p(f, '#ffa62b'));
  }
  return out;
}

/** 작은 동글 나무 */
export function roundTree(seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  const h = 0.9 + rnd() * 0.35;
  const trunk = new THREE.CylinderGeometry(0.11, 0.17, h, 8);
  trunk.translate(0, h / 2, 0);
  out.push(pg(trunk, '#93643f', '#b98858'));
  const r = 0.72 + rnd() * 0.22;
  out.push(blob(r, 0, h + r * 0.62, 0, 0.9));
  out.push(blob(r * 0.66, r * 0.55, h + r * 0.35, r * 0.2, 0.9));
  out.push(blob(r * 0.6, -r * 0.5, h + r * 0.45, -r * 0.25, 0.9));
  return out;
}

/** 층층이 쌓인 뾰족 나무 */
export function coneTree(seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.15, 0.6, 8).translate(0, 0.3, 0);
  out.push(pg(trunk, '#8a5d3b', '#a97a50'));
  const s = 0.9 + rnd() * 0.3;
  const tiers = [
    [0.78, 0.95, 0.45],
    [0.6, 0.85, 1.0],
    [0.42, 0.75, 1.5],
  ];
  for (const [r, h, y] of tiers) {
    const c = new THREE.ConeGeometry(r * s, h * s, 10, 2);
    c.translate(0, (y + h / 2) * s, 0);
    out.push(pg(c, '#4fa46a', '#8fd58a'));
  }
  return out;
}

/** 낮은 덤불 */
export function bush(seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.36 + rnd() * 0.2;
    out.push(lowBlob(r, (i - (n - 1) / 2) * 0.42, r * 0.7, (rnd() - 0.5) * 0.3, 0.8, '#5fb267', '#9edb7c'));
  }
  if (rnd() > 0.4) {
    // 열매나 작은 꽃
    const col = rnd() > 0.5 ? '#ff8fa3' : '#fff3b0';
    for (let i = 0; i < 4; i++) {
      const f = new THREE.OctahedronGeometry(0.075);
      f.translate((rnd() - 0.5) * 0.7, 0.5 + rnd() * 0.18, 0.2 + rnd() * 0.2);
      out.push(p(f, col));
    }
  }
  return out;
}

/** 꽃 몇 송이 */
export function flowers(seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  const palette = ['#ff8fa3', '#ffd166', '#ffffff', '#c9a7ff', '#ffb37a'];
  const col = palette[Math.floor(rnd() * palette.length)];
  const n = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * 0.9;
    const z = (rnd() - 0.5) * 0.9;
    const h = 0.2 + rnd() * 0.14;
    const stem = new THREE.CylinderGeometry(0.018, 0.022, h, 3, 1, true).translate(x, h / 2, z);
    out.push(p(stem, '#6fbf63'));
    const head = new THREE.IcosahedronGeometry(0.1, 0);
    head.scale(1, 0.62, 1);
    head.translate(x, h + 0.03, z);
    out.push(p(head, col));
    const mid = new THREE.TetrahedronGeometry(0.055).translate(x, h + 0.08, z);
    out.push(p(mid, col === '#ffd166' ? '#ff9f43' : '#ffe08a'));
  }
  return out;
}

/** 둥근 바위 */
export function rock(seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  const g = new THREE.IcosahedronGeometry(0.4 + rnd() * 0.25, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + (Math.sin(pos.getX(i) * 9.1 + seed) + Math.cos(pos.getZ(i) * 7.3 + seed * 2)) * 0.05;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.scale(1.15, 0.7, 0.95);
  g.translate(0, 0.16, 0);
  g.computeVertexNormals();
  out.push(pg(g, '#b9b2a6', '#e6dfd2'));
  if (rnd() > 0.5) {
    const s = new THREE.IcosahedronGeometry(0.2, 1);
    s.scale(1.1, 0.75, 1);
    s.translate(0.45, 0.08, 0.15);
    out.push(pg(s, '#b9b2a6', '#e6dfd2'));
  }
  return out;
}

/** 길가 등불 (밤에 빛남) */
export function lantern(): Pieces {
  const out: Pieces = [];
  out.push(p(new THREE.CylinderGeometry(0.16, 0.2, 0.14, 7).translate(0, 0.07, 0), '#cfc3b2'));
  out.push(p(new THREE.CylinderGeometry(0.055, 0.07, 1.35, 5).translate(0, 0.78, 0), '#8a6a52'));
  out.push(p(new THREE.BoxGeometry(0.4, 0.07, 0.4).translate(0, 1.46, 0), '#8a6a52'));
  out.push(p(new THREE.CylinderGeometry(0.2, 0.17, 0.42, 7).translate(0, 1.7, 0), '#fff1c2', 1));
  const cap = new THREE.ConeGeometry(0.3, 0.16, 7).translate(0, 1.98, 0);
  out.push(p(cap, '#8a6a52'));
  out.push(p(new THREE.SphereGeometry(0.05, 5, 4).translate(0, 2.08, 0), '#f4c95d'));
  return out;
}

/** 나무 부두. 원점에서 +z 로 length 만큼 뻗는다. 상판 윗면 높이는 deckY */
export function dock(length: number, deckY: number): Pieces {
  const out: Pieces = [];
  const w = 1.9;
  const plank = 0.36;
  const n = Math.floor(length / plank);
  for (let i = 0; i < n; i++) {
    const g = new RoundedBoxGeometry(w + (i % 3 === 1 ? 0.08 : 0), 0.1, plank - 0.04, 1, 0.03);
    g.translate(0, deckY - 0.05, (i + 0.5) * plank);
    out.push(p(g, i % 2 ? '#d7a878' : '#cb9a69'));
  }
  for (const sx of [-1, 1]) {
    out.push(p(new THREE.BoxGeometry(0.12, 0.12, length).translate(sx * (w / 2 - 0.12), deckY - 0.15, length / 2), '#a97a52'));
    for (let z = 0.5; z < length; z += 1.9) {
      const post = new THREE.CylinderGeometry(0.12, 0.13, 1.5, 8).translate(sx * (w / 2 + 0.02), deckY - 0.45, z);
      out.push(p(post, '#9c6f4b'));
      out.push(p(new THREE.SphereGeometry(0.13, 8, 6).translate(sx * (w / 2 + 0.02), deckY + 0.32, z), '#f6ead8'));
    }
  }
  return out;
}

/** 작은 돛단배. 원점은 물에 뜬 배의 수면 높이 가운데, 뱃머리는 +z */
export function boat(): Pieces {
  const out: Pieces = [];
  const hull = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hull.scale(0.82, 0.62, 1.7);
  hull.translate(0, 0.3, 0);
  out.push(pg(hull, '#f2705f', '#ff9a82'));
  const rim = new THREE.TorusGeometry(1, 0.085, 8, 28).rotateX(Math.PI / 2);
  rim.scale(0.82, 1, 1.7);
  rim.translate(0, 0.3, 0);
  out.push(p(rim, '#fff6ea'));
  const deck = new THREE.CylinderGeometry(1, 1, 0.04, 24);
  deck.scale(0.78, 1, 1.64);
  deck.translate(0, 0.2, 0);
  out.push(p(deck, '#e9c79a'));
  out.push(p(new RoundedBoxGeometry(1.3, 0.09, 0.3, 1, 0.03).translate(0, 0.32, -0.55), '#cb9a69'));
  out.push(p(new THREE.CylinderGeometry(0.05, 0.06, 2.3, 8).translate(0, 1.35, 0.25), '#9c6f4b'));
  // 돛 (얇은 세모판)
  const sail = new THREE.Shape();
  sail.moveTo(0, 0);
  sail.quadraticCurveTo(0.75, 0.2, 1.25, 0.05);
  sail.quadraticCurveTo(0.5, 0.95, 0, 1.75);
  sail.lineTo(0, 0);
  const sg = new THREE.ExtrudeGeometry(sail, { depth: 0.04, bevelEnabled: false, curveSegments: 6 });
  sg.rotateY(Math.PI / 2);
  sg.translate(0.02, 0.62, 0.18);
  out.push(p(sg, '#fff9ee'));
  // 깃발
  const flag = new THREE.ConeGeometry(0.16, 0.34, 3).rotateZ(-Math.PI / 2);
  flag.scale(1, 1, 0.2);
  flag.rotateY(Math.PI / 2);
  flag.translate(0, 2.4, 0.08);
  out.push(p(flag, '#ffd166'));
  return out;
}

/**
 * 섬과 섬을 잇는 아치형 나무다리. 가운데가 원점, x 방향으로 length 만큼 뻗는다.
 * 양 끝은 endY(풀밭 높이)에 닿고 가운데가 rise 만큼 솟는다.
 */
export function bridge(length: number, endY: number, rise = 0.85): Pieces {
  const out: Pieces = [];
  const w = 2.3;
  const yAt = (x: number) => endY + rise * (1 - Math.pow((2 * x) / length, 2));
  const n = Math.round(length / 0.5);
  for (let i = 0; i < n; i++) {
    const x0 = -length / 2 + (i / n) * length;
    const x1 = -length / 2 + ((i + 1) / n) * length;
    const g = new THREE.BoxGeometry(Math.hypot(x1 - x0, yAt(x1) - yAt(x0)) - 0.03, 0.1, w);
    g.rotateZ(Math.atan2(yAt(x1) - yAt(x0), x1 - x0));
    g.translate((x0 + x1) / 2, (yAt(x0) + yAt(x1)) / 2 - 0.05, 0);
    out.push(p(g, i % 2 ? '#d7a878' : '#cb9a69'));
  }
  const posts = Math.round(length / 2.4);
  for (const sz of [-1, 1]) {
    for (let i = 0; i <= posts; i++) {
      const x = -length / 2 + (i / posts) * length;
      const y = yAt(x);
      out.push(p(new THREE.BoxGeometry(0.16, 0.75, 0.16).translate(x, y + 0.32, sz * (w / 2 - 0.05)), '#a97a52'));
      out.push(p(new THREE.SphereGeometry(0.12, 8, 6).translate(x, y + 0.76, sz * (w / 2 - 0.05)), '#f6ead8'));
      if (i < posts) {
        const xn = -length / 2 + ((i + 1) / posts) * length;
        const yn = yAt(xn);
        const rail = new THREE.BoxGeometry(Math.hypot(xn - x, yn - y), 0.08, 0.08);
        rail.rotateZ(Math.atan2(yn - y, xn - x));
        rail.translate((x + xn) / 2, (y + yn) / 2 + 0.55, sz * (w / 2 - 0.05));
        out.push(p(rail, '#f6ead8'));
      }
    }
    // 물속 기둥
    for (const t of [-0.28, 0, 0.28]) {
      const x = t * length;
      const h = yAt(x) + 1.0;
      out.push(p(new THREE.CylinderGeometry(0.16, 0.18, h, 8).translate(x, yAt(x) - 0.1 - h / 2, sz * (w / 2 - 0.25)), '#9c6f4b'));
    }
  }
  return out;
}

/** 광장 둘레 벤치 (원점 기준, 앞은 +z) */
export function plazaBench(): Pieces {
  const out: Pieces = [];
  out.push(p(new THREE.BoxGeometry(1.5, 0.09, 0.46).translate(0, 0.42, 0), '#cb9a69'));
  out.push(p(new THREE.BoxGeometry(1.5, 0.34, 0.08).translate(0, 0.72, -0.22), '#cb9a69'));
  for (const sx of [-1, 1]) out.push(p(new THREE.BoxGeometry(0.1, 0.42, 0.42).translate(sx * 0.6, 0.21, 0), '#a2734c'));
  return out;
}

/** 동네 가운데의 큰 나무 (광장 귤나무보다 크고, 열매 없이 잎만 풍성하다) */
export function bigTree(): Pieces {
  const out: Pieces = [];
  const trunk = new THREE.CylinderGeometry(0.42, 0.78, 3.0, 10, 3);
  trunk.translate(0, 1.5, 0);
  out.push(pg(trunk, '#86593a', '#b08253'));
  // 땅 위로 드러난 뿌리
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const root = new THREE.SphereGeometry(0.34, 7, 5);
    root.scale(1.5, 0.55, 0.8);
    root.rotateY(-a);
    root.translate(Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75);
    out.push(pg(root, '#7c5235', '#a57a4f'));
  }
  const leaves: Array<[number, number, number, number]> = [
    [2.2, 0, 4.9, 0],
    [1.7, 1.75, 4.1, 0.5],
    [1.75, -1.7, 4.2, 0.35],
    [1.55, 0.2, 4.15, -1.65],
    [1.5, 0.15, 3.9, 1.7],
    [1.35, -1.0, 5.6, -0.5],
    [1.25, 1.1, 5.5, 0.4],
  ];
  for (const [r, x, y, z] of leaves) out.push(blob(r, x, y, z, 0.84, '#4fa860', '#a3dc78'));
  return out;
}

/** 연못: 얕은 물, 돌 테두리, 연잎 몇 장. radius 는 물의 반지름 */
export function pond(radius: number, seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  const rim = new THREE.TorusGeometry(radius + 0.08, 0.26, 6, 28).rotateX(Math.PI / 2);
  rim.scale(1, 0.55, 1);
  rim.translate(0, 0.06, 0);
  out.push(pg(rim, '#cfc4b2', '#efe6d6'));
  const water = new THREE.CircleGeometry(radius, 28).rotateX(-Math.PI / 2).translate(0, 0.07, 0);
  // 가운데는 깊은 색, 가장자리는 얕은 색
  {
    const pos = water.attributes.position;
    const a = new THREE.Color('#58bfe0');
    const b = new THREE.Color('#aee8f2');
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)) / radius);
      arr[i * 3] = a.r + (b.r - a.r) * t;
      arr[i * 3 + 1] = a.g + (b.g - a.g) * t;
      arr[i * 3 + 2] = a.b + (b.b - a.b) * t;
    }
    water.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    fillAttr(water, 'aMask', [0, 0]);
  }
  out.push(water);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.25 + rnd() * 0.6);
    const pad = new THREE.CircleGeometry(0.3 + rnd() * 0.16, 9, 0.5, Math.PI * 2 - 0.9).rotateX(-Math.PI / 2);
    pad.rotateY(rnd() * 6);
    pad.translate(Math.cos(a) * d, 0.085, Math.sin(a) * d);
    out.push(p(pad, '#7cc76a'));
    if (i % 3 === 0) {
      const bud = new THREE.IcosahedronGeometry(0.11, 0);
      bud.scale(1, 0.7, 1);
      bud.translate(Math.cos(a) * d, 0.15, Math.sin(a) * d);
      out.push(p(bud, '#ffc2d4'));
    }
  }
  return out;
}

/** 풀 한 포기 (아주 가볍다) */
export function tuft(seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.ConeGeometry(0.07, 0.3 + rnd() * 0.16, 3, 1, true);
    g.translate(0, 0.17, 0);
    g.rotateZ((rnd() - 0.5) * 0.7);
    g.rotateY(rnd() * 6);
    g.translate((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
    out.push(pg(g, '#7cc468', '#b6e88a'));
  }
  return out;
}

// ───────────── 섬 모서리 (2026-11-15) ─────────────

/** 주민 집 모양 (index: HOME_SPOTS 순번). 지붕/차양 색과 간판 그림이 집마다 다르다 */
const HOME_STYLE: ReadonlyArray<{ roof: string; awning: string; wall: string; sign: 'pick' | 'leaf' | 'bag' | 'star' | 'fish' | 'flower' | 'heart' }> = [
  { roof: '#8d7a6b', awning: '#f4c95d', wall: '#f3e3cc', sign: 'pick' },
  { roof: '#9fb7d9', awning: '#ffffff', wall: '#fff3dc', sign: 'heart' },
  // 2026-11-16: 북동 두 집은 화가(별), 우체부(하트)의 집 (잡화점/오락실 가게 모양을 없앴다)
  { roof: '#d97bc4', awning: '#ffffff', wall: '#fff6f8', sign: 'star' },
  { roof: '#5aa0d8', awning: '#ffffff', wall: '#f2f7ff', sign: 'heart' },
  { roof: '#5cc2b5', awning: '#5cc2b5', wall: '#f2f6f2', sign: 'fish' },
  { roof: '#e6a37e', awning: '#ffffff', wall: '#fff3dc', sign: 'heart' },
  { roof: '#7fc98a', awning: '#ff9ec2', wall: '#f8fbef', sign: 'flower' },
  { roof: '#d8a3c8', awning: '#ffffff', wall: '#fff3dc', sign: 'heart' },
];

/** 주민 집: 섬 집보다 조금 크고 문 위에 차양과 간판이 있다. 원점이 몸체 가운데, +z 가 앞 */
export function npcHome(index: number): Pieces {
  const st = HOME_STYLE[index % HOME_STYLE.length];
  const out: Pieces = [];
  const W = 3.5;
  const D = 2.9;
  out.push(p(new RoundedBoxGeometry(W + 0.3, 0.24, D + 0.3, 1, 0.08).translate(0, 0.12, 0), '#d6cbbb'));
  out.push(p(new RoundedBoxGeometry(W, 1.9, D, 2, 0.16).translate(0, 1.15, 0), st.wall));
  out.push(p(new RoundedBoxGeometry(W + 0.06, 0.4, D + 0.06, 1, 0.12).translate(0, 0.42, 0), '#f1dcc0', 0, 0.97));
  // 박공 지붕 (앞뒤로 기운 두 판)
  for (const side of [-1, 1]) {
    const slab = new RoundedBoxGeometry(W + 0.7, 0.18, D * 0.72, 1, 0.08);
    slab.rotateX(side * 0.62);
    slab.translate(0, 2.55, side * D * 0.27);
    out.push(p(slab, st.roof));
  }
  {
    const s = new THREE.Shape();
    s.moveTo(-D / 2, 0);
    s.lineTo(D / 2, 0);
    s.lineTo(0, 0.95);
    s.lineTo(-D / 2, 0);
    for (const sx of [-1, 1]) {
      const g = new THREE.ShapeGeometry(s);
      g.rotateY(Math.PI / 2);
      g.translate(sx * (W / 2 - 0.02), 2.08, 0);
      if (sx < 0) g.rotateY(0);
      out.push(p(g, st.wall, 0, 0.94));
      const back = g.clone();
      back.scale(-1, 1, 1);
      out.push(p(back, st.wall, 0, 0.94));
    }
  }
  // 굴뚝
  out.push(p(new RoundedBoxGeometry(0.4, 0.9, 0.4, 1, 0.06).translate(W * 0.28, 2.95, -0.55), '#e9d9c4'));
  // 문, 창문 (밤에 빛남)
  const fz = D / 2;
  out.push(p(new RoundedBoxGeometry(0.86, 1.36, 0.1, 1, 0.08).translate(0, 0.9, fz + 0.02), '#fffdf6'));
  out.push(p(new RoundedBoxGeometry(0.7, 1.24, 0.1, 1, 0.06).translate(0, 0.86, fz + 0.05), '#b9825a'));
  out.push(p(new THREE.SphereGeometry(0.05, 6, 5).translate(0.22, 0.85, fz + 0.12), '#f4c95d'));
  for (const sx of [-1, 1]) {
    out.push(p(new RoundedBoxGeometry(0.66, 0.62, 0.1, 1, 0.08).translate(sx * 1.1, 1.2, fz + 0.02), '#fffdf6'));
    out.push(p(new RoundedBoxGeometry(0.5, 0.46, 0.08, 1, 0.06).translate(sx * 1.1, 1.2, fz + 0.06), '#ffe7a6', 1));
  }
  // 차양 (줄무늬)
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.BoxGeometry(W / 6 - 0.02, 0.06, 0.62);
    seg.rotateX(0.38);
    seg.translate(-W / 2 + (i + 0.5) * (W / 6), 1.92, fz + 0.32);
    out.push(p(seg, i % 2 ? '#ffffff' : st.awning));
  }
  // 간판: 문 위 둥근 판 + 그림
  out.push(p(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 18).rotateX(Math.PI / 2).translate(0, 2.32, fz + 0.12), '#fffdf6'));
  out.push(p(new THREE.TorusGeometry(0.42, 0.05, 5, 18).translate(0, 2.32, fz + 0.15), '#9a6645'));
  const iconZ = fz + 0.18;
  const ic = (g: THREE.BufferGeometry, color: string) => out.push(p(g.translate(0, 2.32, iconZ), color));
  if (st.sign === 'pick') {
    ic(new THREE.BoxGeometry(0.06, 0.5, 0.03).rotateZ(0.6), '#9a6645');
    ic(new THREE.TorusGeometry(0.2, 0.04, 4, 10, Math.PI).rotateZ(0.6 + Math.PI / 2).translate(0.12, 0.14, 0), '#8a8f99');
  } else if (st.sign === 'bag') {
    ic(new RoundedBoxGeometry(0.4, 0.32, 0.04, 1, 0.06).translate(0, -0.04, 0), '#ff8f7a');
    ic(new THREE.TorusGeometry(0.1, 0.03, 4, 10, Math.PI).translate(0, 0.12, 0), '#9a6645');
  } else if (st.sign === 'star') {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.12 : 0.28;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ic(new THREE.ShapeGeometry(s), '#ffcf3f');
  } else if (st.sign === 'fish') {
    ic(new THREE.SphereGeometry(0.2, 8, 6).scale(1.2, 0.6, 0.2), '#5f8fa8');
    ic(new THREE.ConeGeometry(0.12, 0.18, 3).rotateZ(Math.PI / 2).scale(1, 1, 0.2).translate(0.3, 0, 0), '#5f8fa8');
  } else if (st.sign === 'flower') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ic(new THREE.SphereGeometry(0.1, 6, 5).scale(1, 1, 0.3).translate(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0), '#ff9ec2');
    }
    ic(new THREE.SphereGeometry(0.08, 6, 5).scale(1, 1, 0.4), '#ffd166');
  } else {
    // 하트
    ic(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 1, 0.3).translate(-0.09, 0.05, 0), '#ff8fa3');
    ic(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 1, 0.3).translate(0.09, 0.05, 0), '#ff8fa3');
    ic(new THREE.ConeGeometry(0.19, 0.24, 4).rotateZ(Math.PI).scale(1, 1, 0.3).translate(0, -0.1, 0), '#ff8fa3');
  }
  // 문 앞 디딤돌과 화분
  out.push(p(new RoundedBoxGeometry(1.1, 0.12, 0.5, 1, 0.05).translate(0, 0.06, fz + 0.45), '#d6cbbb'));
  for (const sx of [-1, 1]) {
    out.push(p(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 8).translate(sx * 0.75, 0.15, fz + 0.5), '#d98b5e'));
    out.push(blob(0.24, sx * 0.75, 0.45, fz + 0.5, 0.9, '#5fae62', '#a3dc78'));
  }
  return out;
}

/** 바위 언덕 겉면을 울퉁불퉁하게 */
function lumpy(g: THREE.BufferGeometry, seed: number, amount: number) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + (Math.sin(x * 2.1 + seed) * Math.cos(z * 1.7 + seed * 0.7) + Math.sin(y * 2.9 + seed * 1.3)) * amount;
    pos.setXYZ(i, x * k, y * (0.92 + (k - 1) * 0.5), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** 바위 언덕: 원점에 반지름 1 (scale 로 키운다). 위에 풀과 작은 나무 */
export function hill(seed: number): Pieces {
  const rnd = mulberry32(seed);
  const out: Pieces = [];
  const h = 0.75 + rnd() * 0.3;
  const body = new THREE.CylinderGeometry(0.78, 1.0, h, 12, 3);
  body.translate(0, h / 2, 0);
  out.push(pg(lumpy(body, seed, 0.07), '#a89a8a', '#cfc3b2'));
  const top = new THREE.SphereGeometry(0.8, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  top.scale(1, 0.32, 1);
  top.translate(0, h - 0.02, 0);
  out.push(pg(lumpy(top, seed + 3, 0.05), '#7cc06a', '#a9df7c'));
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.25 + rnd() * 0.3;
    out.push(blob(0.16 + rnd() * 0.08, Math.cos(a) * r, h + 0.2, Math.sin(a) * r, 0.9, '#4fa46a', '#8fd58a'));
  }
  // 아래쪽 굴러떨어진 돌
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2;
    const g = new THREE.IcosahedronGeometry(0.12 + rnd() * 0.08, 0);
    g.translate(Math.cos(a) * 1.08, 0.06, Math.sin(a) * 1.08);
    out.push(pg(g, '#a89a8a', '#d6cbbb'));
  }
  return out;
}

/** 동굴 산: 원점에 큰 바위산, +z 쪽에 동굴 입구 (rot 으로 돌린다). r 은 산 반지름 */
export function caveHill(r: number): Pieces {
  const out: Pieces = [];
  const rnd = mulberry32(77);
  // 층층이 쌓인 바위
  const tiers: Array<[number, number, number, number, number]> = [
    [r, r * 0.95, 0, 2.2, 0],
    [r * 0.82, r * 0.98, 2.1, 2.0, 1],
    [r * 0.6, r * 0.8, 4.0, 1.8, 2],
    [r * 0.36, r * 0.58, 5.7, 1.5, 3],
  ];
  for (const [top, bottom, y, h, k] of tiers) {
    const g = new THREE.CylinderGeometry(top, bottom, h, 16, 3);
    g.translate((rnd() - 0.5) * 0.6, y + h / 2, (rnd() - 0.5) * 0.6 - k * 0.25);
    out.push(pg(lumpy(g, 31 + k * 7, 0.06), k % 2 ? '#9d8f82' : '#8f8276', k % 2 ? '#c3b6a6' : '#b8ab9c'));
  }
  // 꼭대기 풀과 나무
  const cap = new THREE.SphereGeometry(r * 0.38, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.35, 1);
  cap.translate(0, 7.15, -0.75);
  out.push(pg(cap, '#6fb565', '#a3dc78'));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * r * 0.22;
    const z = Math.sin(a) * r * 0.22 - 0.75;
    out.push(p(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6).translate(x, 7.45, z), '#93643f'));
    out.push(blob(0.5, x, 8.0, z, 0.95, '#4fa46a', '#8fd58a'));
  }
  // 층 사이 풀 띠
  for (const y of [2.15, 4.05]) {
    const t = new THREE.TorusGeometry(y < 3 ? r * 0.86 : r * 0.66, 0.22, 4, 24).rotateX(Math.PI / 2);
    t.scale(1, 0.6, 1);
    t.translate(0, y + 0.04, y < 3 ? -0.2 : -0.45);
    out.push(pg(t, '#6fb565', '#93cf73'));
  }
  // 동굴 입구 (+z 쪽): 어두운 굴 + 나무 기둥 틀
  const mz = r * 0.93;
  const hole = new THREE.CircleGeometry(1.25, 18, 0, Math.PI);
  hole.scale(1, 1.25, 1);
  hole.translate(0, 0.02, mz + 0.06);
  out.push(p(hole, '#1d1820'));
  const holeIn = new THREE.CylinderGeometry(1.2, 1.2, 1.4, 14, 1, true, -Math.PI / 2, Math.PI);
  holeIn.rotateX(Math.PI / 2);
  holeIn.scale(1, 1, 1);
  holeIn.translate(0, 0, mz - 0.6);
  out.push(p(holeIn, '#2a2229'));
  for (const sx of [-1, 1]) out.push(p(new THREE.BoxGeometry(0.22, 1.7, 0.22).translate(sx * 1.2, 0.85, mz + 0.25), '#9a6645'));
  out.push(p(new THREE.BoxGeometry(2.8, 0.24, 0.26).translate(0, 1.78, mz + 0.25), '#9a6645'));
  // 입구 간판과 광차 레일
  out.push(p(new RoundedBoxGeometry(1.3, 0.42, 0.08, 1, 0.06).translate(0, 2.2, mz + 0.32), '#f4dfbd'));
  for (let i = 0; i < 6; i++) out.push(p(new THREE.BoxGeometry(1.3, 0.06, 0.18).translate(0, 0.04, mz + 0.4 + i * 0.5), '#8a6a52'));
  for (const sx of [-1, 1]) out.push(p(new THREE.BoxGeometry(0.06, 0.06, 3.0).translate(sx * 0.45, 0.09, mz + 1.6), '#8a8f99'));
  // 입구 옆 반짝이는 수정 (밤에 빛남)
  for (const [x, z, c] of [
    [-1.9, mz + 0.2, '#b07ce8'],
    [1.8, mz + 0.1, '#8fe3ff'],
  ] as Array<[number, number, string]>) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.ConeGeometry(0.12, 0.6 - i * 0.12, 5);
      g.rotateZ((i - 1) * 0.35);
      g.translate(x + (i - 1) * 0.14, 0.28, z);
      out.push(p(g, c, 1));
    }
  }
  return out;
}

/** 마을 게시판 (2026-11-15): 기둥 두 개, 작은 지붕, 종이 쪽지들. 원점이 바닥 가운데, 앞이 +z */
export function townBoard(): Pieces {
  const out: Pieces = [];
  const W = 3.4;
  for (const sx of [-1, 1]) {
    out.push(p(new THREE.CylinderGeometry(0.13, 0.16, 2.6, 8).translate(sx * (W / 2 + 0.05), 1.3, 0), '#8a5d3d'));
    out.push(p(new THREE.CylinderGeometry(0.22, 0.26, 0.18, 8).translate(sx * (W / 2 + 0.05), 0.09, 0), '#bfb2a1'));
  }
  // 판 + 테두리
  out.push(p(new RoundedBoxGeometry(W, 1.55, 0.14, 1, 0.05).translate(0, 1.45, 0), '#c99764'));
  out.push(p(new RoundedBoxGeometry(W - 0.22, 1.33, 0.06, 1, 0.03).translate(0, 1.45, 0.06), '#e9cfa3'));
  // 지붕 (앞뒤로 기운 판)
  for (const side of [-1, 1]) {
    const slab = new RoundedBoxGeometry(W + 0.6, 0.12, 0.55, 1, 0.05);
    slab.rotateX(side * 0.5);
    slab.translate(0, 2.52, side * 0.2);
    out.push(p(slab, '#d9775a'));
  }
  // 쪽지들 (밤에 살짝 빛남)
  const notes: Array<[number, number, number, number, string]> = [
    [-1.15, 1.72, 0.62, 0.5, '#fffaf0'],
    [-0.35, 1.62, 0.55, 0.68, '#ffe9a8'],
    [0.45, 1.75, 0.7, 0.44, '#d8efff'],
    [1.2, 1.55, 0.5, 0.6, '#ffd6e0'],
    [-1.0, 1.08, 0.7, 0.42, '#e3f7d6'],
    [0.05, 1.05, 0.62, 0.4, '#fffaf0'],
    [0.95, 1.06, 0.6, 0.38, '#ffe9a8'],
  ];
  notes.forEach(([x, y, w, h, c], i) => {
    const g = new THREE.BoxGeometry(w, h, 0.02);
    g.rotateZ((i % 3 - 1) * 0.05);
    out.push(p(g.translate(x, y, 0.1), c, 0.35));
    out.push(p(new THREE.SphereGeometry(0.035, 5, 4).translate(x, y + h / 2 - 0.06, 0.12), '#e2574c'));
  });
  // 꼭대기 간판 (둥근 판 + 확성기 모양)
  out.push(p(new RoundedBoxGeometry(1.5, 0.42, 0.1, 1, 0.08).translate(0, 2.9, 0.18), '#fffdf6'));
  out.push(p(new THREE.ConeGeometry(0.15, 0.3, 10, 1, true).rotateZ(Math.PI / 2).translate(-0.45, 2.9, 0.26), '#f2a65a'));
  for (let i = 0; i < 3; i++) out.push(p(new THREE.BoxGeometry(0.16, 0.06, 0.03).translate(-0.05 + i * 0.26, 2.9, 0.25), '#7a5a44'));
  // 앞 화단
  for (const sx of [-1, 1]) out.push(blob(0.32, sx * 1.25, 0.24, 0.55, 0.75, '#5fae62', '#a3dc78'));
  out.push(p(new THREE.SphereGeometry(0.09, 6, 5).translate(-1.15, 0.5, 0.75), '#ff9ec2'));
  out.push(p(new THREE.SphereGeometry(0.09, 6, 5).translate(1.3, 0.5, 0.72), '#ffd166'));
  return out;
}

/** 장터 가판대 (2026-11-15): 0 잡화점(주황 차양, 상자), 1 오락실(보라 차양, 오락기). 원점이 가운데, 앞이 +z */
export function stall(kind: number): Pieces {
  const out: Pieces = [];
  const W = 2.5;
  const D = 1.3;
  const awn = kind === 0 ? '#ff9a5c' : '#9f8cf0';
  // 바닥판, 계산대
  out.push(p(new RoundedBoxGeometry(W + 0.2, 0.12, D + 0.3, 1, 0.04).translate(0, 0.06, 0), '#d6cbbb'));
  out.push(p(new RoundedBoxGeometry(W, 0.85, 0.55, 1, 0.06).translate(0, 0.5, D / 2 - 0.25), '#cb9a69'));
  out.push(p(new RoundedBoxGeometry(W + 0.1, 0.08, 0.65, 1, 0.03).translate(0, 0.96, D / 2 - 0.25), '#f1dcc0'));
  out.push(p(new THREE.BoxGeometry(W - 0.3, 0.3, 0.04).translate(0, 0.55, D / 2 + 0.03), awn, 0, 0.9));
  // 기둥 넷
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(p(new THREE.CylinderGeometry(0.06, 0.07, 2.1, 6).translate(sx * (W / 2 - 0.05), 1.05, sz * (D / 2 - 0.05)), '#9c6f4b'));
  // 뒤 선반
  out.push(p(new RoundedBoxGeometry(W - 0.2, 1.2, 0.3, 1, 0.04).translate(0, 0.72, -D / 2 + 0.15), '#b8875c'));
  // 줄무늬 차양
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.BoxGeometry(W / 7 + 0.04, 0.06, D + 0.5);
    seg.rotateX(0.22);
    seg.translate(-W / 2 + (i + 0.5) * (W / 7), 2.2, 0.08);
    out.push(p(seg, i % 2 ? '#ffffff' : awn));
  }
  for (let i = 0; i < 7; i++) out.push(p(new THREE.SphereGeometry(0.12, 6, 4).scale(1, 0.6, 1).translate(-W / 2 + (i + 0.5) * (W / 7), 2.02, D / 2 + 0.36), i % 2 ? '#ffffff' : awn));
  // 간판
  out.push(p(new RoundedBoxGeometry(1.2, 0.36, 0.08, 1, 0.06).translate(0, 2.55, D / 2 + 0.2), '#fffdf6'));
  if (kind === 0) {
    // 물건: 생선, 과일 바구니, 상자
    out.push(p(new THREE.SphereGeometry(0.16, 8, 6).scale(1.4, 0.55, 0.6).translate(-0.7, 1.06, D / 2 - 0.25), '#5f8fa8'));
    out.push(p(new THREE.CylinderGeometry(0.24, 0.18, 0.16, 10).translate(0.05, 1.08, D / 2 - 0.25), '#b8875c'));
    for (let i = 0; i < 4; i++) out.push(p(new THREE.SphereGeometry(0.09, 6, 5).translate(-0.08 + (i % 2) * 0.16, 1.2 + Math.floor(i / 2) * 0.06, D / 2 - 0.3 + (i % 2) * 0.06), i % 2 ? '#ff6b5b' : '#ffcf3f'));
    out.push(p(new RoundedBoxGeometry(0.4, 0.3, 0.3, 1, 0.04).translate(0.72, 1.15, D / 2 - 0.25), '#e9cfa3'));
    out.push(p(new RoundedBoxGeometry(0.42, 0.28, 0.06, 1, 0.04).translate(-0.3, 2.55, D / 2 + 0.26), '#ff8f7a'));
    for (let i = 0; i < 3; i++) out.push(p(new THREE.SphereGeometry(0.11, 7, 5).translate(-0.8 + i * 0.8, 1.55, -D / 2 + 0.28), ['#ffcf3f', '#7ac36a', '#ff9ec2'][i]));
  } else {
    // 작은 오락기 두 대
    for (const sx of [-0.65, 0.65]) {
      out.push(p(new RoundedBoxGeometry(0.62, 0.7, 0.4, 1, 0.06).translate(sx, 1.33, D / 2 - 0.3), '#4a4060'));
      out.push(p(new THREE.BoxGeometry(0.44, 0.32, 0.02).translate(sx, 1.42, D / 2 - 0.09), '#8fe3ff', 1));
      out.push(p(new THREE.SphereGeometry(0.05, 6, 5).translate(sx - 0.1, 1.12, D / 2 - 0.08), '#ff6b5b'));
      out.push(p(new THREE.SphereGeometry(0.05, 6, 5).translate(sx + 0.1, 1.12, D / 2 - 0.08), '#ffcf3f'));
    }
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.07 : 0.15;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    out.push(p(new THREE.ShapeGeometry(s).translate(-0.3, 2.55, D / 2 + 0.25), '#ffcf3f'));
  }
  for (let i = 0; i < 3; i++) out.push(p(new THREE.BoxGeometry(0.12, 0.05, 0.03).translate(0.05 + i * 0.2, 2.55, D / 2 + 0.25), '#7a5a44'));
  return out;
}
