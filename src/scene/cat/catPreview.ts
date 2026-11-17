import * as THREE from 'three';
import type { CatLook } from '../../shared/types';
import { CatFlock } from './CatFlock';
import type { CatModel } from './catModel';

/**
 * 고양이 한 마리를 작은 그림(PNG, 배경 투명)으로 찍어 준다. 입양 카드처럼 3D 씬 밖의 화면에 쓴다.
 * 섬을 그리는 것과 같은 WebGL 을 잠깐 빌려서 화면 밖(렌더 타깃)에 그리므로 WebGL 을 하나 더 만들지 않는다.
 * 같은 고양이를 다시 찍으면 전에 만든 그림을 돌려준다.
 */
export interface CatPreviewOptions {
  /** 그 집 번호의 고양이와 같은 얼룩이 나오게 한다 (마당 고양이와 같은 모습) */
  houseNo?: number;
  /** 'sit' 이면 식빵 자세 */
  pose?: 'stand' | 'sit';
  /** 몸을 튼 각도 (라디안. 0 이면 정면, 기본 0.4 = 살짝 옆) */
  yaw?: number;
}

const CACHE_MAX = 24;

export class CatPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(24, 1, 0.5, 20);
  private readonly flock: CatFlock;
  private readonly cache = new Map<string, string>();
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly clear = new THREE.Color();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    model: CatModel,
    /** 고양이 재질이 쓰는 시계 (찍는 동안만 눈을 뜬 순간으로 맞춘다) */
    private readonly shared: { uTime: { value: number } },
  ) {
    this.flock = new CatFlock(model, 1, 'high');
    this.flock.mesh.castShadow = false;
    this.flock.mesh.receiveShadow = false;
    this.flock.count = 1;
    const hemi = new THREE.HemisphereLight('#fff8ee', '#e8d6c4', 2.05);
    const key = new THREE.DirectionalLight('#fff3e0', 1.5);
    key.position.set(-2.2, 3.4, 4);
    this.scene.add(this.flock.mesh, hemi, key);
    this.camera.position.set(0, 0.74, 3.25);
    this.camera.lookAt(0, 0.47, 0);
    this.camera.updateMatrixWorld();
  }

  /** @returns PNG 의 data URL. 그릴 수 없으면(WebGL 이 끊긴 동안) 빈 글자 */
  render(look: CatLook, size: number, opts: CatPreviewOptions, seedOf: (houseNo: number) => number): string {
    size = Math.max(32, Math.min(512, Math.round(size)));
    const yaw = opts.yaw ?? 0.4;
    const sit = opts.pose === 'sit' ? 1 : 0;
    const key = `${look.fur}|${look.pattern}|${look.eyeColor}|${size}|${opts.houseNo ?? ''}|${sit}|${yaw}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const renderer = this.renderer;
    if (renderer.getContext().isContextLost()) return '';

    // 작게 쓸 그림은 두 배로 찍어서 줄인다 (가장자리가 매끈해진다)
    const px = size <= 256 ? size * 2 : size;
    if (!this.target || this.target.width !== px) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(px, px, { samples: 4, depthBuffer: true });
    }
    const seed = opts.houseNo !== undefined ? seedOf(opts.houseNo) : 0.37;
    this.flock.setLook(0, look, seed);
    this.flock.setMood(0, sit, 0);
    this.flock.setAnim(0, 0, 0, 0, 0);
    this.flock.setPose(0, 0, sit ? 0.05 : 0, 0, yaw, 1);

    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    const buf = new Uint8Array(px * px * 4);
    // 눈을 깜빡이는 순간에 찍히지 않게, 이 고양이가 눈을 뜨고 있는 시각으로 잠깐 맞춘다 (catMaterial 의 깜빡임 주기와 같은 식)
    const prevTime = this.shared.uTime.value;
    const period = 3.2 + (4.6 - 3.2) * seed;
    this.shared.uTime.value = period * 4.15 - seed * 9.7;
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      renderer.readRenderTargetPixels(this.target, 0, 0, px, px, buf);
    } finally {
      this.shared.uTime.value = prevTime;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(this.clear, prevAlpha);
    }

    // 렌더 타깃은 선형 색이고 아래 줄부터 담겨 있다 → sRGB 로 바꾸고 위아래를 뒤집는다
    const big = document.createElement('canvas');
    big.width = big.height = px;
    const ctx = big.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(px, px);
    const out = img.data;
    for (let y = 0; y < px; y++) {
      const src = (px - 1 - y) * px * 4;
      const dst = y * px * 4;
      for (let x = 0; x < px * 4; x += 4) {
        const a = buf[src + x + 3];
        if (a === 0) continue;
        // 가장자리는 투명도가 곱해진 값이라 되나눈다
        const k = 255 / a;
        out[dst + x] = TO_SRGB[Math.min(255, Math.round(buf[src + x] * k))];
        out[dst + x + 1] = TO_SRGB[Math.min(255, Math.round(buf[src + x + 1] * k))];
        out[dst + x + 2] = TO_SRGB[Math.min(255, Math.round(buf[src + x + 2] * k))];
        out[dst + x + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    let canvas = big;
    if (px !== size) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const c2 = canvas.getContext('2d')!;
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(big, 0, 0, size, size);
    }
    const url = canvas.toDataURL('image/png');
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, url);
    return url;
  }

  dispose() {
    this.target?.dispose();
    this.flock.dispose();
    this.cache.clear();
  }
}

/** 선형 색(0~255) → sRGB(0~255) */
const TO_SRGB = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  TO_SRGB[i] = Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}
