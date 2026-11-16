import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLOW_ATTRS } from '../core/glowLambert';
import { fillAttr, mergeParts, paint, roundedCone } from '../util/geo';

/**
 * 고양이섬 집.
 * 둥글둥글한 벽 + 통통한 박공지붕 + 지붕 위 고양이 귀 두 개(우리 섬만의 표시).
 * 원점은 집 바닥 한가운데, 앞(문)은 +z.
 *
 * 색은 꼭짓점에 칠해 두고, 지붕 색만 집마다 다르게(aMask.x=1) 받는다.
 * 창문과 문의 작은 창은 밤에 빛난다(aMask.y=1).
 */

export const HOUSE_DIM = {
  width: 2.9,
  depth: 2.3,
  wallTop: 1.9,
  ridge: 3.05,
  eaveZ: 1.46,
  /** 이름표를 띄울 높이 */
  labelY: 4.35,
};

const C = {
  wall: '#fff3dc',
  wallLow: '#f4dfbd',
  stone: '#d6cbbb',
  trim: '#fffdf6',
  wood: '#c98b5e',
  woodDark: '#9a6645',
  glass: '#a6dbef',
  gold: '#f4c95d',
  chimney: '#f1e2cc',
  chimneyCap: '#d9c6ad',
  earInner: '#ffe1dc',
  leaf: '#7cc46a',
};

type Piece = THREE.BufferGeometry;

function piece(geo: THREE.BufferGeometry, color: string, tint = 0, glow = 0, shade = 1): Piece {
  paint(geo, color, shade);
  fillAttr(geo, 'aMask', [tint, glow]);
  return geo;
}

