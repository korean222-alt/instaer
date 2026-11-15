import * as THREE from 'three';
import type { Drawing } from './types';

/**
 * 직접 그린 그림(32x32 픽셀, 16색) → 작은 텍스처.
 * 그림 하나가 512바이트(픽셀당 4비트)라서 아주 가볍다. 텍스처도 32x32 그대로 쓴다.
 */
export const DRAWING_SIZE = 32;
const PIXELS = DRAWING_SIZE * DRAWING_SIZE;
const BYTES = PIXELS / 2;

/** 팔레트가 없거나 잘못됐을 때 쓰는 16색 */
export const DEFAULT_PALETTE: readonly string[] = [
  '#fffdf6', '#5b4636', '#ff8f7a', '#f6a55c', '#ffd166', '#c5e17a', '#7fd8b0', '#5cc2b5',
  '#8fd3e8', '#7cc4f2', '#9fa8f0', '#b79cf0', '#ff9ec2', '#d9a37e', '#a8a29a', '#2e2a33',
];

/** 팔레트 순번(0~15) 1024개 → base64 (512바이트). 그리기 화면과 데모가 쓴다 */
export function encodeDrawing(indices: ArrayLike<number>): string {
  let bin = '';
  for (let i = 0; i < BYTES; i++) bin += String.fromCharCode(((indices[i * 2] & 15) << 4) | (indices[i * 2 + 1] & 15));
  return btoa(bin);
}

/** base64 → 팔레트 순번 1024개. 길이가 틀리거나 base64 가 아니면 null */
export function decodeDrawing(pixels: string): Uint8Array | null {
  let bin: string;
  try {
    bin = atob(pixels);
  } catch {
    return null;
  }
  if (bin.length !== BYTES) return null;
  const out = new Uint8Array(PIXELS);
  for (let i = 0; i < BYTES; i++) {
    const b = bin.charCodeAt(i);
    out[i * 2] = b >> 4;
    out[i * 2 + 1] = b & 15;
  }
  return out;
}

interface Entry {
  key: string;
  texture: THREE.DataTexture;
  material: THREE.MeshLambertMaterial | null;
  /** 벽지/바닥처럼 이어 붙여 쓰는 사본 */
  tiled: Map<string, THREE.Texture> | null;
}

export class DrawingStore {
  private readonly entries = new Map<string, Entry>();
  private readonly c = new THREE.Color();

  /** 지금 쓸 그림 전체. 목록에서 빠진 그림의 텍스처는 버린다. 바뀐 것이 있으면 true */
  set(drawings: readonly Drawing[]): boolean {
    let changed = false;
    const seen = new Set<string>();
    for (const d of drawings) {
      if (!d || typeof d.id !== 'string' || typeof d.pixels !== 'string') continue;
      const palette = Array.isArray(d.palette) && d.palette.length >= 16 ? d.palette : DEFAULT_PALETTE;
      const key = `${d.pixels}|${palette.slice(0, 16).join(',')}`;
      seen.add(d.id);
      const old = this.entries.get(d.id);
      if (old?.key === key) continue;
      const idx = decodeDrawing(d.pixels);
      if (!idx) continue;
      const entry = old ?? this.create();
      this.paint(entry.texture, idx, palette);
      entry.key = key;
      this.entries.set(d.id, entry);
      changed = true;
    }
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      this.free(e);
      this.entries.delete(id);
      changed = true;
    }
    return changed;
  }

  has(id: string | undefined): boolean {
    return id !== undefined && this.entries.has(id);
  }

  /** 그림을 붙인 재질 (액자, 간판, 러그용). 그림이 없으면 null */
  material(id: string | undefined): THREE.MeshLambertMaterial | null {
    const e = id === undefined ? undefined : this.entries.get(id);
    if (!e) return null;
    if (!e.material) {
      e.material = new THREE.MeshLambertMaterial({ map: e.texture, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    return e.material;
  }

  /** 벽지/바닥처럼 이어 붙여 쓰는 텍스처 (그림 한 장 = 1m). 그림이 없으면 null */
  tiled(id: string, slot: string): THREE.Texture | null {
    const e = this.entries.get(id);
    if (!e) return null;
    e.tiled ??= new Map();
    let t = e.tiled.get(slot);
    if (!t) {
      t = e.texture.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      e.tiled.set(slot, t);
    }
    t.needsUpdate = true;
    return t;
  }

  dispose() {
    for (const e of this.entries.values()) this.free(e);
    this.entries.clear();
  }

  private create(): Entry {
    const texture = new THREE.DataTexture(new Uint8Array(PIXELS * 4), DRAWING_SIZE, DRAWING_SIZE, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    // 가까이서는 픽셀이 또렷하게, 멀리서는 자글거리지 않게
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    return { key: '', texture, material: null, tiled: null };
  }

  private paint(texture: THREE.DataTexture, idx: Uint8Array, palette: readonly string[]) {
    const rgb = new Uint8Array(48);
    for (let i = 0; i < 16; i++) {
      // 잘못된 색 이름이면 기본 팔레트 색을 쓴다
      const hex = /^#[0-9a-f]{6}$/i.test(palette[i] ?? '') ? palette[i] : DEFAULT_PALETTE[i];
      this.c.set(hex);
      const v = this.c.getHex(THREE.SRGBColorSpace);
      rgb[i * 3] = v >> 16;
      rgb[i * 3 + 1] = (v >> 8) & 255;
      rgb[i * 3 + 2] = v & 255;
    }
    const data = texture.image.data as Uint8Array;
    for (let y = 0; y < DRAWING_SIZE; y++) {
      // 텍스처는 아래 줄부터 담으므로 위아래를 뒤집어 넣는다
      const row = (DRAWING_SIZE - 1 - y) * DRAWING_SIZE;
      for (let x = 0; x < DRAWING_SIZE; x++) {
        const k = idx[y * DRAWING_SIZE + x] * 3;
        const o = (row + x) * 4;
        data[o] = rgb[k];
        data[o + 1] = rgb[k + 1];
        data[o + 2] = rgb[k + 2];
        data[o + 3] = 255;
      }
    }
    texture.needsUpdate = true;
  }

  private free(e: Entry) {
    e.texture.dispose();
    if (e.tiled) for (const t of e.tiled.values()) t.dispose();
    e.material?.dispose();
  }
}
