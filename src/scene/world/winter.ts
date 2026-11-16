import * as THREE from 'three';
import { GLOW_ATTRS } from '../core/glowLambert';
import { LOCAL_SLOTS, ZONE_SCENERY } from '../layout';
import { HOUSE_DIM } from '../house/houseGeometry';
import { mergeParts } from '../util/geo';
import { hash01, mulberry32 } from '../util/rand';
import { GROUND_Y, HOUSE_OFFSET_Z } from './constants';
import * as props from './props';

/**
 * 겨울 꾸미기 (2026-11-16 사용자: "눈 오고 크리스마스니까").
 *
 * - LED 전구: 집 처마와 지붕 옆선, 나무, 동네 큰 나무, 광장 트리에 두른 작은 점(THREE.Points).
 *   구역 하나에 점 약 6천 개, 그리기 1번. 낮에는 색 구슬, 밤에는 반짝이며 빛난다.
 * - 장식: 동네 큰 나무와 광장 트리에 별과 장식 공, 광장 트리 밑에 선물 상자. 섬 장식과 같은 재질.
 * - 눈 내림: 카메라가 보는 곳 둘레에만 조금(가리지 않게 작고 옅게). 카메라 바로 앞 눈송이는 지운다.
 *
 * 쌓인 눈(나무, 땅, 지붕)은 재질(glowLambert 의 SNOW, terrain)이 그린다.
 */

export interface WinterTemplate {
  /** 별, 장식 공, 선물 상자 (구역 가운데 기준) */
  decor: THREE.BufferGeometry;
  /** LED 전구 점 */
  leds: THREE.BufferGeometry;
}

const LED_COLORS = ['#ff4b4b', '#3ee07a', '#4aa8ff', '#ffd23f', '#ff7ad9', '#ff9b3d'];
const WARM = '#ffe2a8';
const BAUBLE_COLORS = ['#e8413f', '#f4c95d', '#4aa8ff', '#e9e9f2', '#c45bd8'];

const rotX = (x: number, z: number, rot: number) => x * Math.cos(rot) + z * Math.sin(rot);
const rotZ = (x: number, z: number, rot: number) => -x * Math.sin(rot) + z * Math.cos(rot);

/** 잎 덩어리들(타원구)을 가운데 축에서 바깥으로 본 겉면까지의 거리. 안 닿으면 -1 */
function blobExit(blobs: ReadonlyArray<[number, number, number, number]>, squash: number, y: number, dx: number, dz: number): number {
  let best = -1;
  for (const [r, cx, cy, cz] of blobs) {
    const dy = (y - cy) / (r * squash);
    if (Math.abs(dy) >= 1) continue;
    const rr = r * Math.sqrt(1 - dy * dy);
    // 축 위의 점 (0, y, 0) 에서 (dx, dz) 쪽으로: |(-cx, -cz) + t (dx, dz)| = rr
    const ox = -cx;
    const oz = -cz;
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - rr * rr;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b + Math.sqrt(disc);
    if (t > best) best = t;
  }
  return best;
}

/** 층층이 쌓인 원뿔 나무의 높이 y 에서의 반지름 (가장 넓은 층). 없으면 -1 */
function coneExit(tiers: ReadonlyArray<[number, number, number]>, y: number): number {
  let best = -1;
  for (const [r, h, base] of tiers) {
    if (y < base || y > base + h) continue;
    best = Math.max(best, r * (1 - (y - base) / h));
  }
  return best;
}

interface LedOut {
  pos: number[];
  col: number[];
  phase: number[];
}

const c = new THREE.Color();
function led(out: LedOut, x: number, y: number, z: number, color: string, phase: number) {
  c.set(color);
  out.pos.push(x, y, z);
  out.col.push(c.r, c.g, c.b);
  out.phase.push(phase);
}

