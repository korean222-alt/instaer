import * as THREE from 'three';
import { createGlowLambert, type GlowShared } from '../core/glowLambert';
import { itemDef, type ItemGeometries } from './catalog';
import type { DrawingStore } from './drawings';
import { itemMatrix, type Space } from './space';
import type { PlacedItem } from './types';

/**
 * 자유롭게 놓은 아이템을 그린다.
 * - 종류마다 InstancedMesh 하나 (처음 쓰는 종류만 그때 만든다)
 * - 직접 그린 그림이 붙은 아이템은 그림마다 텍스처가 달라서 작은 네모를 하나씩 따로 그린다.
 *   그래서 가까운 집 것만, ART_MAX 장까지만 그린다.
 */
const ART_MAX = 64;
/** 풀밭 위에 살짝 띄운다 (기존 마당 아이템과 같은 값) */
export const YARD_LIFT = 0.035;

export interface FreeGroup {
  space: Space;
  items: readonly PlacedItem[];
}

interface Batch {
  mesh: THREE.InstancedMesh;
  capacity: number;
  count: number;
}

/** 그림을 붙이는 네모의 행렬 (아이템 행렬 x 그림 자리) */
const _art = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _none = new THREE.Quaternion();
export function artMatrix(itemMat: THREE.Matrix4, art: NonNullable<ReturnType<typeof itemDef>['art']>, out: THREE.Matrix4): THREE.Matrix4 {
  _art.compose(_pos.set(art.x, art.y, art.z), art.flat ? _flat : _none, _scale.set(art.size, art.size, 1));
  return out.multiplyMatrices(itemMat, _art);
}

export class FreeItems {
  readonly group = new THREE.Group();
  /** 확인용 */
  shown = 0;
  shownArt = 0;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly batches = new Map<string, Batch>();
  private readonly artGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly artMeshes: THREE.Mesh[] = [];
  private readonly m = new THREE.Matrix4();
  private last: readonly FreeGroup[] = [];
  private lastSkip: string | null = null;

  constructor(
    shared: GlowShared,
    private readonly geometries: ItemGeometries,
    private readonly drawings: DrawingStore,
    private readonly shadows = true,
  ) {
    this.material = createGlowLambert(shared, { instanced: false });
  }

  /** 그릴 아이템 전체를 다시 채운다. skipId 는 지금 손에 들고 있어서 따로 그리는 아이템 */
  set(groups: readonly FreeGroup[], skipId: string | null = null) {
    this.last = groups;
    this.lastSkip = skipId;
    for (const b of this.batches.values()) b.count = 0;
    let art = 0;
    let shown = 0;
    for (const g of groups) {
      const lift = g.space.kind === 'yard' ? YARD_LIFT : 0;
      for (const item of g.items) {
        if (item.id === skipId) continue;
        if (!Number.isFinite(item.x) || !Number.isFinite(item.z) || !Number.isFinite(item.rotY)) continue;
        const def = itemDef(item.type);
        // 벽에 거는 것은 집 안에서만 그린다
        if (def.mount === 'wall' && g.space.kind !== 'room') continue;
        const batch = this.batchFor(item.type);
        itemMatrix(g.space, item, lift, this.m);
        batch.mesh.setMatrixAt(batch.count++, this.m);
        shown++;
        if (def.art && art < ART_MAX) {
          const mat = this.drawings.material(item.drawingId);
          if (mat) {
            const mesh = (this.artMeshes[art] ??= this.makeArt());
            mesh.material = mat;
            artMatrix(this.m, def.art, mesh.matrix);
            mesh.visible = true;
            art++;
          }
        }
      }
    }
    for (const b of this.batches.values()) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      b.mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = art; i < this.artMeshes.length; i++) this.artMeshes[i].visible = false;
    this.shown = shown;
    this.shownArt = art;
  }

  /** 그림 목록이 바뀌었을 때: 같은 아이템으로 다시 채운다 */
  refresh() {
    this.set(this.last, this.lastSkip);
  }

  dispose() {
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear();
    this.artGeometry.dispose();
    this.material.dispose();
  }

  private makeArt(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.artGeometry);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.receiveShadow = this.shadows;
    this.group.add(mesh);
    return mesh;
  }

  private batchFor(type: string): Batch {
    const key = itemDef(type) === itemDef('\0') ? '?' : type;
    let b = this.batches.get(key);
    if (b && b.count < b.capacity) return b;
    // 자리가 모자라면 두 배로 늘린다
    const capacity = b ? b.capacity * 2 : 32;
    const mesh = new THREE.InstancedMesh(this.geometries.get(type), this.material, capacity);
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    mesh.frustumCulled = false;
    if (b) {
      (mesh.instanceMatrix.array as Float32Array).set((b.mesh.instanceMatrix.array as Float32Array).subarray(0, b.count * 16));
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    this.group.add(mesh);
    b = { mesh, capacity, count: b ? b.count : 0 };
    this.batches.set(key, b);
    return b;
  }
}
