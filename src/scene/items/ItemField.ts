import * as THREE from 'three';
import type { YardItem, YardItemType } from '../../shared/types';
import { YARD_SIZE } from '../../shared/config';
import { createGlowLambert, type GlowShared } from '../core/glowLambert';
import { CELL, GROUND_Y } from '../world/constants';
import { buildItemGeometry, ITEM_TYPES } from './itemGeometry';

/**
 * 마당 꾸미기 아이템. 종류마다 InstancedMesh 하나(그리기 8번)로 가까운 집들의 아이템을 전부 그린다.
 */
const CAPACITY_PER_TYPE = 160;

/** 마당 칸(0~5) → 마당 가운데 기준 좌표. 칸 y=0 이 뒤쪽(집 쪽), y=5 가 앞쪽(길 쪽) */
export const cellToLocal = (c: number) => (Math.min(YARD_SIZE - 1, Math.max(0, c)) - (YARD_SIZE - 1) / 2) * CELL;

export class ItemField {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<YardItemType, THREE.InstancedMesh>();
  private readonly material: THREE.MeshLambertMaterial;

  constructor(shared: GlowShared) {
    this.material = createGlowLambert(shared, { instanced: false });
    for (const type of ITEM_TYPES) {
      const mesh = new THREE.InstancedMesh(buildItemGeometry(type), this.material, CAPACITY_PER_TYPE);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.set(type, mesh);
      this.group.add(mesh);
    }
  }

  /** 가까운 집들의 아이템으로 다시 채운다 */
  set(yards: Array<{ x: number; z: number; rot?: number; items: YardItem[] | undefined }>) {
    const counts = new Map<YardItemType, number>();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    for (const yard of yards) {
      if (!yard.items) continue;
      for (const item of yard.items) {
        const mesh = this.meshes.get(item.type);
        if (!mesh) continue;
        const n = counts.get(item.type) ?? 0;
        if (n >= CAPACITY_PER_TYPE) continue;
        const rot = yard.rot ?? 0;
        const lx = cellToLocal(item.x);
        const lz = cellToLocal(item.y);
        q.setFromAxisAngle(up, rot - (item.rotation * Math.PI) / 180);
        pos.set(yard.x + lx * Math.cos(rot) + lz * Math.sin(rot), GROUND_Y + 0.035, yard.z - lx * Math.sin(rot) + lz * Math.cos(rot));
        mesh.setMatrixAt(n, m.compose(pos, q, one));
        counts.set(item.type, n + 1);
      }
    }
    for (const [type, mesh] of this.meshes) {
      mesh.count = counts.get(type) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.material.dispose();
  }
}
