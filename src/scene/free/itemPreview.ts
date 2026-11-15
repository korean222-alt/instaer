import * as THREE from 'three';
import { createGlowLambert, type GlowShared } from '../core/glowLambert';
import type { ItemGeometries } from './catalog';

/**
 * 꾸미기 아이템 하나를 작은 그림(PNG, 배경 투명)으로 찍는다 (상점, 꾸미기 아이템 줄).
 * 고양이 그림(CatPreview)처럼 섬과 같은 WebGL 로 화면 밖에 그린다. 같은 것은 다시 찍지 않는다.
 */
export class ItemPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly cache = new Map<string, string>();
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly clear = new THREE.Color();
  private readonly box = new THREE.Box3();
  private readonly center = new THREE.Vector3();
  private readonly sizeV = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly geometries: ItemGeometries,
    shared: GlowShared,
  ) {
    this.material = createGlowLambert(shared, { instanced: false });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    const hemi = new THREE.HemisphereLight('#fff8ee', '#d9c6b0', 2.2);
    const key = new THREE.DirectionalLight('#fff3e0', 1.6);
    key.position.set(-3, 5, 4);
    this.scene.add(this.mesh, hemi, key);
  }

  render(type: string, size: number): string {
    size = Math.max(32, Math.min(256, Math.round(size)));
    const key = `${type}|${size}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const renderer = this.renderer;
    if (renderer.getContext().isContextLost()) return '';
    let geo: THREE.BufferGeometry;
    try {
      geo = this.geometries.get(type);
    } catch {
      return '';
    }
    this.mesh.geometry = geo;
    this.mesh.rotation.y = -0.6;
    this.mesh.updateMatrixWorld(true);
    this.box.setFromObject(this.mesh);
    this.box.getCenter(this.center);
    this.box.getSize(this.sizeV);
    const radius = Math.max(0.3, this.sizeV.length() / 2);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.02;
    const dir = new THREE.Vector3(0, 0.55, 1).normalize();
    this.camera.position.copy(this.center).addScaledVector(dir, dist);
    this.camera.lookAt(this.center);
    this.camera.updateMatrixWorld();

    const px = size * 2;
    if (!this.target || this.target.width !== px) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(px, px, { samples: 4, depthBuffer: true });
    }
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    const buf = new Uint8Array(px * px * 4);
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      renderer.readRenderTargetPixels(this.target, 0, 0, px, px, buf);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(this.clear, prevAlpha);
    }
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
        const k = 255 / a;
        out[dst + x] = TO_SRGB[Math.min(255, Math.round(buf[src + x] * k))];
        out[dst + x + 1] = TO_SRGB[Math.min(255, Math.round(buf[src + x + 1] * k))];
        out[dst + x + 2] = TO_SRGB[Math.min(255, Math.round(buf[src + x + 2] * k))];
        out[dst + x + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    const small = document.createElement('canvas');
    small.width = small.height = size;
    const c2 = small.getContext('2d')!;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(big, 0, 0, size, size);
    const url = small.toDataURL('image/png');
    this.cache.set(key, url);
    return url;
  }

  dispose() {
    this.target?.dispose();
    this.material.dispose();
    this.cache.clear();
  }
}

const TO_SRGB = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  TO_SRGB[i] = Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}
