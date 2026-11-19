import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { YardItemType } from '../../shared/types';
import { GLOW_ATTRS } from '../core/glowLambert';
import { buildItemGeometry } from '../items/itemGeometry';
import { fillAttr, mergeParts, paint } from '../util/geo';

/**
 * 자유 배치 아이템 목록.
 *
 * 아이템을 늘리려면 아래 FREE_ITEMS 에 "이름: { 화면 이름, 크기, 모양 }" 한 덩어리만 더하면 된다.
 * 그리기, 끌어 놓기, 겹침 검사, 걷기 충돌은 여기 적힌 값만 보고 알아서 동작한다.
 *
 * 모양의 원점은 바닥 한가운데, 앞은 +z.
 * 벽에 거는 것(mount: 'wall')은 원점이 벽면의 바닥이고 +z 쪽으로 튀어나온다.
 */
export interface ItemDef {
  /** 화면에 쓰는 한국어 이름 */
  label: string;
  /** floor: 바닥에 놓는 가구 / rug: 바닥에 까는 것(가구가 위에 올라올 수 있다) / wall: 벽에 거는 것(집 안에서만) */
  mount: 'floor' | 'rug' | 'wall';
  /** 차지하는 자리의 절반 크기 (겹침 검사와 누르기에 쓴다) */
  hx: number;
  hz: number;
  /** 바닥에서 아랫변까지의 높이 (벽에 거는 것만) */
  y0?: number;
  height: number;
  /** 걸어서 못 지나가는 곳: [x, z, 반지름] 원 여러 개. 없으면 지나갈 수 있다 */
  block?: ReadonlyArray<readonly [number, number, number]>;
  /** 직접 그린 그림이 붙는 자리 (정사각형). flat 이면 바닥에 눕힌다 */
  art?: { size: number; x: number; y: number; z: number; flat?: boolean };
  build: () => THREE.BufferGeometry;
}

type Pieces = THREE.BufferGeometry[];

function p(geo: THREE.BufferGeometry, color: string, glow = 0, shade = 1) {
  paint(geo, color, shade);
  fillAttr(geo, 'aMask', [0, glow]);
  return geo;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, r = 0.03) =>
  p(new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)).translate(x, y, z), color);
const merge = (parts: Pieces) => mergeParts(parts, GLOW_ATTRS);
/** 기존 마당 아이템 8종의 모양을 그대로 쓴다 */
const yard = (type: YardItemType) => () => buildItemGeometry(type);

const WOOD = '#c99766';
const WOOD_DARK = '#a2734c';
const CREAM = '#fbefdc';
const WHITE = '#fffdf6';

function bed(): Pieces {
  return [
    box(1.14, 0.28, 2.04, 0, 0.2, 0, WOOD, 0.05),
    box(1.04, 0.2, 1.92, 0, 0.42, 0.02, CREAM, 0.07),
    box(1.08, 0.15, 1.16, 0, 0.5, 0.4, '#9fdcc0', 0.06),
    box(1.08, 0.16, 0.2, 0, 0.5, -0.24, WHITE, 0.06),
    box(0.62, 0.14, 0.36, 0, 0.57, -0.66, '#ffffff', 0.06),
    box(1.14, 0.78, 0.1, 0, 0.55, -1.0, WOOD_DARK, 0.04),
  ];
}

function bookshelf(): Pieces {
  const o: Pieces = [box(1.2, 1.8, 0.04, 0, 0.9, -0.16, WOOD_DARK, 0.01)];
  for (const sx of [-1, 1]) o.push(box(0.06, 1.8, 0.36, sx * 0.57, 0.9, 0, WOOD, 0.02));
  const shelves = [0.03, 0.47, 0.91, 1.35, 1.77];
  for (const y of shelves) o.push(box(1.14, 0.05, 0.34, 0, y, 0, WOOD, 0.02));
  const colors = ['#ff8f7a', '#ffd166', '#7fd8b0', '#8fd3e8', '#b79cf0', '#ff9ec2', '#f6a55c', '#fff6ea'];
  let n = 0;
  for (let row = 0; row < 4; row++) {
    let x = -0.5;
    while (x < 0.4) {
      const w = 0.07 + ((n * 37) % 5) * 0.015;
      const h = 0.26 + ((n * 53) % 4) * 0.03;
      // 가끔 빈 칸을 둬서 빽빽해 보이지 않게 한다
      if ((n * 7) % 6 !== 0) o.push(box(w, h, 0.22, x + w / 2, shelves[row] + 0.03 + h / 2, 0.02, colors[(n * 3 + row) % colors.length], 0.012));
      x += w + 0.012;
      n++;
    }
  }
  return o;
}

function table(): Pieces {
  const o: Pieces = [box(1.2, 0.07, 0.8, 0, 0.6, 0, WOOD, 0.03)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.push(p(new THREE.CylinderGeometry(0.045, 0.038, 0.57, 8).translate(sx * 0.5, 0.285, sz * 0.3), WOOD_DARK));
  // 찻잔과 받침
  o.push(p(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 12).translate(0.22, 0.643, 0.05), WHITE));
  o.push(p(new THREE.CylinderGeometry(0.065, 0.045, 0.08, 12).translate(0.22, 0.69, 0.05), '#ffb3c1'));
  return o;
}

