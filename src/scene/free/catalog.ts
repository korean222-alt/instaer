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