/** 지붕 단면(z,y)을 x 방향으로 길게 뽑는다 */
function extrudeAlongX(shape: THREE.Shape, length: number, bevel: number, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: length - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -(length - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export function buildHouseGeometry(): THREE.BufferGeometry {
  const D = HOUSE_DIM;
  const parts: Piece[] = [];
  const frontZ = D.depth / 2;

  // 기초와 벽
  parts.push(piece(new RoundedBoxGeometry(D.width + 0.26, 0.22, D.depth + 0.26, 1, 0.08).translate(0, 0.1, 0), C.stone));
  parts.push(piece(new RoundedBoxGeometry(D.width, 1.8, D.depth, 2, 0.17).translate(0, 0.14 + 0.9, 0), C.wall));
  parts.push(
    piece(new RoundedBoxGeometry(D.width + 0.07, 0.44, D.depth + 0.07, 1, 0.14).translate(0, 0.14 + 0.22, 0), C.wallLow),
  );

  // 박공(지붕 아래 세모 벽)
  {
    const s = new THREE.Shape();
    s.moveTo(-1.1, 1.8);
    s.lineTo(1.1, 1.8);
    s.quadraticCurveTo(0.55, 2.45, 0, 2.8);
    s.quadraticCurveTo(-0.55, 2.45, -1.1, 1.8);
    parts.push(piece(extrudeAlongX(s, D.width - 0.04, 0, 6), C.wall));
  }

  // 지붕: 통통하게 부푼 껍데기
  {
    const s = new THREE.Shape();
    const e = D.eaveZ;
    const y0 = 1.74;
    s.moveTo(-e, y0);
    s.quadraticCurveTo(-0.88, 2.78, 0, D.ridge);
    s.quadraticCurveTo(0.88, 2.78, e, y0);
    s.quadraticCurveTo(e + 0.02, y0 - 0.13, e - 0.14, y0 - 0.16);
    s.quadraticCurveTo(0.8, 2.5, 0, 2.77);
    s.quadraticCurveTo(-0.8, 2.5, -e + 0.14, y0 - 0.16);
    s.quadraticCurveTo(-e - 0.02, y0 - 0.13, -e, y0);
    const roof = extrudeAlongX(s, D.width + 0.5, 0.07, 8);
    piece(roof, '#ffffff', 1);
    // 기와 줄: 높이에 따라 번갈아 살짝 어둡게 칠한다
    const pos = roof.attributes.position;
    const nor = roof.attributes.normal;
    const col = roof.attributes.color;
    for (let i = 0; i < pos.count; i += 3) {
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
      if (ny < 0.25) continue;
      const band = Math.floor((cy - y0) / 0.2);
      const shade = band % 2 === 0 ? 1 : 0.9;
      for (let k = 0; k < 3; k++) col.setXYZ(i + k, shade, shade, shade);
    }
    parts.push(roof);
    // 용마루: 지붕 꼭대기를 따라 놓인 밝은 띠
    const cap = new THREE.CapsuleGeometry(0.12, D.width + 0.34, 3, 8).rotateZ(Math.PI / 2);
    cap.scale(1, 0.8, 1.25);
    cap.translate(0, D.ridge - 0.03, 0);
    parts.push(piece(cap, C.trim, 0.25));
    // 앞뒤 처마 끝의 흰 테두리
    for (const side of [1, -1]) {
      const fascia = new THREE.CapsuleGeometry(0.075, D.width + 0.42, 2, 6).rotateZ(Math.PI / 2);
      fascia.translate(0, y0 - 0.07, side * (e - 0.03));
      parts.push(piece(fascia, C.trim, 0.2));
    }
  }

  // 지붕 위 고양이 귀
  for (const side of [1, -1]) {
    const ex = side * 0.95;
    const ey = D.ridge - 0.4;
    const ez = 0.06;
    const outer = roundedCone(0.52, 1.08, 12);
    outer.scale(1, 1, 0.56);
    outer.rotateZ(-side * 0.22);
    outer.translate(ex, ey, ez);
    parts.push(piece(outer, '#ffffff', 1, 0, 0.92));

    const inner = roundedCone(0.34, 0.74, 10);
    inner.scale(1, 1, 0.4);
    inner.translate(0, 0.16, 0.19);
    inner.rotateZ(-side * 0.22);
    inner.translate(ex, ey, ez);
    parts.push(piece(inner, C.earInner, 0.22));
  }

  // 굴뚝 (뒤쪽 지붕)
  parts.push(piece(new RoundedBoxGeometry(0.44, 1.0, 0.44, 1, 0.07).translate(0, 2.7, -0.78), C.chimney));
  parts.push(piece(new RoundedBoxGeometry(0.56, 0.16, 0.56, 1, 0.06).translate(0, 3.24, -0.78), C.chimneyCap));

  // 문: 위가 둥근 나무문 + 흰 문틀 + 작은 둥근 창 + 손잡이
  {
    const arch = (w: number, h: number) => {
      const s = new THREE.Shape();
      const r = w / 2;
      s.moveTo(-r, 0);
      s.lineTo(-r, h - r);
      s.absarc(0, h - r, r, Math.PI, 0, true);
      s.lineTo(r, 0);
      s.lineTo(-r, 0);
      return s;
    };
    const frame = new THREE.ExtrudeGeometry(arch(0.9, 1.4), { depth: 0.07, bevelEnabled: false, curveSegments: 10 });
    frame.translate(0, 0.16, frontZ - 0.02);
    parts.push(piece(frame, C.trim));
    const door = new THREE.ExtrudeGeometry(arch(0.72, 1.28), {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
      curveSegments: 10,
    });
    door.translate(0, 0.17, frontZ + 0.03);
    parts.push(piece(door, C.wood));
    const win = new THREE.CylinderGeometry(0.125, 0.125, 0.03, 16).rotateX(Math.PI / 2);
    win.translate(0, 1.07, frontZ + 0.105);
    parts.push(piece(win, C.glass, 0, 1));
    const ring = new THREE.TorusGeometry(0.135, 0.028, 5, 14);
    ring.translate(0, 1.07, frontZ + 0.1);
    parts.push(piece(ring, C.woodDark));
    const knob = new THREE.SphereGeometry(0.048, 10, 8);
    knob.translate(0.23, 0.66, frontZ + 0.12);
    parts.push(piece(knob, C.gold));
  }
  // 문 앞 디딤돌
  parts.push(piece(new RoundedBoxGeometry(1.04, 0.14, 0.46, 1, 0.06).translate(0, 0.06, frontZ + 0.3), C.stone, 0, 0, 1.04));
  // 문 위 차양 (지붕 색)
  {
    const aw = new THREE.CylinderGeometry(0.56, 0.56, 0.34, 14, 1, false, -Math.PI / 2, Math.PI);
    aw.rotateX(Math.PI / 2);
    aw.scale(1, 0.55, 1);
    aw.translate(0, 1.56, frontZ + 0.14);
    parts.push(piece(aw, '#ffffff', 1, 0, 0.92));
  }

  // 앞 창문 두 개 + 꽃 상자
  for (const side of [1, -1]) {
    const x = side * 0.93;
    const y = 1.14;
    parts.push(piece(new RoundedBoxGeometry(0.66, 0.66, 0.1, 1, 0.1).translate(x, y, frontZ + 0.01), C.trim));
    parts.push(piece(new RoundedBoxGeometry(0.5, 0.5, 0.06, 1, 0.07).translate(x, y, frontZ + 0.05), C.glass, 0, 1));
    parts.push(piece(new THREE.BoxGeometry(0.5, 0.05, 0.03).translate(x, y, frontZ + 0.085), C.trim));
    parts.push(piece(new THREE.BoxGeometry(0.05, 0.5, 0.03).translate(x, y, frontZ + 0.085), C.trim));
    parts.push(piece(new RoundedBoxGeometry(0.66, 0.15, 0.2, 1, 0.05).translate(x, 0.74, frontZ + 0.12), C.wood));
    const flowerColors = side > 0 ? ['#ff8fa3', '#ffd166', '#ffffff'] : ['#ffd166', '#ff9ec2', '#ffb37a'];
    flowerColors.forEach((fc, i) => {
      const fx = x + (i - 1) * 0.2;
      parts.push(piece(new THREE.SphereGeometry(0.09, 8, 6).translate(fx, 0.86, frontZ + 0.13), fc));
      parts.push(piece(new THREE.IcosahedronGeometry(0.07, 0).translate(fx + 0.1, 0.82, frontZ + 0.1), C.leaf));
    });
  }

  // 옆 박공의 둥근 창
  for (const side of [1, -1]) {
    const x = side * (D.width / 2 - 0.03);
    const frame = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 18).rotateZ(Math.PI / 2);
    frame.translate(x, 2.12, 0);
    parts.push(piece(frame, C.trim));
    const glass = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 18).rotateZ(Math.PI / 2);
    glass.translate(x + side * 0.005, 2.12, 0);
    parts.push(piece(glass, C.glass, 0, 1));
  }

  return mergeParts(parts, GLOW_ATTRS);
}

