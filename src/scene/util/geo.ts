import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

/** 모든 꼭짓점에 같은 값을 넣은 속성을 붙인다 */
export function fillAttr(geo: THREE.BufferGeometry, name: string, values: number[]): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  const size = values.length;
  const arr = new Float32Array(n * size);
  for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) arr[i * size + k] = values[k];
  geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  return geo;
}

/** 꼭짓점 색을 한 색으로 칠한다 (hex는 sRGB, 저장은 선형 색) */
export function paint(geo: THREE.BufferGeometry, hex: string | number, shade = 1): THREE.BufferGeometry {
  _c.set(hex);
  return fillAttr(geo, 'color', [_c.r * shade, _c.g * shade, _c.b * shade]);
}

/** 높이에 따라 아래색 → 윗색으로 꼭짓점 색을 칠한다 */
export function paintGradientY(
  geo: THREE.BufferGeometry,
  bottomHex: string | number,
  topHex: string | number,
): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.attributes.position;
  const a = new THREE.Color(bottomHex);
  const b = new THREE.Color(topHex);
  const arr = new Float32Array(pos.count * 3);
  const span = Math.max(1e-6, bb.max.y - bb.min.y);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / span;
    arr[i * 3] = a.r + (b.r - a.r) * t;
    arr[i * 3 + 1] = a.g + (b.g - a.g) * t;
    arr[i * 3 + 2] = a.b + (b.b - a.b) * t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * 여러 조각을 한 덩어리로 합친다.
 * keep 에 적힌 속성만 남기고(없는 조각은 0으로 채움) 겹치는 꼭짓점을 정리한다.
 */
export function mergeParts(parts: THREE.BufferGeometry[], keep: Record<string, number>): THREE.BufferGeometry {
  const cleaned = parts.map((src) => {
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!(name in keep)) g.deleteAttribute(name);
    }
    for (const [name, size] of Object.entries(keep)) {
      if (!g.attributes[name]) {
        g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * size), size));
      }
    }
    g.morphAttributes = {};
    return g;
  });
  const merged = mergeGeometries(cleaned, false);
  if (!merged) throw new Error('mergeParts: 조각을 합치지 못했어요');
  const out = mergeVertices(merged, 1e-4);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** 위가 둥근 원뿔(귀, 지붕 귀 등에 쓴다). 바닥은 y=0, 꼭대기는 y=height */
export function roundedCone(radius: number, height: number, radial = 14, steps = 7): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // 아래는 넓고 위로 갈수록 부드럽게 모이는 곡선
    const r = radius * Math.pow(1 - t, 0.62) * (1 - 0.12 * Math.sin(t * Math.PI));
    pts.push(new THREE.Vector2(Math.max(r, 0), height * (t + 0.035 * Math.sin(t * Math.PI))));
  }
  pts[steps].x = 0;
  const g = new THREE.LatheGeometry(pts, radial);
  g.computeVertexNormals();
  return g;
}

/** sRGB hex → 선형 색 Vector3 (셰이더 uniform 용) */
export function linearColor(hex: string | number): THREE.Vector3 {
  _c.set(hex);
  return new THREE.Vector3(_c.r, _c.g, _c.b);
}
