import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { YardItemType } from '../../shared/types';
import { GLOW_ATTRS } from '../core/glowLambert';
import { fillAttr, mergeParts, paint } from '../util/geo';

/**
 * 마당 꾸미기 아이템 8종.
 * 원점은 마당 칸 한가운데 바닥, 앞은 +z. 한 칸(1x1) 안에 들어오는 크기로 만든다.
 * 색은 꼭짓점 색, 등불의 불빛 부분만 밤에 빛난다(aMask.y=1).
 */
type Pieces = THREE.BufferGeometry[];

function p(geo: THREE.BufferGeometry, color: string, glow = 0, shade = 1) {
  paint(geo, color, shade);
  fillAttr(geo, 'aMask', [0, glow]);
  return geo;
}

const WOOD = '#c99766';
const WOOD_DARK = '#a2734c';
const CREAM = '#fbefdc';

function catTower(): Pieces {
  const o: Pieces = [];
  o.push(p(new RoundedBoxGeometry(0.86, 0.09, 0.86, 1, 0.04).translate(0, 0.045, 0), CREAM));
  o.push(p(new THREE.CylinderGeometry(0.085, 0.085, 1.45, 8).translate(-0.2, 0.8, -0.18), '#dcb98a'));
  o.push(p(new THREE.CylinderGeometry(0.085, 0.085, 0.72, 8).translate(0.24, 0.44, 0.16), '#dcb98a'));
  // 아래 숨숨집
  o.push(p(new RoundedBoxGeometry(0.46, 0.4, 0.44, 1, 0.08).translate(-0.17, 0.29, 0.18), '#9fdcc0'));
  o.push(p(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 12).rotateX(Math.PI / 2).translate(-0.17, 0.27, 0.405), '#5b4636'));
  // 중간 발판
  o.push(p(new RoundedBoxGeometry(0.5, 0.08, 0.46, 1, 0.035).translate(0.2, 0.82, 0.14), CREAM));
  // 꼭대기 둥근 침대
  o.push(p(new THREE.CylinderGeometry(0.36, 0.3, 0.12, 14).translate(-0.2, 1.56, -0.18), CREAM));
  o.push(p(new THREE.TorusGeometry(0.33, 0.07, 6, 16).rotateX(Math.PI / 2).translate(-0.2, 1.63, -0.18), '#ffb3c1'));
  // 매달린 공
  o.push(p(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 4).translate(0.36, 0.66, 0.3), '#8a6a52'));
  o.push(p(new THREE.SphereGeometry(0.075, 8, 6).translate(0.36, 0.5, 0.3), '#ff8fa3'));
  return o;
}

function hammock(): Pieces {
  const o: Pieces = [];
  for (const sx of [-1, 1]) {
    o.push(p(new THREE.CylinderGeometry(0.05, 0.065, 0.82, 6).rotateZ(sx * 0.16).translate(sx * 0.55, 0.4, 0), WOOD_DARK));
    o.push(p(new RoundedBoxGeometry(0.16, 0.06, 0.6, 1, 0.025).translate(sx * 0.6, 0.03, 0), WOOD_DARK));
    o.push(p(new THREE.SphereGeometry(0.07, 8, 6).translate(sx * 0.48, 0.82, 0), CREAM));
  }
  // 늘어진 천 (줄무늬)
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const u0 = i / seg;
    const u1 = (i + 1) / seg;
    const sag = (u: number) => 0.72 - 0.34 * Math.sin(u * Math.PI);
    const x0 = (u0 - 0.5) * 0.96;
    const x1 = (u1 - 0.5) * 0.96;
    const g = new THREE.BoxGeometry(Math.hypot(x1 - x0, sag(u1) - sag(u0)) + 0.01, 0.035, 0.52);
    g.rotateZ(Math.atan2(sag(u1) - sag(u0), x1 - x0));
    g.translate((x0 + x1) / 2, (sag(u0) + sag(u1)) / 2, 0);
    o.push(p(g, i % 2 ? '#fff6ea' : '#ff9a82'));
  }
  return o;
}

function plant(): Pieces {
  const o: Pieces = [];
  o.push(p(new THREE.CylinderGeometry(0.27, 0.19, 0.36, 12).translate(0, 0.18, 0), '#e58f62'));
  o.push(p(new THREE.TorusGeometry(0.27, 0.045, 6, 14).rotateX(Math.PI / 2).translate(0, 0.36, 0), '#f0a57b'));
  const leaf = (x: number, y: number, z: number, r: number) => {
    const g = new THREE.SphereGeometry(r, 10, 8);
    g.scale(1, 1.25, 1);
    g.translate(x, y, z);
    return p(g, '#6fbf63');
  };
  o.push(leaf(0, 0.72, 0, 0.26), leaf(0.2, 0.58, 0.08, 0.2), leaf(-0.2, 0.6, -0.05, 0.2), leaf(0.02, 0.56, -0.2, 0.18));
  o.push(p(new THREE.SphereGeometry(0.075, 8, 6).translate(0.12, 0.98, 0.1), '#ffd166'));
  o.push(p(new THREE.SphereGeometry(0.065, 8, 6).translate(-0.15, 0.86, 0.14), '#ff8fa3'));
  return o;
}