/**
 * 마당 테두리: 낮은 흰 울타리(뒤와 양옆) + 문에서 길까지 이어지는 디딤돌.
 * 원점은 마당 한가운데. size 는 마당 한 변 길이.
 */
export function buildYardGeometry(size: number, houseFrontZ: number, mailboxZ = size / 2 - 0.3, pathZ = size / 2): THREE.BufferGeometry {
  const parts: Piece[] = [];
  const h = size / 2 - 0.12;
  const fenceColor = '#fffaf0';

  // 잔디 깔개: 마당 범위가 한눈에 보이도록 살짝 밝은 둥근 네모
  {
    const r = 0.8;
    const e = size / 2 - 0.02;
    const s = new THREE.Shape();
    s.moveTo(-e + r, -e);
    s.lineTo(e - r, -e);
    s.quadraticCurveTo(e, -e, e, -e + r);
    s.lineTo(e, e - r);
    s.quadraticCurveTo(e, e, e - r, e);
    s.lineTo(-e + r, e);
    s.quadraticCurveTo(-e, e, -e, e - r);
    s.lineTo(-e, -e + r);
    s.quadraticCurveTo(-e, -e, -e + r, -e);
    const lawn = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false, curveSegments: 6 });
    lawn.rotateX(-Math.PI / 2);
    parts.push(piece(lawn, '#c2ea92'));
  }
  const postColor = '#f0dcc0';

  const picket = (x: number, z: number, alongX: boolean) => {
    const g = new THREE.BoxGeometry(alongX ? 0.2 : 0.07, 0.5, alongX ? 0.07 : 0.2);
    g.translate(x, 0.3, z);
    parts.push(piece(g, fenceColor));
  };
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const g = new THREE.BoxGeometry(alongX ? len : 0.045, 0.07, alongX ? 0.045 : len);
    g.translate((x0 + x1) / 2, 0.36, (z0 + z1) / 2);
    parts.push(piece(g, fenceColor, 0, 0, 0.95));
  };
  const post = (x: number, z: number, tall = 0.72) => {
    parts.push(piece(new RoundedBoxGeometry(0.2, tall, 0.2, 1, 0.05).translate(x, tall / 2, z), postColor));
    parts.push(piece(new THREE.SphereGeometry(0.115, 8, 6).translate(x, tall + 0.06, z), fenceColor));
  };

  const step = 0.46;
  // 뒤쪽
  for (let x = -h + step; x < h - 0.1; x += step) picket(x, -h, true);
  rail(-h, -h, h, -h);
  // 양옆 (앞쪽 1/3 은 틔워 둔다)
  const sideEnd = h * 0.38;
  for (const sx of [-h, h]) {
    for (let z = -h + step; z < sideEnd - 0.1; z += step) picket(sx, z, false);
    rail(sx, -h, sx, sideEnd);
    post(sx, -h);
    post(sx, sideEnd, 0.62);
  }
  // 앞 모서리 기둥
  post(-h, h, 0.5);
  post(h, h, 0.5);

  // 우편함 (2026-11-16): 앞 오른쪽 대문 옆. 나무 기둥 위에 둥근 지붕 통, 옆에 빨간 깃발
  {
    const mx = 1.75;
    const mz = mailboxZ;
    parts.push(piece(new RoundedBoxGeometry(0.12, 0.78, 0.12, 1, 0.03).translate(mx, 0.39, mz), '#b98557'));
    parts.push(piece(new RoundedBoxGeometry(0.34, 0.26, 0.48, 2, 0.06).translate(mx, 0.9, mz), '#7cc4f2'));
    // 반원 지붕: 축이 앞뒤(z)로 눕고 둥근 쪽이 위
    const lid = new THREE.CylinderGeometry(0.17, 0.17, 0.48, 12, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
    parts.push(piece(lid.translate(mx, 1.02, mz), '#7cc4f2'));
    parts.push(piece(new THREE.BoxGeometry(0.2, 0.08, 0.012).translate(mx, 0.92, mz + 0.245), '#fffaf0'));
    parts.push(piece(new THREE.BoxGeometry(0.025, 0.28, 0.025).translate(mx + 0.185, 1.02, mz - 0.05), '#5b4636'));
    parts.push(piece(new THREE.BoxGeometry(0.02, 0.1, 0.14).translate(mx + 0.19, 1.12, mz + 0.02), '#ff6f61'));
  }

  // 디딤돌
  const stones = 3;
  for (let i = 0; i < stones; i++) {
    const t = (i + 0.5) / stones;
    const z = houseFrontZ + 0.75 + t * (size / 2 - houseFrontZ - 0.75);
    const g = new THREE.CylinderGeometry(0.3, 0.33, 0.07, 16);
    g.scale(1.15, 1, 0.85);
    g.rotateY(i * 0.7);
    g.translate((i % 2 ? 0.08 : -0.08), 0.03, z);
    parts.push(piece(g, '#e9dfcf'));
  }
  // 기본 마당(6m)은 길이 조금 앞에서 시작하므로 마당 밖에 디딤돌 하나를 더 놓아 길까지 잇는다
  if (pathZ > size / 2 + 0.35) {
    const g = new THREE.CylinderGeometry(0.3, 0.33, 0.07, 16);
    g.scale(1.15, 1, 0.85);
    g.translate(0.05, 0.03, (size / 2 + pathZ) / 2 + 0.05);
    parts.push(piece(g, '#e9dfcf'));
  }

  return mergeParts(parts, GLOW_ATTRS);
}