/** 나무 둘레를 나선으로 감는 전구 줄. exit(y, dx, dz) 는 그 높이와 방향에서 잎 겉면까지의 거리 */
function garland(
  out: LedOut,
  x: number,
  z: number,
  scale: number,
  yBot: number,
  yTop: number,
  turns: number,
  n: number,
  exit: (y: number, dx: number, dz: number) => number,
  palette: readonly string[],
  seed: number,
) {
  const rnd = mulberry32(seed);
  const a0 = rnd() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const y = yTop - t * (yTop - yBot);
    const a = a0 + t * turns * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const d = exit(y, dx, dz);
    if (d <= 0) continue;
    const rr = (d + 0.06) * scale;
    led(out, x + dx * rr, GROUND_Y + y * scale, z + dz * rr, palette[k % palette.length], rnd());
  }
}

/** 구역 하나의 겨울 장식과 LED (모든 구역이 같은 배치를 쓴다) */
export function buildWinterTemplate(): WinterTemplate {
  const out: LedOut = { pos: [], col: [], phase: [] };
  const parts: THREE.BufferGeometry[] = [];

  // ── 집: 앞뒤 처마 아래 한 줄 + 지붕 양옆 선 ──
  const D = HOUSE_DIM;
  const y0 = 1.74;
  const e = D.eaveZ;
  LOCAL_SLOTS.forEach((lot, i) => {
    const h = hash01(i, 77);
    // 집마다 전구 색: 알록달록(대부분), 따뜻한 흰색, 한 가지 색
    const palette = h < 0.62 ? LED_COLORS : h < 0.84 ? [WARM] : [LED_COLORS[Math.floor(hash01(i, 78) * LED_COLORS.length)], WARM];
    const at = (lx: number, ly: number, lz: number, k: number) => {
      const hz = lz + HOUSE_OFFSET_Z;
      led(out, lot.x + rotX(lx, hz, lot.rot), GROUND_Y + ly, lot.z + rotZ(lx, hz, lot.rot), palette[k % palette.length], hash01(i * 64 + k, 79));
    };
    let k = 0;
    const half = (D.width + 0.42) / 2;
    for (const side of [1, -1]) {
      for (let j = 0; j <= 8; j++) at(-half + (j / 8) * half * 2, y0 - 0.17 + (j % 2 ? -0.05 : 0), side * (e + 0.02), k++);
    }
    // 지붕 옆선: (±e, y0) → 조절점 (±0.88, 2.78) → (0, 마루) 곡선을 따라
    const gx = (D.width + 0.5) / 2 + 0.03;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        for (let j = 1; j <= 4; j++) {
          const t = j / 4.4;
          const u = 1 - t;
          const zz = sz * (u * u * e + 2 * u * t * 0.88);
          const yy = u * u * y0 + 2 * u * t * 2.78 + t * t * D.ridge;
          at(sx * gx, yy + 0.06, zz, k++);
        }
      }
      at(sx * gx, D.ridge + 0.1, 0, k++);
    }
  });

  // ── 나무 ──
  const baubleRnd = mulberry32(2025);
  const addBaubles = (x: number, z: number, scale: number, blobs: ReadonlyArray<[number, number, number, number]> | null, tiers: ReadonlyArray<[number, number, number]> | null, squash: number, yBot: number, yTop: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const y = yBot + baubleRnd() * (yTop - yBot);
      const a = baubleRnd() * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const d = blobs ? blobExit(blobs, squash, y, dx, dz) : coneExit(tiers!, y);
      if (d <= 0) continue;
      const rr = (d - 0.02) * scale;
      parts.push(...props.bauble(x + dx * rr, GROUND_Y + y * scale - 0.12 * scale, z + dz * rr, 0.17 * scale, BAUBLE_COLORS[k % BAUBLE_COLORS.length]));
    }
  };
  const addStar = (x: number, y: number, z: number, size: number) => {
    const g = props.star(size);
    g.translate(x, GROUND_Y + y, z);
    parts.push(g);
  };

  for (const s of ZONE_SCENERY) {
    const sc = s.scale;
    if (s.kind === 'bigTree') {
      const ex = (y: number, dx: number, dz: number) => blobExit(props.BIG_TREE_LEAVES, props.BIG_TREE_SQUASH, y, dx, dz);
      garland(out, s.x, s.z, sc, 3.0, 6.4, 3.2, 64, ex, LED_COLORS, s.seed + 11);
      addBaubles(s.x, s.z, sc, props.BIG_TREE_LEAVES, null, props.BIG_TREE_SQUASH, 3.2, 6.2, 22);
      addStar(s.x, 6.95 * sc, s.z, 0.55 * sc);
    } else if (s.kind === 'plazaTree') {
      const ex = (y: number, dx: number, dz: number) => blobExit(props.PLAZA_TREE_LEAVES, props.PLAZA_TREE_SQUASH, y, dx, dz);
      garland(out, s.x, s.z, sc, 2.3, 4.9, 2.6, 40, ex, [WARM, '#ff4b4b'], s.seed + 12);
      addStar(s.x, 5.4 * sc, s.z, 0.42 * sc);
    } else if (s.kind === 'townTree') {
      const tiers = props.TOWN_TREE_TIERS;
      garland(out, s.x, s.z, sc, 1.0, props.TOWN_TREE_TOP - 0.3, 6, 120, (y) => coneExit(tiers, y), LED_COLORS, 77);
      garland(out, s.x, s.z, sc, 1.2, props.TOWN_TREE_TOP - 0.5, -4, 70, (y) => coneExit(tiers, y), [WARM], 78);
      addBaubles(s.x, s.z, sc, null, tiers, 1, 1.2, 6.2, 34);
      addStar(s.x, props.TOWN_TREE_TOP + 0.45, s.z, 0.7);
      // 트리 밑 선물 상자
      const gr = mulberry32(99);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + gr() * 0.4;
        const r = 2.55 + gr() * 0.35;
        const w = 0.45 + gr() * 0.3;
        const g = props.gift(w, w * (0.7 + gr() * 0.4), w * (0.8 + gr() * 0.3), BAUBLE_COLORS[k % BAUBLE_COLORS.length], k % 2 ? '#fff4d6' : '#3ee07a');
        for (const piece of g) {
          piece.rotateY(a + gr());
          piece.translate(s.x + Math.cos(a) * r, GROUND_Y, s.z + Math.sin(a) * r);
        }
        parts.push(...g);
      }
    } else if (s.kind === 'coneTree') {
      const tiers = props.coneTreeTiers(s.seed);
      const top = tiers[2][2] + tiers[2][1];
      garland(out, s.x, s.z, sc, tiers[0][2] + 0.1, top - 0.25, 2.4, 14, (y) => coneExit(tiers, y), hash01(s.seed, 3) < 0.5 ? LED_COLORS : [WARM], s.seed);
    } else if (s.kind === 'roundTree') {
      // 동글 나무는 반만 (전부 두르면 너무 번쩍인다)
      if (hash01(s.seed, 4) < 0.5) continue;
      const { h, r } = props.roundTreeShape(s.seed);
      const blobs: Array<[number, number, number, number]> = [
        [r, 0, h + r * 0.62, 0],
        [r * 0.66, r * 0.55, h + r * 0.35, r * 0.2],
        [r * 0.6, -r * 0.5, h + r * 0.45, -r * 0.25],
      ];
      garland(out, s.x, s.z, sc, h + 0.15, h + r * 1.3, 1.6, 10, (y, dx, dz) => blobExit(blobs, 0.9, y, dx, dz), LED_COLORS, s.seed);
    }
  }

  const leds = new THREE.BufferGeometry();
  leds.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  leds.setAttribute('aColor', new THREE.Float32BufferAttribute(out.col, 3));
  leds.setAttribute('aPhase', new THREE.Float32BufferAttribute(out.phase, 1));
  leds.computeBoundingSphere();
  return { decor: mergeParts(parts, GLOW_ATTRS), leds };
}

