import * as THREE from 'three';
import { FOUNDER_MAX, REGIONS } from '../../shared/config';
import type { RegionId } from '../../shared/types';

/**
 * 집 위 이름표. 가까운 집 몇십 개만 보여준다.
 * 이름표를 전부 큰 그림 한 장(아틀라스)에 그려 두고 네모판 여러 개를 한 번에 그린다 (그리기 1번).
 * 화면에서는 항상 같은 크기로 보인다.
 *
 * 이름표 모양: [★ @아이디  ● 지역명]  (★과 금색 테두리는 창립 주민만)
 */
const SLOT_W = 512;
const SLOT_H = 64;
const COLS = 2;
const ROWS = 16;
export const LABEL_CAPACITY = COLS * ROWS;
/** 아틀라스 픽셀 → 화면 픽셀 비율 */
const ATLAS_SCALE = 0.56;
const FONT_MAIN = '700 27px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';
const FONT_SUB = '600 21px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

const REGION_BY_ID = new Map<string, { label: string; color: string; index: number }>();
REGIONS.forEach((r, index) => REGION_BY_ID.set(r.id, { label: r.label, color: r.color, index }));
export const regionIndex = (id: RegionId | null | undefined) => (id ? (REGION_BY_ID.get(id)?.index ?? -2) : -2);
export const regionInfo = (id: RegionId | null | undefined) => (id ? REGION_BY_ID.get(id) : undefined);

export interface LabelEntry {
  houseNo: number;
  handle: string;
  region: RegionId;
  x: number;
  y: number;
  z: number;
}