/**
 * 멀리서 보는 단순한 집 (삼각형 약 110개, 마당 흔적 포함).
 * 크기와 윤곽은 가까이서 보는 집과 같고, 지붕 색/고양이 귀/창문 불빛만 남긴다.
 */
export function buildFarHouseGeometry(yardSize: number, yardZ: number): THREE.BufferGeometry {
  const D = HOUSE_DIM;
  const parts: Piece[] = [];
  const frontZ = D.depth / 2;
  parts.push(piece(new THREE.BoxGeometry(D.width, 1.8, D.depth).translate(0, 0.14 + 0.9, 0), C.wall));
  // 지붕: 같은 단면을 각지게
  {
    const e = D.eaveZ;
    const s = new THREE.Shape();
    s.moveTo(-e, 1.6);
    s.lineTo(e, 1.6);
    s.lineTo(e, 1.76);
    s.lineTo(0.8, 2.72);
    s.lineTo(0, D.ridge);
    s.lineTo(-0.8, 2.72);
    s.lineTo(-e, 1.76);
    s.lineTo(-e, 1.6);
    parts.push(piece(extrudeAlongX(s, D.width + 0.6, 0, 1), '#ffffff', 1));
  }
  for (const side of [1, -1]) {
    const ear = new THREE.ConeGeometry(0.52, 1.1, 5, 1, true);
    ear.scale(1, 1, 0.56);
    ear.rotateZ(-side * 0.22);
    ear.translate(side * 0.95, D.ridge - 0.4 + 0.5, 0.06);
    parts.push(piece(ear, '#ffffff', 1, 0, 0.92));
  }
  parts.push(piece(new THREE.BoxGeometry(0.44, 0.9, 0.44).translate(0, 2.8, -0.78), C.chimney));
  const quad = (w: number, h: number, x: number, y: number) => new THREE.PlaneGeometry(w, h).translate(x, y, frontZ + 0.02);
  parts.push(piece(quad(0.72, 1.28, 0, 0.8), C.wood));
  parts.push(piece(quad(0.52, 0.52, 0.93, 1.14), C.glass, 0, 1));
  parts.push(piece(quad(0.52, 0.52, -0.93, 1.14), C.glass, 0, 1));
  // 마당 흔적: 잔디 깔개와 낮은 흰 울타리 띠 (집 가운데 기준이라 z 를 yardZ 만큼 민다)
  const half = yardSize / 2 - 0.12;
  parts.push(piece(new THREE.PlaneGeometry(yardSize - 0.1, yardSize - 0.1).rotateX(-Math.PI / 2).translate(0, 0.035, yardZ), '#c2ea92'));
  parts.push(piece(new THREE.BoxGeometry(half * 2, 0.34, 0.08).translate(0, 0.3, yardZ - half), '#fffaf0'));
  for (const sx of [-1, 1]) {
    parts.push(piece(new THREE.BoxGeometry(0.08, 0.34, half * 1.38).translate(sx * half, 0.3, yardZ - half + half * 0.69), '#fffaf0'));
  }
  return mergeParts(parts, GLOW_ATTRS);
}

