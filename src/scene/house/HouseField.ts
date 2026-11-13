import * as THREE from 'three';
import { createGlowLambert, type GlowShared } from '../core/glowLambert';
import { GROUND_Y, HOUSE_OFFSET_Z, YARD_WORLD } from '../world/constants';
import { buildHouseGeometry, buildYardGeometry, HOUSE_DIM } from './houseGeometry';

export interface HousePlacement {
  /** 마당 한가운데 위치 */
  x: number;
  z: number;
  roofColor: string;
  /** 빈 집이면 흐리게 */
  faded: boolean;
  /** 밤에 창문 불이 켜진 정도 (0~1) */
  lit: number;
}

/** 가까이에서 보는 집과 마당. 집 전체가 그리기 2번(집 + 마당)으로 끝난다 */
export class HouseField {
  readonly group = new THREE.Group();
  private readonly houses: THREE.InstancedMesh;
  private readonly yards: THREE.InstancedMesh;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly state: THREE.InstancedBufferAttribute;
  private readonly capacity: number;

  constructor(shared: GlowShared, capacity: number) {
    this.capacity = capacity;
    const material = createGlowLambert(shared, { instanced: true });
    const houseGeo = buildHouseGeometry();
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    houseGeo.setAttribute('iTint', this.tint);
    houseGeo.setAttribute('iState', this.state);
    this.houses = new THREE.InstancedMesh(houseGeo, material, capacity);

    const yardGeo = buildYardGeometry(YARD_WORLD, HOUSE_OFFSET_Z + HOUSE_DIM.depth / 2);
    const one = new Float32Array(capacity * 3).fill(1);
    yardGeo.setAttribute('iTint', new THREE.InstancedBufferAttribute(one, 3));
    yardGeo.setAttribute('iState', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
    this.yards = new THREE.InstancedMesh(yardGeo, material, capacity);

    for (const m of [this.houses, this.yards]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
  }

  set(list: HousePlacement[]) {
    const n = Math.min(list.length, this.capacity);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const h = list[i];
      m.makeTranslation(h.x, GROUND_Y, h.z + HOUSE_OFFSET_Z);
      this.houses.setMatrixAt(i, m);
      m.makeTranslation(h.x, GROUND_Y, h.z);
      this.yards.setMatrixAt(i, m);
      c.set(h.roofColor);
      this.tint.setXYZ(i, c.r, c.g, c.b);
      this.state.setXY(i, h.faded ? 1 : 0, h.lit);
    }
    this.houses.count = n;
    this.yards.count = n;
    this.houses.instanceMatrix.needsUpdate = true;
    this.yards.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.state.needsUpdate = true;
  }

  dispose() {
    this.houses.geometry.dispose();
    this.yards.geometry.dispose();
    (this.houses.material as THREE.Material).dispose();
  }
}