export class LabelLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly anchor: THREE.InstancedBufferAttribute;
  private readonly uv: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private readonly info: THREE.InstancedBufferAttribute;
  /** 이름표마다의 크기 배율 (걷기 모드에서 가까운 집일수록 크게) */
  private readonly grow: THREE.InstancedBufferAttribute;
  private focus: { x: number; z: number } | null = null;
  private focusDirty = false;
  private readonly uniforms: {
    uMap: { value: THREE.Texture };
    uViewport: { value: THREE.Vector2 };
    uScale: { value: number };
    uOpacity: { value: number };
    uRegion: { value: THREE.Vector2 };
  };
  /** 자리마다 지금 그려져 있는 이름표 (같은 내용이면 다시 그리지 않는다) */
  private readonly slotKey: string[] = new Array(LABEL_CAPACITY).fill('');
  private readonly slotWidth: number[] = new Array(LABEL_CAPACITY).fill(0);
  private readonly slotOfHouse = new Map<number, number>();

  constructor(shared: { uRegion: { value: THREE.Vector2 } }) {
    this.canvas.width = SLOT_W * COLS;
    this.canvas.height = SLOT_H * ROWS;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.anchor = new THREE.InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY * 3), 3);
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY * 4), 4);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY * 2), 2);
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY), 1);
    geo.setAttribute('iAnchor', this.anchor);
    geo.setAttribute('iUv', this.uv);
    geo.setAttribute('iSize', this.size);
    geo.setAttribute('iRegion', this.info);
    this.grow = new THREE.InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY).fill(1), 1);
    this.grow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iGrow', this.grow);

    this.uniforms = {
      uMap: { value: this.texture },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uScale: { value: 1 },
      uOpacity: { value: 1 },
      uRegion: shared.uRegion,
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        attribute vec3 iAnchor;
        attribute vec4 iUv;
        attribute vec2 iSize;
        attribute float iRegion;
        attribute float iGrow;
        uniform vec2 uViewport;
        uniform float uScale;
        uniform vec2 uRegion;
        varying vec2 vUv;
        varying float vDim;
        varying float vFade;
        void main() {
          vUv = iUv.xy + uv * iUv.zw;
          vDim = step(0.5, abs(iRegion - uRegion.x)) * uRegion.y;
          vec4 clip = projectionMatrix * viewMatrix * vec4(iAnchor, 1.0);
          vFade = smoothstep(0.5, 0.66, iGrow);
          clip.xy += position.xy * iSize * uScale * iGrow * 2.0 / uViewport * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vDim;
        varying float vFade;
        void main() {
          vec4 c = texture2D(uMap, vUv);
          gl_FragColor = vec4(c.rgb, c.a * uOpacity * vFade * (1.0 - 0.65 * vDim));
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, material, LABEL_CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = 0;
  }

  /** 보여줄 이름표 목록을 바꾼다 (앞에서부터 LABEL_CAPACITY 개까지) */
  set(entries: LabelEntry[]) {
    const list = entries.slice(0, LABEL_CAPACITY);
    // 계속 보이는 집은 자리를 그대로 쓰고, 새로 들어온 집만 빈자리에 그린다
    const keep = new Set(list.map((e) => e.houseNo));
    const free: number[] = [];
    for (const [houseNo, slot] of this.slotOfHouse) {
      if (!keep.has(houseNo)) {
        this.slotOfHouse.delete(houseNo);
      } else void slot;
    }
    const used = new Set(this.slotOfHouse.values());
    for (let s = 0; s < LABEL_CAPACITY; s++) if (!used.has(s)) free.push(s);
    let dirty = false;
    list.forEach((e, i) => {
      let slot = this.slotOfHouse.get(e.houseNo);
      if (slot === undefined) {
        slot = free.pop()!;
        this.slotOfHouse.set(e.houseNo, slot);
      }
      const key = `${e.houseNo}|${e.handle}|${e.region}`;
      if (this.slotKey[slot] !== key) {
        this.slotWidth[slot] = this.draw(slot, e);
        this.slotKey[slot] = key;
        dirty = true;
      }
      const w = this.slotWidth[slot];
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
      this.anchor.setXYZ(i, e.x, e.y, e.z);
      // 캔버스는 위가 0이라 v 를 뒤집어 넣는다
      this.uv.setXYZW(i, (col * SLOT_W) / this.canvas.width, 1 - ((row + 1) * SLOT_H) / this.canvas.height, w / this.canvas.width, SLOT_H / this.canvas.height);
      this.size.setXY(i, w * ATLAS_SCALE, SLOT_H * ATLAS_SCALE);
      this.info.setX(i, regionIndex(e.region));
    });
    this.mesh.count = list.length;
    this.anchor.needsUpdate = true;
    this.uv.needsUpdate = true;
    this.size.needsUpdate = true;
    this.info.needsUpdate = true;
    if (dirty) this.texture.needsUpdate = true;
  }

  /**
   * 걷기 모드: 이 점(내 고양이)에 가까운 집의 이름표는 크게, 먼 집은 작게 그린다.
   * null 이면 전부 같은 크기.
   */
  setFocus(at: { x: number; z: number } | null) {
    if (!at && this.focus) this.focusDirty = true;
    this.focus = at;
  }

  /** viewportW/H 는 CSS 픽셀 */
  update(viewportW: number, viewportH: number, scale: number, opacity: number) {
    if (this.focus) {
      const n = this.mesh.count;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(this.anchor.getX(i) - this.focus.x, this.anchor.getZ(i) - this.focus.z);
        const t = Math.min(1, Math.max(0, (d - 6) / 30));
        this.grow.setX(i, 1.12 - 0.62 * t * t * (3 - 2 * t));
      }
      this.grow.needsUpdate = true;
    } else if (this.focusDirty) {
      for (let i = 0; i < LABEL_CAPACITY; i++) this.grow.setX(i, 1);
      this.grow.needsUpdate = true;
      this.focusDirty = false;
    }
    this.uniforms.uViewport.value.set(viewportW, viewportH);
    this.uniforms.uScale.value = scale;
    this.uniforms.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.01 && this.mesh.count > 0;
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /** 한 자리에 이름표를 그리고, 실제로 쓴 폭(px)을 돌려준다 */
  private draw(slot: number, e: LabelEntry): number {
    const ctx = this.ctx;
    const x0 = (slot % COLS) * SLOT_W;
    const y0 = Math.floor(slot / COLS) * SLOT_H;
    ctx.clearRect(x0, y0, SLOT_W, SLOT_H);
    const founder = e.houseNo <= FOUNDER_MAX;
    const region = regionInfo(e.region);
    const pad = 20;
    const margin = 5;
    const pillH = 44;
    const tail = 9;

    ctx.font = FONT_SUB;
    const regionText = region?.label ?? '';
    const regionW = regionText ? Math.ceil(ctx.measureText(regionText).width) + 26 : 0;
    const starW = founder ? 30 : 0;
    ctx.font = FONT_MAIN;
    const maxHandleW = SLOT_W - margin * 2 - pad * 2 - starW - regionW;
    let handle = `@${e.handle}`;
    if (ctx.measureText(handle).width > maxHandleW) {
      while (handle.length > 2 && ctx.measureText(`${handle}…`).width > maxHandleW) handle = handle.slice(0, -1);
      handle += '…';
    }
    const handleW = Math.ceil(ctx.measureText(handle).width);
    const w = pad * 2 + starW + handleW + regionW;
    const total = w + margin * 2;
    const px = x0 + margin;
    const py = y0 + margin;

    const body = new Path2D();
    body.roundRect(px, py, w, pillH, pillH / 2);
    const cx = x0 + total / 2;
    body.moveTo(cx - 9, py + pillH - 1);
    body.lineTo(cx, py + pillH + tail);
    body.lineTo(cx + 9, py + pillH - 1);
    body.closePath();
    ctx.save();
    ctx.shadowColor = 'rgba(70, 50, 30, 0.3)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.5;
    ctx.fillStyle = '#ffffff';
    ctx.fill(body);
    ctx.restore();
    if (founder) {
      const grad = ctx.createLinearGradient(0, py, 0, py + pillH);
      grad.addColorStop(0, '#ffd966');
      grad.addColorStop(1, '#f0a93a');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      const ring = new Path2D();
      ring.roundRect(px + 2, py + 2, w - 4, pillH - 4, pillH / 2 - 2);
      ctx.stroke(ring);
    }

    ctx.textBaseline = 'middle';
    let tx = px + pad;
    const midY = py + pillH / 2 + 1.5;
    if (founder) {
      ctx.fillStyle = '#f2ab2e';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? 11.5 : 5.5;
        ctx.lineTo(tx + 10 + Math.cos(a) * rr, midY - 1 + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      tx += starW;
    }
    ctx.font = FONT_MAIN;
    ctx.fillStyle = '#5b4636';
    ctx.fillText(handle, tx, midY);
    tx += handleW;
    if (region) {
      // 지역: 깃발과 같은 색 점 + 작은 글씨
      ctx.fillStyle = region.color;
      ctx.beginPath();
      ctx.arc(tx + 15, midY - 1, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = FONT_SUB;
      ctx.fillStyle = '#93826f';
      ctx.fillText(regionText, tx + 25, midY);
    }
    return total;
  }
}