/** 깃발 크기 기준값 */
export const FLAG_DIM = { height: 1.75, clothW: 0.66, clothH: 0.44 };

/**
 * 지역 깃발. 원점은 깃대 바닥.
 * aMask.x=1 인 부분(깃발 천)만 인스턴스 색을 받고, 깃대는 흰색 그대로.
 * aMask.y 는 깃대에서 떨어진 정도(0~1)라서 셰이더에서 펄럭임에 쓴다.
 */
export function buildFlagGeometry(): THREE.BufferGeometry {
  const F = FLAG_DIM;
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.035, 0.045, F.height, 5, 1, true).translate(0, F.height / 2, 0);
  paint(pole, '#fffaf0');
  fillAttr(pole, 'aMask', [0, 0]);
  parts.push(pole);
  const knob = new THREE.OctahedronGeometry(0.075).translate(0, F.height + 0.03, 0);
  paint(knob, '#f4c95d');
  fillAttr(knob, 'aMask', [0, 0]);
  parts.push(knob);
  // 천: 끝이 제비꼬리처럼 갈라진 얇은 판 (앞뒤 두 면)
  const seg = 4;
  for (const face of [1, -1]) {
    const cloth = new THREE.PlaneGeometry(F.clothW, F.clothH, seg, 2);
    const pos = cloth.attributes.position;
    const mask = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / F.clothW + 0.5;
      const v = pos.getY(i) / F.clothH;
      // 끝쪽 가운데를 안으로 당겨서 제비꼬리 모양
      const notch = u > 0.99 ? (1 - Math.abs(v) * 2) * 0.24 : 0;
      pos.setX(i, (u - notch) * F.clothW + 0.04);
      pos.setY(i, pos.getY(i) + F.height - F.clothH / 2 - 0.06);
      pos.setZ(i, face * 0.004);
      mask[i * 2] = 1;
      mask[i * 2 + 1] = u;
    }
    if (face < 0) {
      // 뒷면은 감는 방향을 뒤집는다
      const idx = cloth.index!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i);
        idx.setX(i, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
    }
    cloth.computeVertexNormals();
    paint(cloth, '#ffffff');
    cloth.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    parts.push(cloth);
  }
  return mergeParts(parts, GLOW_ATTRS);
}