/** LED 전구 재질 (모든 구역이 같이 쓴다). 낮에는 작은 색 구슬, 밤에는 반짝이며 빛난다 */
export function createLedMaterial(shared: { uTime: { value: number }; uNight: { value: number } }, uScale: { value: number }) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uNight: shared.uNight, uScale },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      uniform float uTime;
      uniform float uNight;
      uniform float uScale;
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 천천히 숨 쉬듯 깜빡인다 (전구마다 박자가 다르다)
        float tw = 0.55 + 0.45 * sin(uTime * (1.3 + aPhase * 1.7) + aPhase * 40.0);
        vGlow = uNight * tw;
        vColor = aColor;
        float size = mix(0.2, 0.5, uNight) * uScale / -mv.z;
        gl_PointSize = clamp(size, mix(1.2, 2.2, uNight), mix(6.0, 16.0, uNight));
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        // 낮: 또렷한 구슬. 밤: 밝은 심지 + 번지는 빛
        float core = smoothstep(mix(0.95, 0.42, vGlow), 0.0, d);
        float halo = (1.0 - d) * (1.0 - d) * vGlow;
        vec3 col = vColor * (0.85 + 1.1 * vGlow) + vec3(1.0) * core * vGlow * 0.55;
        float a = max(core, halo * 0.75);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * 내리는 눈. 카메라가 보는 곳 둘레의 상자 안에만 있고, 눈송이는 세계에 붙어 있어서
 * 카메라가 움직여도 같이 미끄러지지 않는다 (상자 밖으로 나간 것은 반대쪽에서 다시 나온다).
 */
