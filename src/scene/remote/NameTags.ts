import * as THREE from 'three';

/**
 * 다른 유저 고양이 머리 위 이름표 (@아이디).
 * 그림 한 장(아틀라스)에 이름표를 그려 두고 네모판 여러 개를 한 번에 그린다 (그리기 1번).
 * 집 이름표(흰색)와 헷갈리지 않게 짙은 바탕에 흰 글씨다.
 *
 * 자리(slot)는 빌려 쓰고 돌려주는 방식이라 유저가 들락거려도 새로 만드는 것이 없다.
 */
const SLOT_W = 288;
const SLOT_H = 48;
const COLS = 2;
const ROWS = 8;
export const TAG_SLOTS = COLS * ROWS;
/** 아틀라스 픽셀 → 화면 픽셀 비율 */
const ATLAS_SCALE = 0.56;
const FONT = '700 23px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

export class NameTags {
  readonly mesh: THREE.InstancedMesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly anchor: THREE.InstancedBufferAttribute;
  private readonly uv: THREE.InstancedBufferAttribute;
  /** x, y = 화면 크기(px), z = 크기 배율, w = 투명도 */
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly viewport = new THREE.Vector2(1, 1);
  private readonly slotText: string[] = new Array(TAG_SLOTS).fill('');
  private readonly slotWidth: number[] = new Array(TAG_SLOTS).fill(0);
  private readonly slotUsed: boolean[] = new Array(TAG_SLOTS).fill(false);
  private n = 0;

  constructor() {
    this.canvas.width = SLOT_W * COLS;
    this.canvas.height = SLOT_H * ROWS;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.anchor = new THREE.InstancedBufferAttribute(new Float32Array(TAG_SLOTS * 3), 3);
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(TAG_SLOTS * 4), 4);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(TAG_SLOTS * 4), 4);
    for (const a of [this.anchor, this.uv, this.look]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnchor', this.anchor);
    geo.setAttribute('iUv', this.uv);
    geo.setAttribute('iLook', this.look);

    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.texture }, uViewport: { value: this.viewport } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        attribute vec3 iAnchor;
        attribute vec4 iUv;
        attribute vec4 iLook;
        uniform vec2 uViewport;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = iUv.xy + uv * iUv.zw;
          vAlpha = iLook.w;
          vec4 clip = projectionMatrix * viewMatrix * vec4(iAnchor, 1.0);
          clip.xy += position.xy * iLook.xy * iLook.z * 2.0 / uViewport * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec4 c = texture2D(uMap, vUv);
          gl_FragColor = vec4(c.rgb, c.a * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, material, TAG_SLOTS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 이름표 자리를 하나 빌린다. 빈자리가 없으면 -1 */
  take(handle: string): number {
    // 같은 글자가 그려진 채 비어 있는 자리가 있으면 다시 그리지 않고 그대로 쓴다
    let slot = -1;
    for (let s = 0; s < TAG_SLOTS; s++) {
      if (this.slotUsed[s]) continue;
      if (this.slotText[s] === handle) {
        slot = s;
        break;
      }
      if (slot < 0) slot = s;
    }
    if (slot < 0) return -1;
    this.slotUsed[slot] = true;
    if (this.slotText[slot] !== handle) {
      this.slotWidth[slot] = this.draw(slot, handle);
      this.slotText[slot] = handle;
      this.texture.needsUpdate = true;
    }
    return slot;
  }

  give(slot: number) {
    if (slot >= 0) this.slotUsed[slot] = false;
  }

  /** 한 프레임 분량을 채우기 시작한다 */
  begin() {
    this.n = 0;
  }

  /** grow: 크기 배율, alpha: 투명도 (0~1) */
  push(slot: number, x: number, y: number, z: number, grow: number, alpha: number) {
    if (slot < 0 || this.n >= TAG_SLOTS) return;
    const i = this.n++;
    const w = this.slotWidth[slot];
    this.anchor.setXYZ(i, x, y, z);
    // 캔버스는 위가 0이라 v 를 뒤집어 넣는다
    this.uv.setXYZW(
      i,
      ((slot % COLS) * SLOT_W) / this.canvas.width,
      1 - ((Math.floor(slot / COLS) + 1) * SLOT_H) / this.canvas.height,
      w / this.canvas.width,
      SLOT_H / this.canvas.height,
    );
    this.look.setXYZW(i, w * ATLAS_SCALE, SLOT_H * ATLAS_SCALE, grow, alpha);
  }

  /** viewportW/H 는 CSS 픽셀 */
  end(viewportW: number, viewportH: number) {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    this.viewport.set(viewportW, viewportH);
    this.anchor.needsUpdate = true;
    this.uv.needsUpdate = true;
    this.look.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /** 한 자리에 이름표를 그리고, 실제로 쓴 폭(px)을 돌려준다 */
  private draw(slot: number, handle: string): number {
    const ctx = this.ctx;
    const x0 = (slot % COLS) * SLOT_W;
    const y0 = Math.floor(slot / COLS) * SLOT_H;
    ctx.clearRect(x0, y0, SLOT_W, SLOT_H);
    const pad = 15;
    const margin = 4;
    const pillH = 36;
    ctx.font = FONT;
    const maxW = SLOT_W - margin * 2 - pad * 2;
    let text = `@${handle}`;
    if (ctx.measureText(text).width > maxW) {
      while (text.length > 2 && ctx.measureText(`${text}…`).width > maxW) text = text.slice(0, -1);
      text += '…';
    }
    const textW = Math.ceil(ctx.measureText(text).width);
    const w = textW + pad * 2;
    const px = x0 + margin;
    const py = y0 + (SLOT_H - pillH) / 2;
    ctx.fillStyle = 'rgba(74, 56, 44, 0.84)';
    ctx.beginPath();
    ctx.roundRect(px, py, w, pillH, pillH / 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(text, px + pad, py + pillH / 2 + 1.5);
    return w + margin * 2;
  }
}