/** 지붕 그림 한 변의 길이 (지붕 폭 3.4 중 가운데만 덮는다) */
export const ROOF_ART_SIZE = 3.0;
/** 지붕 그림이 덮는 앞쪽 지붕 면의 가로:세로 (그리기 화면의 도화지 비율과 같다. src/app 의 ROOF_ART_ASPECT) */
export const ROOF_ART_ASPECT = 1.6;

/**
 * 지붕 그림을 붙이는 판: 지붕 앞면(대문 쪽 경사면)의 휜 모양을 그대로 따라가는 네모.
 * 집과 같은 기준(원점은 집 바닥 한가운데, 앞은 +z)이라서 집과 같은 행렬로 놓으면 된다.
 * uv 는 (0,0)=왼쪽 아래 ~ (1,1)=오른쪽 위 (앞에서 봤을 때).
 */
export function buildRoofArtGeometry(): THREE.BufferGeometry {
  const D = HOUSE_DIM;
  // 지붕 단면의 앞쪽 곡선 (buildHouseGeometry 의 지붕과 같은 점)
  const p0 = { z: 0, y: D.ridge };
  const p1 = { z: 0.88, y: 2.78 };
  const p2 = { z: D.eaveZ, y: 1.74 };
  const at = (t: number) => ({
    z: (1 - t) * (1 - t) * p0.z + 2 * t * (1 - t) * p1.z + t * t * p2.z,
    y: (1 - t) * (1 - t) * p0.y + 2 * t * (1 - t) * p1.y + t * t * p2.y,
  });
  // 고양이 귀 아래(t0)에서 처마 위(t1)까지. 지붕 겉면은 단면보다 0.07 바깥이라 그만큼 띄운다
  // 2026-11-15: 앞쪽 지붕 면을 거의 다 덮게 키웠다 (그림이 너무 작다는 요청)
  const t0 = 0.1;
  const t1 = 0.95;
  const lift = 0.07 + 0.016;
  const rows = 14;
  const half = ROOF_ART_SIZE / 2;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = t0 + ((t1 - t0) * i) / rows;
    const a = at(t);
    const b = at(t + 0.001);
    // 곡선의 접선 (z, y) → 바깥쪽 법선
    let tz = b.z - a.z;
    let ty = b.y - a.y;
    const tl = Math.hypot(tz, ty);
    tz /= tl;
    ty /= tl;
    const nz = -ty;
    const ny = tz;
    for (const side of [-1, 1]) {
      pos.push(side * half, a.y + ny * lift, a.z + nz * lift);
      nor.push(0, ny, nz);
      uv.push(side < 0 ? 0 : 1, 1 - i / rows);
    }
    if (i < rows) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