export class Snowfall {
  readonly points: THREE.Points;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(80, 30, 80) },
    uScale: { value: 600 },
    uOpacity: { value: 0.7 },
  };
  private readonly max: number;

  constructor(count = 900) {
    this.max = count;
    const rnd = mulberry32(31);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd();
      pos[i * 3 + 1] = rnd();
      pos[i * 3 + 2] = rnd();
      seed[i] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform float uScale;
        varying float vA;
        void main() {
          float fall = 0.9 + aSeed * 0.8;
          // 세계 좌표에 붙은 눈송이: 상자 크기로 감싸서 가운데 둘레에 오게 한다
          vec3 w = position * uBox;
          w.y -= uTime * fall;
          w.x += uTime * 0.35 + sin(uTime * 0.7 + aSeed * 30.0) * 0.6;
          w.z += cos(uTime * 0.5 + aSeed * 20.0) * 0.5;
          vec3 p;
          p.x = uCenter.x + (fract((w.x - uCenter.x) / uBox.x + 0.5) - 0.5) * uBox.x;
          p.z = uCenter.z + (fract((w.z - uCenter.z) / uBox.z + 0.5) - 0.5) * uBox.z;
          p.y = uCenter.y + (fract(w.y / uBox.y) - 0.5) * uBox.y;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          // 카메라 바로 앞은 지우고(화면을 가리지 않게), 너무 먼 것도 옅게
          vA = smoothstep(2.5, 7.0, d) * (1.0 - smoothstep(uBox.x * 0.36, uBox.x * 0.5, length(p.xz - uCenter.xz)));
          vA *= 0.55 + 0.45 * aSeed;
          gl_PointSize = clamp((0.09 + aSeed * 0.07) * uScale / d, 1.0, 7.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.25, d) * vA * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0), a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  resize(viewportHpx: number, fovDeg: number) {
    this.uniforms.uScale.value = viewportHpx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  /** 품질이 낮으면 눈송이 수를 줄인다 (0~1) */
  setDensity(f: number) {
    this.points.geometry.setDrawRange(0, Math.max(60, Math.floor(this.max * f)));
  }

  /** target: 카메라가 보는 곳, dist: 카메라 거리, night: 0~1 */
  update(dt: number, camera: THREE.Camera, target: { x: number; z: number; dist: number }, night: number) {
    const u = this.uniforms;
    u.uTime.value += dt;
    const d = target.dist;
    // 동네 시점에서 가장 잘 보이고, 아주 멀리서는 숨긴다
    const w = THREE.MathUtils.clamp(d * 1.25, 26, 150);
    const h = THREE.MathUtils.clamp(d * 0.55, 12, 60);
    u.uBox.value.set(w, h, w);
    // 카메라와 보는 곳 사이에 상자를 둔다 (멀리 보이는 곳까지 덮게)
    const cx = camera.position.x * 0.35 + target.x * 0.65;
    const cz = camera.position.z * 0.35 + target.z * 0.65;
    u.uCenter.value.set(cx, GROUND_Y + h * 0.5, cz);
    u.uOpacity.value = (0.5 + 0.3 * night) * (1 - THREE.MathUtils.smoothstep(d, 220, 320));
    this.points.visible = u.uOpacity.value > 0.01;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