function chair(): Pieces {
  const o: Pieces = [box(0.44, 0.06, 0.44, 0, 0.4, 0, WOOD), box(0.38, 0.05, 0.38, 0, 0.45, 0.01, '#ffb3c1', 0.02), box(0.44, 0.5, 0.05, 0, 0.74, -0.2, WOOD)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.push(p(new THREE.CylinderGeometry(0.03, 0.026, 0.38, 6).translate(sx * 0.18, 0.19, sz * 0.18), WOOD_DARK));
  return o;
}

function sofa(): Pieces {
  const body = '#f2b5a0';
  const o: Pieces = [box(1.7, 0.34, 0.8, 0, 0.25, 0, body, 0.1), box(1.7, 0.6, 0.22, 0, 0.62, -0.29, body, 0.1)];
  for (const sx of [-1, 1]) {
    o.push(box(0.2, 0.5, 0.8, sx * 0.75, 0.42, 0, body, 0.09));
    o.push(box(0.62, 0.13, 0.5, sx * 0.325, 0.46, 0.08, '#fbd3c4', 0.06));
  }
  return o;
}

function floorLamp(): Pieces {
  return [
    p(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 14).translate(0, 0.025, 0), WOOD_DARK),
    p(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6).translate(0, 0.75, 0), '#cfc3b2'),
    p(new THREE.CylinderGeometry(0.15, 0.28, 0.34, 14).translate(0, 1.52, 0), '#fff1c2', 1),
  ];
}

function rug(): Pieces {
  return [box(1.6, 0.03, 1.6, 0, 0.015, 0, '#f6c6a8', 0.012), box(1.3, 0.034, 1.3, 0, 0.017, 0, '#fff6ea', 0.012), box(0.8, 0.038, 0.8, 0, 0.019, 0, '#f6c6a8', 0.012)];
}

function frame(): Pieces {
  return [box(0.86, 0.86, 0.06, 0, 1.75, 0.03, WOOD, 0.02), box(0.7, 0.7, 0.02, 0, 1.75, 0.056, CREAM, 0.005)];
}

function windowItem(): Pieces {
  return [
    box(1.2, 1.0, 0.08, 0, 1.8, 0.03, WHITE, 0.03),
    box(1.04, 0.84, 0.03, 0, 1.8, 0.062, '#a6dbef', 0.005),
    box(0.05, 0.84, 0.05, 0, 1.8, 0.07, WHITE, 0.01),
    box(1.04, 0.05, 0.05, 0, 1.8, 0.07, WHITE, 0.01),
    box(1.3, 0.06, 0.16, 0, 1.27, 0.08, WHITE, 0.02),
  ];
}

function gift(): Pieces {
  return [box(0.5, 0.42, 0.5, 0, 0.21, 0, '#ffb3c1', 0.04), box(0.52, 0.43, 0.1, 0, 0.215, 0, WHITE, 0.02), box(0.1, 0.43, 0.52, 0, 0.215, 0, WHITE, 0.02), p(new THREE.SphereGeometry(0.08, 8, 6).translate(0, 0.47, 0), '#ff8fa3')];
}

/** 그림 캔버스 (2026-11-16): 세 발 이젤 위에 세운 하얀 도화지. 그림은 도화지 앞면에 붙는다 */
function easel(): Pieces {
  const o: Pieces = [];
  const leg = (x: number, z: number, rx: number, rz: number) =>
    o.push(p(new THREE.CylinderGeometry(0.03, 0.035, 1.78, 6).rotateX(rx).rotateZ(rz).translate(x, 0.87, z), WOOD));
  leg(-0.34, 0.02, -0.09, -0.17);
  leg(0.34, 0.02, -0.09, 0.17);
  leg(0, -0.36, 0.38, 0);
  // 도화지 받침대와 도화지 (흰 테두리)
  o.push(box(0.98, 0.06, 0.16, 0, 0.6, 0.1, WOOD_DARK, 0.02));
  o.push(box(0.94, 0.94, 0.05, 0, 1.1, 0.06, WHITE, 0.02));
  o.push(box(0.2, 0.06, 0.08, 0, 1.6, 0.05, WOOD, 0.02));
  // 받침대 위 작은 물감 통
  o.push(p(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 8).translate(0.36, 0.67, 0.12), '#ff8f7a'));
  o.push(p(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 8).translate(0.24, 0.67, 0.14), '#7cc4f2'));
  return o;
}

