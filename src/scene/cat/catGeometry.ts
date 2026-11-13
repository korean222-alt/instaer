import * as THREE from 'three';
import { fillAttr, mergeParts, roundedCone } from '../util/geo';

/**
 * 젤리 고양이 모양.
 * 단위: 귀 끝까지 키가 약 1. 앞은 +z, 위는 +y, 발바닥이 y=0.
 *
 * 꼭짓점마다 붙는 속성
 * - aPart  : 부위 번호 (아래 PART)
 * - aW     : 부위 안에서의 위치 (꼬리는 뿌리 0 → 끝 1)
 * - aPivot : 그 부위가 움직일 때의 회전 중심 (다리는 엉덩이, 꼬리는 뿌리, 귀는 귀 뿌리)
 *
 * 움직임(걷기, 꼬리 흔들기, 졸기)과 털 무늬, 얼굴은 전부 셰이더에서 그린다. → catMaterial.ts
 */
export const PART = {
  body: 0,
  head: 1,
  ear: 2,
  earInner: 3,
  tail: 4,
  legFL: 5,
  legFR: 6,
  legBL: 7,
  legBR: 8,
} as const;

/** 셰이더와 같이 쓰는 기준점 */
export const CAT_DIM = {
  headCenter: new THREE.Vector3(0, 0.575, 0.2),
  neck: new THREE.Vector3(0, 0.4, 0.1),
  headRadius: new THREE.Vector3(0.335, 0.28, 0.29),
};

function tag(geo: THREE.BufferGeometry, part: number, pivot: [number, number, number], w = 0) {
  fillAttr(geo, 'aPart', [part]);
  fillAttr(geo, 'aPivot', pivot);
  if (!geo.attributes.aW) fillAttr(geo, 'aW', [w]);
  return geo;
}

/**
 * detail 'high': 가까이서 볼 때 (삼각형 약 4,000개)
 * detail 'low' : 보통 거리 (약 1,300개). 모양과 비율은 같고 둥근 정도만 낮다
 */
export function buildCatGeometry(detail: 'high' | 'low' = 'high'): THREE.BufferGeometry {
  const hi = detail === 'high';
  const parts: THREE.BufferGeometry[] = [];
  const H = CAT_DIM.headCenter;
  const HR = CAT_DIM.headRadius;

  // 몸: 뒤쪽이 살짝 통통한 콩 모양
  {
    const g = new THREE.SphereGeometry(1, hi ? 22 : 12, hi ? 16 : 9);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const rear = 1 + 0.1 * Math.max(0, -z);
      const belly = 1 + 0.06 * Math.max(0, -y);
      p.setXYZ(i, x * rear * belly, y, z);
    }
    g.scale(0.25, 0.215, 0.33);
    g.translate(0, 0.305, -0.08);
    g.computeVertexNormals();
    parts.push(tag(g, PART.body, [0, 0.305, -0.08]));
  }

  // 머리: 볼이 통통한 찹쌀떡 모양
  {
    const g = new THREE.SphereGeometry(1, hi ? 34 : 18, hi ? 22 : 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      let y = p.getY(i);
      const z = p.getZ(i);
      const cheek = 1 + 0.13 * Math.max(0, -y + 0.15) * (1 - Math.abs(y));
      if (y < 0) y *= 0.93;
      p.setXYZ(i, x * cheek, y, z * (1 + 0.04 * Math.max(0, -y)));
    }
    g.scale(HR.x, HR.y, HR.z);
    g.translate(H.x, H.y, H.z);
    g.computeVertexNormals();
    parts.push(tag(g, PART.head, [0, 0, 0]));
  }

  // 귀 (바깥 + 분홍 안쪽)
  for (const side of [1, -1]) {
    const base: [number, number, number] = [side * 0.19, H.y + 0.165, H.z - 0.005];
    const outer = roundedCone(0.135, 0.25, hi ? 12 : 7, hi ? 7 : 4);
    outer.scale(1, 1, 0.5);
    outer.rotateZ(-side * 0.3);
    outer.translate(...base);
    parts.push(tag(outer, PART.ear, base));

    const inner = roundedCone(0.092, 0.175, hi ? 10 : 6, hi ? 7 : 3);
    inner.scale(1, 1, 0.42);
    inner.translate(0, 0.03, 0.036);
    inner.rotateZ(-side * 0.3);
    inner.translate(...base);
    parts.push(tag(inner, PART.earInner, base));
  }

  // 다리 4개: 짧고 통통한 캡슐
  const legs: Array<[number, number, number]> = [
    [PART.legFL, 0.122, 0.1],
    [PART.legFR, -0.122, 0.1],
    [PART.legBL, 0.132, -0.26],
    [PART.legBR, -0.132, -0.26],
  ];
  for (const [part, x, z] of legs) {
    const g = new THREE.CapsuleGeometry(0.083, 0.1, hi ? 4 : 2, hi ? 12 : 7);
    g.translate(x, 0.133, z);
    parts.push(tag(g, part, [x, 0.25, z]));
  }

  // 꼬리: 위로 올라가 끝이 살짝 말린 모양
  {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.36, -0.36),
      new THREE.Vector3(0, 0.5, -0.52),
      new THREE.Vector3(0, 0.71, -0.56),
      new THREE.Vector3(0, 0.88, -0.47),
      new THREE.Vector3(0, 0.92, -0.35),
    ]);
    const radius = 0.056;
    const tube = new THREE.TubeGeometry(curve, hi ? 16 : 9, radius, hi ? 10 : 6, false);
    // TubeGeometry 의 uv.x 가 길이 방향 위치(0~1)
    const uv = tube.attributes.uv;
    const w = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) w[i] = uv.getX(i);
    tube.setAttribute('aW', new THREE.BufferAttribute(w, 1));
    const pivot: [number, number, number] = [0, 0.36, -0.36];
    parts.push(tag(tube, PART.tail, pivot));

    const end = curve.getPoint(1);
    const cap = new THREE.SphereGeometry(radius, hi ? 10 : 6, hi ? 8 : 5);
    cap.translate(end.x, end.y, end.z);
    parts.push(tag(cap, PART.tail, pivot, 1));
  }

  return mergeParts(parts, { position: 3, normal: 3, aPart: 1, aW: 1, aPivot: 3 });
}