function sign(): Pieces {
  const o: Pieces = [];
  o.push(p(new THREE.CylinderGeometry(0.05, 0.06, 0.85, 6).translate(0, 0.42, 0), WOOD_DARK));
  o.push(p(new RoundedBoxGeometry(0.78, 0.5, 0.08, 1, 0.05).translate(0, 0.9, 0.02), WOOD));
  o.push(p(new RoundedBoxGeometry(0.64, 0.36, 0.03, 1, 0.03).translate(0, 0.9, 0.065), CREAM));
  // 발바닥 도장
  const dot = (x: number, y: number, r: number) =>
    p(new THREE.CylinderGeometry(r, r, 0.02, 10).rotateX(Math.PI / 2).translate(x, y, 0.085), '#f08a9b');
  o.push(dot(0, 0.86, 0.085), dot(-0.1, 0.98, 0.04), dot(0, 1.01, 0.04), dot(0.1, 0.98, 0.04));
  return o;
}

function fishRack(): Pieces {
  const o: Pieces = [];
  for (const sx of [-1, 1]) {
    o.push(p(new THREE.CylinderGeometry(0.045, 0.055, 1.1, 6).translate(sx * 0.42, 0.55, 0), WOOD_DARK));
    o.push(p(new RoundedBoxGeometry(0.14, 0.05, 0.42, 1, 0.02).translate(sx * 0.42, 0.025, 0), WOOD_DARK));
  }
  o.push(p(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6).rotateZ(Math.PI / 2).translate(0, 1.04, 0), WOOD));
  const colors = ['#9fc9e0', '#b6d7e8', '#8fb9d6'];
  [-0.24, 0, 0.24].forEach((x, i) => {
    o.push(p(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4).translate(x, 0.96, 0), '#8a6a52'));
    const body = new THREE.SphereGeometry(0.1, 8, 6);
    body.scale(0.62, 1.7, 0.42);
    body.translate(x, 0.76, 0);
    o.push(p(body, colors[i]));
    const tail = new THREE.ConeGeometry(0.075, 0.12, 4);
    tail.scale(1, 1, 0.3);
    tail.translate(x, 0.56, 0);
    o.push(p(tail, colors[i], 0, 0.88));
  });
  return o;
}

function cushion(): Pieces {
  const o: Pieces = [];
  const body = new THREE.SphereGeometry(0.44, 16, 10);
  body.scale(1, 0.34, 1);
  body.translate(0, 0.15, 0);
  o.push(p(body, '#ffb3c1'));
  o.push(p(new THREE.TorusGeometry(0.4, 0.045, 6, 20).rotateX(Math.PI / 2).translate(0, 0.15, 0), '#fff6ea'));
  o.push(p(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.29, 0), '#ff8fa3'));
  return o;
}

function lantern(): Pieces {
  const o: Pieces = [];
  o.push(p(new RoundedBoxGeometry(0.42, 0.12, 0.42, 1, 0.04).translate(0, 0.06, 0), '#cfc3b2'));
  o.push(p(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8).translate(0, 0.32, 0), '#cfc3b2'));
  o.push(p(new RoundedBoxGeometry(0.36, 0.34, 0.36, 2, 0.1).translate(0, 0.68, 0), '#fff1c2', 1));
  o.push(p(new THREE.ConeGeometry(0.34, 0.2, 4).rotateY(Math.PI / 4).translate(0, 0.95, 0), '#8a6a52'));
  o.push(p(new THREE.SphereGeometry(0.05, 8, 6).translate(0, 1.07, 0), '#f4c95d'));
  return o;
}

function bench(): Pieces {
  const o: Pieces = [];
  o.push(p(new RoundedBoxGeometry(0.98, 0.07, 0.36, 1, 0.03).translate(0, 0.38, 0.02), WOOD));
  o.push(p(new RoundedBoxGeometry(0.98, 0.3, 0.06, 1, 0.03).rotateX(-0.14).translate(0, 0.66, -0.17), WOOD));
  for (const sx of [-1, 1]) {
    o.push(p(new RoundedBoxGeometry(0.08, 0.38, 0.34, 1, 0.025).translate(sx * 0.4, 0.19, 0.02), WOOD_DARK));
    o.push(p(new RoundedBoxGeometry(0.07, 0.5, 0.07, 1, 0.025).rotateX(-0.14).translate(sx * 0.4, 0.58, -0.17), WOOD_DARK));
  }
  return o;
}

const BUILDERS: Record<YardItemType, () => Pieces> = {
  cat_tower: catTower,
  hammock,
  plant,
  sign,
  fish_rack: fishRack,
  cushion,
  lantern,
  bench,
};

export const ITEM_TYPES = Object.keys(BUILDERS) as YardItemType[];

export function buildItemGeometry(type: YardItemType): THREE.BufferGeometry {
  return mergeParts(BUILDERS[type](), GLOW_ATTRS);
}