/** 눈사람 (2026-11-16 겨울 한정, 마당에만): 눈덩이 둘, 목도리, 털모자, 당근 코, 나뭇가지 팔 */
function snowman(): Pieces {
  const o: Pieces = [];
  const SNOW = '#f7fbff';
  o.push(p(new THREE.SphereGeometry(0.42, 16, 12).scale(1, 0.92, 1).translate(0, 0.38, 0), SNOW));
  o.push(p(new THREE.SphereGeometry(0.3, 16, 12).translate(0, 0.98, 0), SNOW));
  // 목도리 (빨강) + 늘어진 끝
  o.push(p(new THREE.TorusGeometry(0.24, 0.07, 8, 18).rotateX(Math.PI / 2).translate(0, 0.76, 0), '#e8413f'));
  o.push(box(0.11, 0.3, 0.05, 0.14, 0.6, 0.2, '#e8413f', 0.02));
  // 털모자 + 방울
  o.push(p(new THREE.CylinderGeometry(0.2, 0.25, 0.16, 14).translate(0, 1.22, 0), '#3e8f5c'));
  o.push(p(new THREE.ConeGeometry(0.2, 0.28, 14).translate(0, 1.43, 0), '#3e8f5c'));
  o.push(p(new THREE.TorusGeometry(0.235, 0.045, 6, 18).rotateX(Math.PI / 2).translate(0, 1.15, 0), WHITE));
  o.push(p(new THREE.SphereGeometry(0.065, 8, 6).translate(0, 1.59, 0), WHITE));
  // 눈, 당근 코, 단추
  for (const sx of [-1, 1]) o.push(p(new THREE.SphereGeometry(0.035, 6, 5).translate(sx * 0.1, 1.04, 0.26), '#2f2a2e'));
  o.push(p(new THREE.ConeGeometry(0.045, 0.22, 8).rotateX(Math.PI / 2).translate(0, 0.97, 0.38), '#ff9b3d'));
  for (const y of [0.32, 0.48]) o.push(p(new THREE.SphereGeometry(0.04, 6, 5).translate(0, y, 0.39), '#2f2a2e'));
  // 나뭇가지 팔
  for (const sx of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.022, 0.03, 0.5, 5).rotateZ(sx * 1.05).translate(sx * 0.48, 0.92, 0);
    o.push(p(arm, '#7c5235'));
  }
  return o;
}


// ───────────── 2026-11-19 새 가구 (아늑한 시골 집 느낌) ─────────────
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, color: string, seg = 12, glow = 0) =>
  p(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), color, glow);
/** 돌린 다음 옮기는 원기둥 (rx, rz: X/Z 축으로 돌릴 각도) */
const cylR = (rt: number, rb: number, h: number, rx: number, rz: number, x: number, y: number, z: number, color: string, seg = 12, glow = 0) =>
  p(new THREE.CylinderGeometry(rt, rb, h, seg).rotateX(rx).rotateZ(rz).translate(x, y, z), color, glow);
const ball = (r: number, x: number, y: number, z: number, color: string, glow = 0) => p(new THREE.SphereGeometry(r, 10, 8).translate(x, y, z), color, glow);

function tv(): Pieces {
  const o: Pieces = [box(0.9, 0.42, 0.5, 0, 0.21, 0, WOOD, 0.04)];
  o.push(box(0.84, 0.62, 0.52, 0, 0.74, 0, '#e9dfcf', 0.08));
  o.push(box(0.6, 0.44, 0.02, -0.06, 0.75, 0.26, '#7ec8d8', 0.04));
  o.push(p(new RoundedBoxGeometry(0.6, 0.44, 0.02, 1, 0.04).translate(-0.06, 0.75, 0.265), '#9fe0ea', 0.7));
  for (const y of [0.88, 0.72]) o.push(cylR(0.035, 0.035, 0.03, Math.PI / 2, 0, 0.31, y, 0.27, '#5b4636', 10));
  for (const sx of [-1, 1]) o.push(cylR(0.008, 0.008, 0.4, 0, -sx * 0.4, sx * 0.2, 1.22, -0.05, '#8a8a8a', 5));
  return o;
}
function fireplace(): Pieces {
  const brick = '#c87a5a';
  const o: Pieces = [box(1.3, 1.1, 0.5, 0, 0.55, -0.02, brick, 0.04), box(1.42, 0.1, 0.6, 0, 1.12, 0, WOOD_DARK, 0.03)];
  o.push(box(0.72, 0.6, 0.06, 0, 0.36, 0.22, '#3a2b25', 0.03));
  // 장작과 불
  for (const sx of [-1, 1]) o.push(cylR(0.06, 0.06, 0.5, 0, Math.PI / 2 + sx * 0.3, sx * 0.04, 0.13, 0.17, '#8a5a3c', 8));
  o.push(p(new THREE.ConeGeometry(0.15, 0.36, 8).translate(0, 0.32, 0.18), '#ff9a3d', 1));
  o.push(p(new THREE.ConeGeometry(0.08, 0.24, 8).translate(0.06, 0.28, 0.2), '#ffe066', 1));
  // 선반 위 작은 소품
  o.push(ball(0.07, -0.45, 1.24, 0.05, '#ff9ec2'));
  o.push(box(0.16, 0.2, 0.06, 0.42, 1.27, 0.05, '#fffaf0', 0.02));
  return o;
}
function piano(): Pieces {
  const body = '#3b3236';
  const o: Pieces = [box(1.4, 1.15, 0.55, 0, 0.62, -0.1, body, 0.05)];
  o.push(box(1.4, 0.08, 0.36, 0, 0.75, 0.32, body, 0.03));
  o.push(box(1.3, 0.04, 0.26, 0, 0.8, 0.34, WHITE, 0.01));
  for (let i = 0; i < 9; i++) if (i % 3 !== 2) o.push(box(0.05, 0.03, 0.14, -0.55 + i * 0.14, 0.83, 0.3, '#2a2226', 0.008));
  for (const sx of [-1, 1]) o.push(box(0.08, 0.72, 0.08, sx * 0.62, 0.36, 0.42, body, 0.02));
  o.push(box(0.5, 0.36, 0.03, 0, 1.0, 0.185, '#fff6ea', 0.01));
  return o;
}
function kitchen(): Pieces {
  const o: Pieces = [box(1.5, 0.86, 0.6, 0, 0.43, 0, '#f4ead8', 0.03), box(1.56, 0.06, 0.66, 0, 0.89, 0, '#cbb59a', 0.02)];
  for (const sx of [-0.38, 0.38]) {
    o.push(box(0.66, 0.62, 0.02, sx, 0.42, 0.305, '#9fdcc0', 0.02));
    o.push(box(0.16, 0.03, 0.03, sx, 0.66, 0.32, '#c9b9a5', 0.01));
  }
  // 화구 둘과 냄비
  for (const sx of [0.28, 0.58]) o.push(cyl(0.11, 0.11, 0.02, sx, 0.93, 0.02, '#3a3236', 14));
  o.push(cyl(0.14, 0.12, 0.18, 0.28, 1.03, 0.02, '#ff8f7a', 14));
  o.push(cyl(0.15, 0.15, 0.02, 0.28, 1.13, 0.02, '#ff8f7a', 14));
  // 개수대
  o.push(box(0.46, 0.04, 0.36, -0.42, 0.915, 0.02, '#c9d6dc', 0.02));
  o.push(cyl(0.015, 0.015, 0.22, -0.42, 1.02, -0.18, '#c9d6dc', 6));
  return o;
}
function fridge(): Pieces {
  const c = '#bfe3e8';
  const o: Pieces = [box(0.7, 1.75, 0.62, 0, 0.88, 0, c, 0.08), box(0.66, 0.02, 0.02, 0, 1.18, 0.31, '#9cc7cc', 0.005)];
  for (const y of [1.45, 0.8]) o.push(box(0.04, 0.26, 0.04, -0.26, y, 0.33, '#fffaf0', 0.015));
  // 자석 메모
  o.push(box(0.14, 0.18, 0.01, 0.12, 1.5, 0.315, '#fff6a8', 0.003));
  o.push(ball(0.025, 0.12, 1.58, 0.32, '#ff6f61'));
  return o;
}
function wardrobe(): Pieces {
  const o: Pieces = [box(1.1, 1.9, 0.56, 0, 0.97, 0, WOOD, 0.04), box(1.18, 0.08, 0.62, 0, 1.94, 0, WOOD_DARK, 0.03)];
  for (const sx of [-1, 1]) {
    o.push(box(0.5, 1.6, 0.02, sx * 0.265, 1.02, 0.28, '#d8a878', 0.02));
    o.push(ball(0.03, sx * 0.05, 1.05, 0.31, '#f4c95d'));
  }
  for (const sx of [-1, 1]) o.push(box(0.1, 0.12, 0.1, sx * 0.45, 0.06, 0.18, WOOD_DARK, 0.02));
  return o;
}
function desk(): Pieces {
  const o: Pieces = [box(1.2, 0.06, 0.6, 0, 0.74, 0, WOOD, 0.02), box(0.42, 0.7, 0.56, 0.36, 0.38, 0, WOOD, 0.02)];
  for (const y of [0.55, 0.25]) o.push(box(0.36, 0.22, 0.02, 0.36, y, 0.285, '#d8a878', 0.02));
  for (const sz of [-1, 1]) o.push(box(0.05, 0.72, 0.05, -0.55, 0.36, sz * 0.25, WOOD_DARK, 0.01));
  // 스탠드와 공책
  o.push(cyl(0.08, 0.1, 0.03, -0.35, 0.79, -0.15, '#5b4636', 10));
  o.push(cyl(0.012, 0.012, 0.32, -0.35, 0.95, -0.15, '#5b4636', 5));
  o.push(p(new THREE.ConeGeometry(0.12, 0.13, 10, 1, true).translate(-0.3, 1.12, -0.12), '#ffe39a', 1));
  o.push(box(0.3, 0.02, 0.22, 0.05, 0.78, 0.05, '#fffaf0', 0.004));
  return o;
}
function grandClock(): Pieces {
  const o: Pieces = [box(0.5, 1.9, 0.34, 0, 0.95, 0, WOOD_DARK, 0.04), box(0.58, 0.1, 0.4, 0, 1.92, 0, WOOD, 0.03)];
  o.push(cylR(0.17, 0.17, 0.03, Math.PI / 2, 0, 0, 1.55, 0.17, CREAM, 18));
  o.push(box(0.012, 0.12, 0.012, 0, 1.6, 0.19, '#3a2b25', 0.004));
  o.push(box(0.09, 0.012, 0.012, 0.04, 1.55, 0.19, '#3a2b25', 0.004));
  o.push(box(0.3, 0.8, 0.02, 0, 0.75, 0.17, '#e9d8b8', 0.02));
  o.push(cyl(0.008, 0.008, 0.5, 0, 0.88, 0.18, '#f4c95d', 5));
  o.push(cylR(0.08, 0.08, 0.02, Math.PI / 2, 0, 0, 0.6, 0.185, '#f4c95d', 14));
  return o;
}
function aquarium(): Pieces {
  const o: Pieces = [box(1.0, 0.62, 0.46, 0, 0.31, 0, WOOD_DARK, 0.03)];
  o.push(p(new RoundedBoxGeometry(0.94, 0.52, 0.4, 1, 0.03).translate(0, 0.9, 0), '#8fdcf0', 0.35));
  o.push(box(0.98, 0.05, 0.44, 0, 1.18, 0, '#5b4636', 0.02));
  o.push(box(0.9, 0.06, 0.36, 0, 0.67, 0, '#f3e2b2', 0.02));
  for (const [x, h] of [[-0.3, 0.3], [-0.22, 0.22], [0.32, 0.26]] as const) o.push(p(new THREE.ConeGeometry(0.04, h, 6).translate(x, 0.7 + h / 2, 0.19), '#6fc275'));
  o.push(p(new THREE.SphereGeometry(0.05, 8, 6).scale(1.6, 1, 0.6).translate(0.05, 0.92, 0.215), '#ff8f3d'));
  o.push(p(new THREE.SphereGeometry(0.04, 8, 6).scale(1.6, 1, 0.6).translate(-0.18, 1.0, 0.215), '#ffd166'));
  return o;
}
function recordPlayer(): Pieces {
  const o: Pieces = [box(0.6, 0.6, 0.46, 0, 0.3, 0, WOOD, 0.03), box(0.52, 0.12, 0.42, 0, 0.66, 0, WOOD_DARK, 0.02)];
  o.push(cyl(0.17, 0.17, 0.015, -0.04, 0.73, 0.02, '#2a2226', 18));
  o.push(cyl(0.05, 0.05, 0.018, -0.04, 0.735, 0.02, '#ff8f7a', 12));
  // 나팔
  o.push(cyl(0.02, 0.02, 0.36, 0.18, 0.88, -0.12, '#c9a24a', 6));
  o.push(p(new THREE.ConeGeometry(0.22, 0.34, 14, 1, true).rotateX(-Math.PI / 2.4).translate(0.18, 1.16, 0.0), '#f4c95d'));
  return o;
}
function kotatsu(): Pieces {
  const quilt = '#e58f8a';
  const o: Pieces = [box(1.1, 0.34, 1.1, 0, 0.18, 0, quilt, 0.12), box(1.0, 0.05, 1.0, 0, 0.38, 0, WOOD, 0.02)];
  o.push(box(0.96, 0.02, 0.96, 0, 0.36, 0, '#f6d8b8', 0.01));
  // 귤 바구니
  o.push(cyl(0.14, 0.1, 0.07, 0, 0.44, 0, '#d7a878', 12));
  for (const [x, z] of [[-0.05, -0.03], [0.05, 0.03], [0.0, 0.06], [0.04, -0.06]] as const) o.push(ball(0.05, x, 0.5, z, '#ff9b3d'));
  return o;
}
function wallClock(): Pieces {
  const o: Pieces = [cylR(0.26, 0.26, 0.06, Math.PI / 2, 0, 0, 1.75, 0.03, WOOD, 20)];
  o.push(cylR(0.21, 0.21, 0.02, Math.PI / 2, 0, 0, 1.75, 0.065, CREAM, 20));
  o.push(box(0.016, 0.15, 0.01, 0, 1.81, 0.08, '#3a2b25', 0.004));
  o.push(box(0.11, 0.016, 0.01, 0.05, 1.75, 0.08, '#3a2b25', 0.004));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    o.push(box(0.02, 0.02, 0.01, Math.sin(a) * 0.17, 1.75 + Math.cos(a) * 0.17, 0.078, '#a2734c', 0.004));
  }
  return o;
}
function wallShelf(): Pieces {
  const o: Pieces = [box(1.0, 0.05, 0.26, 0, 1.6, 0.13, WOOD, 0.02)];
  for (const sx of [-1, 1]) o.push(box(0.04, 0.16, 0.2, sx * 0.4, 1.52, 0.1, WOOD_DARK, 0.01));
  o.push(cyl(0.07, 0.06, 0.14, -0.3, 1.695, 0.13, '#8fd3e8', 10));
  o.push(ball(0.08, -0.3, 1.82, 0.13, '#7cc46a'));
  o.push(box(0.2, 0.22, 0.04, 0.02, 1.735, 0.13, '#ffd166', 0.01));
  o.push(ball(0.07, 0.3, 1.695, 0.13, '#ff9ec2'));
  return o;
}
function flowerBed(): Pieces {
  const o: Pieces = [box(1.2, 0.16, 0.7, 0, 0.08, 0, WOOD_DARK, 0.03), box(1.1, 0.06, 0.6, 0, 0.17, 0, '#8a6a4c', 0.02)];
  const cols = ['#ff8fa3', '#ffd166', '#b79cf0', '#fffaf0', '#ff6f61', '#8fd3e8'];
  let n = 0;
  for (let ix = 0; ix < 5; ix++)
    for (let iz = 0; iz < 2; iz++) {
      const x = -0.44 + ix * 0.22 + (iz ? 0.06 : 0);
      const z = -0.13 + iz * 0.26;
      o.push(cyl(0.012, 0.012, 0.24, x, 0.32, z, '#6fc275', 5));
      o.push(ball(0.065, x, 0.46, z, cols[n++ % cols.length]));
      o.push(ball(0.025, x, 0.48, z + 0.05, '#ffe08a'));
    }
  return o;
}
function campfire(): Pieces {
  const o: Pieces = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    o.push(ball(0.11, Math.sin(a) * 0.4, 0.07, Math.cos(a) * 0.4, '#a8a29a'));
  }
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 7).rotateZ(Math.PI / 2 - 0.35).rotateY((i / 4) * Math.PI * 2).translate(0, 0.16, 0);
    o.push(p(g, '#8a5a3c'));
  }
  o.push(p(new THREE.ConeGeometry(0.2, 0.55, 8).translate(0, 0.42, 0), '#ff8a3d', 1));
  o.push(p(new THREE.ConeGeometry(0.11, 0.4, 8).translate(0.04, 0.4, 0.04), '#ffe066', 1));
  return o;
}
function swing(): Pieces {
  const o: Pieces = [];
  for (const sx of [-1, 1]) {
    // 양쪽 A 자 기둥
    for (const sz of [-1, 1]) o.push(cylR(0.045, 0.05, 1.95, -sz * 0.17, 0, sx * 0.62, 0.95, sz * 0.16, WOOD_DARK, 7));
  }
  // 위 가로대
  o.push(cylR(0.05, 0.05, 1.36, 0, Math.PI / 2, 0, 1.88, 0, WOOD, 8));
  for (const sx of [-1, 1]) o.push(cyl(0.012, 0.012, 1.3, sx * 0.24, 1.2, 0, '#e9dfcf', 5));
  o.push(box(0.6, 0.05, 0.26, 0, 0.54, 0, '#ff9ec2', 0.02));
  return o;
}
function parasol(): Pieces {
  const o: Pieces = [cyl(0.42, 0.42, 0.05, 0, 0.7, 0, WHITE, 18), cyl(0.04, 0.06, 0.68, 0, 0.34, 0, WHITE, 8)];
  o.push(cyl(0.02, 0.02, 1.6, 0, 1.4, 0, '#cfc3b2', 6));
  for (let i = 0; i < 8; i++) {
    const g = new THREE.ConeGeometry(0.95, 0.38, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4).translate(0, 2.1, 0);
    o.push(p(g, i % 2 ? '#ff8f7a' : '#fffaf0'));
  }
  o.push(ball(0.04, 0, 2.3, 0, '#ff8f7a'));
  o.push(cyl(0.05, 0.04, 0.12, 0.2, 0.78, 0.1, '#ffd166', 10));
  return o;
}
function xmasTree(): Pieces {
  const o: Pieces = [cyl(0.16, 0.2, 0.26, 0, 0.13, 0, '#c87a5a', 10), cyl(0.05, 0.05, 0.2, 0, 0.32, 0, '#8a5a3c', 6)];
  const layers: Array<[number, number, number]> = [[0.62, 0.62, 0.62], [0.5, 0.55, 0.98], [0.36, 0.48, 1.3]];
  for (const [r, h, y] of layers) o.push(p(new THREE.ConeGeometry(r, h, 10).translate(0, y, 0), '#3f9a5c'));
  const cols = ['#ff6f61', '#ffd166', '#8fd3e8', '#ff9ec2'];
  let n = 0;
  for (const [r, , y] of layers)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + y;
      o.push(ball(0.045, Math.sin(a) * r * 0.62, y - 0.12, Math.cos(a) * r * 0.62, cols[n++ % cols.length], 1));
    }
  o.push(p(new THREE.OctahedronGeometry(0.11).translate(0, 1.62, 0), '#ffd84a', 1));
  return o;
}
function arcadeMachine(): Pieces {
  const c = '#7c8cf0';
  const o: Pieces = [box(0.7, 1.7, 0.66, 0, 0.85, -0.04, c, 0.04)];
  o.push(p(new RoundedBoxGeometry(0.54, 0.42, 0.02, 1, 0.02).rotateX(-0.2).translate(0, 1.25, 0.3), '#2a2236'));
  o.push(p(new RoundedBoxGeometry(0.48, 0.36, 0.02, 1, 0.02).rotateX(-0.2).translate(0, 1.25, 0.315), '#8fe3ff', 0.8));
  o.push(box(0.7, 0.1, 0.34, 0, 0.92, 0.33, '#5a68c8', 0.02));
  o.push(cyl(0.012, 0.012, 0.1, -0.15, 1.01, 0.36, '#3a3236', 5));
  o.push(ball(0.035, -0.15, 1.07, 0.36, '#ff6f61'));
  for (const sx of [0.08, 0.2]) o.push(cyl(0.03, 0.03, 0.02, sx, 0.98, 0.36, '#ffd166', 10, 0.6));
  o.push(box(0.6, 0.16, 0.04, 0, 1.6, 0.27, '#ffd166', 0.02));
  return o;
}
function bathtub(): Pieces {
  const o: Pieces = [p(new RoundedBoxGeometry(1.5, 0.56, 0.8, 2, 0.2).translate(0, 0.38, 0), WHITE)];
  o.push(p(new RoundedBoxGeometry(1.32, 0.04, 0.62, 1, 0.015).translate(0, 0.6, 0), '#a6e0ef'));
  for (const [x, y, z] of [[-0.2, 0.66, 0.05], [0.1, 0.68, -0.1], [0.3, 0.66, 0.12], [-0.4, 0.67, -0.12]] as const) o.push(ball(0.08, x, y, z, '#ffffff'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.push(ball(0.06, sx * 0.6, 0.06, sz * 0.28, '#f4c95d'));
  o.push(p(new THREE.SphereGeometry(0.07, 8, 6).scale(1.3, 1, 1).translate(0.45, 0.67, 0.05), '#ffd84a'));
  return o;
}

export const FREE_ITEMS: Record<string, ItemDef> = {
  // ── 기존 마당 아이템 8종 (마당과 집 안 어디든) ──
  cat_tower: { label: '캣타워', mount: 'floor', hx: 0.45, hz: 0.45, height: 1.7, block: [[0, 0, 0.42]], build: yard('cat_tower') },
  hammock: { label: '해먹', mount: 'floor', hx: 0.68, hz: 0.32, height: 0.9, block: [[-0.3, 0, 0.3], [0.3, 0, 0.3]], build: yard('hammock') },
  plant: { label: '화분', mount: 'floor', hx: 0.3, hz: 0.3, height: 1.05, build: yard('plant') },
  sign: { label: '간판', mount: 'floor', hx: 0.4, hz: 0.12, height: 1.2, art: { size: 0.34, x: 0, y: 0.9, z: 0.083 }, build: yard('sign') },
  fish_rack: { label: '생선 건조대', mount: 'floor', hx: 0.5, hz: 0.22, height: 1.15, block: [[-0.24, 0, 0.24], [0.24, 0, 0.24]], build: yard('fish_rack') },
  cushion: { label: '방석', mount: 'floor', hx: 0.44, hz: 0.44, height: 0.3, build: yard('cushion') },
  lantern: { label: '등불', mount: 'floor', hx: 0.22, hz: 0.22, height: 1.1, build: yard('lantern') },
  bench: { label: '벤치', mount: 'floor', hx: 0.5, hz: 0.22, height: 0.85, block: [[-0.24, 0, 0.26], [0.24, 0, 0.26]], build: yard('bench') },
  // ── 새 아이템 ──
  bed: { label: '침대', mount: 'floor', hx: 0.58, hz: 1.05, height: 0.95, block: [[0, -0.5, 0.56], [0, 0.5, 0.56]], build: () => merge(bed()) },
  bookshelf: { label: '책장', mount: 'floor', hx: 0.62, hz: 0.2, height: 1.8, block: [[-0.36, 0, 0.24], [0, 0, 0.24], [0.36, 0, 0.24]], build: () => merge(bookshelf()) },
  table: { label: '탁자', mount: 'floor', hx: 0.62, hz: 0.42, height: 0.74, block: [[-0.22, 0, 0.4], [0.22, 0, 0.4]], build: () => merge(table()) },
  chair: { label: '의자', mount: 'floor', hx: 0.25, hz: 0.25, height: 1.0, block: [[0, 0, 0.24]], build: () => merge(chair()) },
  sofa: { label: '소파', mount: 'floor', hx: 0.87, hz: 0.42, height: 0.95, block: [[-0.46, 0, 0.4], [0, 0, 0.4], [0.46, 0, 0.4]], build: () => merge(sofa()) },
  floor_lamp: { label: '스탠드 조명', mount: 'floor', hx: 0.24, hz: 0.24, height: 1.7, block: [[0, 0, 0.16]], build: () => merge(floorLamp()) },
  rug: { label: '러그', mount: 'rug', hx: 0.8, hz: 0.8, height: 0.05, art: { size: 1.3, x: 0, y: 0.04, z: 0, flat: true }, build: () => merge(rug()) },
  frame: { label: '액자', mount: 'wall', hx: 0.43, hz: 0.05, y0: 1.32, height: 0.86, art: { size: 0.7, x: 0, y: 1.75, z: 0.068 }, build: () => merge(frame()) },
  window: { label: '창문', mount: 'wall', hx: 0.65, hz: 0.08, y0: 1.24, height: 1.1, build: () => merge(windowItem()) },
  easel: { label: '그림 캔버스', mount: 'floor', hx: 0.5, hz: 0.32, height: 1.8, block: [[0, 0, 0.36]], art: { size: 0.84, x: 0, y: 1.1, z: 0.09 }, build: () => merge(easel()) },
  // 2026-11-19: 새 가구
  tv: { label: '레트로 TV', mount: 'floor', hx: 0.46, hz: 0.27, height: 1.4, block: [[0, 0, 0.36]], build: () => merge(tv()) },
  fireplace: { label: '벽난로', mount: 'floor', hx: 0.71, hz: 0.3, height: 1.3, block: [[-0.35, 0, 0.32], [0.35, 0, 0.32]], build: () => merge(fireplace()) },
  piano: { label: '피아노', mount: 'floor', hx: 0.72, hz: 0.48, height: 1.2, block: [[-0.4, 0, 0.42], [0.4, 0, 0.42]], build: () => merge(piano()) },
  kitchen: { label: '부엌 조리대', mount: 'floor', hx: 0.78, hz: 0.33, height: 1.15, block: [[-0.4, 0, 0.36], [0.4, 0, 0.36]], build: () => merge(kitchen()) },
  fridge: { label: '냉장고', mount: 'floor', hx: 0.36, hz: 0.32, height: 1.76, block: [[0, 0, 0.38]], build: () => merge(fridge()) },
  wardrobe: { label: '옷장', mount: 'floor', hx: 0.6, hz: 0.31, height: 2.0, block: [[-0.3, 0, 0.32], [0.3, 0, 0.32]], build: () => merge(wardrobe()) },
  desk: { label: '책상', mount: 'floor', hx: 0.62, hz: 0.32, height: 1.2, block: [[-0.3, 0, 0.32], [0.3, 0, 0.32]], build: () => merge(desk()) },
  grand_clock: { label: '괘종시계', mount: 'floor', hx: 0.3, hz: 0.21, height: 1.98, block: [[0, 0, 0.26]], build: () => merge(grandClock()) },
  aquarium: { label: '어항', mount: 'floor', hx: 0.51, hz: 0.24, height: 1.22, block: [[-0.25, 0, 0.27], [0.25, 0, 0.27]], build: () => merge(aquarium()) },
  record_player: { label: '축음기', mount: 'floor', hx: 0.32, hz: 0.25, height: 1.35, block: [[0, 0, 0.3]], build: () => merge(recordPlayer()) },
  kotatsu: { label: '코타츠', mount: 'floor', hx: 0.56, hz: 0.56, height: 0.56, block: [[0, 0, 0.5]], build: () => merge(kotatsu()) },
  wall_clock: { label: '벽시계', mount: 'wall', hx: 0.27, hz: 0.05, y0: 1.48, height: 0.54, build: () => merge(wallClock()) },
  wall_shelf: { label: '벽 선반', mount: 'wall', hx: 0.5, hz: 0.14, y0: 1.42, height: 0.5, build: () => merge(wallShelf()) },
  flower_bed: { label: '꽃밭', mount: 'floor', hx: 0.62, hz: 0.36, height: 0.55, block: [[-0.3, 0, 0.3], [0.3, 0, 0.3]], build: () => merge(flowerBed()) },
  campfire: { label: '모닥불', mount: 'floor', hx: 0.5, hz: 0.5, height: 0.7, block: [[0, 0, 0.45]], build: () => merge(campfire()) },
  swing: { label: '그네', mount: 'floor', hx: 0.7, hz: 0.38, height: 1.95, block: [[-0.62, 0, 0.12], [0.62, 0, 0.12]], build: () => merge(swing()) },
  parasol: { label: '파라솔 테이블', mount: 'floor', hx: 0.5, hz: 0.5, height: 2.35, block: [[0, 0, 0.45]], build: () => merge(parasol()) },
  xmas_tree: { label: '크리스마스 트리', mount: 'floor', hx: 0.42, hz: 0.42, height: 1.75, block: [[0, 0, 0.4]], build: () => merge(xmasTree()) },
  arcade_machine: { label: '오락기', mount: 'floor', hx: 0.36, hz: 0.42, height: 1.72, block: [[0, 0, 0.4]], build: () => merge(arcadeMachine()) },
  bathtub: { label: '욕조', mount: 'floor', hx: 0.76, hz: 0.42, height: 0.8, block: [[-0.38, 0, 0.4], [0.38, 0, 0.4]], build: () => merge(bathtub()) },
  // 2026-11-16: 겨울 한정 (마당에만)
  snowman: { label: '눈사람', mount: 'floor', hx: 0.45, hz: 0.45, height: 1.65, block: [[0, 0, 0.42]], build: () => merge(snowman()) },
};

/** 모르는 종류 이름이 왔을 때 대신 그리는 선물 상자 */
const UNKNOWN: ItemDef = { label: '선물 상자', mount: 'floor', hx: 0.27, hz: 0.27, height: 0.55, build: () => merge(gift()) };

export const itemDef = (type: string): ItemDef => (Object.prototype.hasOwnProperty.call(FREE_ITEMS, type) ? FREE_ITEMS[type] : UNKNOWN);

/** 앱의 꾸미기 화면이 고르기 목록을 만들 때 쓴다 */
export const FREE_ITEM_LIST: ReadonlyArray<{ type: string; label: string; mount: ItemDef['mount']; hasDrawing: boolean }> = Object.entries(
  FREE_ITEMS,
).map(([type, d]) => ({ type, label: d.label, mount: d.mount, hasDrawing: !!d.art }));

/** 종류별 모양을 처음 쓸 때 한 번만 만든다 */
export class ItemGeometries {
  private readonly cache = new Map<string, THREE.BufferGeometry>();

  get(type: string): THREE.BufferGeometry {
    const key = Object.prototype.hasOwnProperty.call(FREE_ITEMS, type) ? type : '?';
    let g = this.cache.get(key);
    if (!g) this.cache.set(key, (g = itemDef(type).build()));
    return g;
  }

  dispose() {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
  }
}
