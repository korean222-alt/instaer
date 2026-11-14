import * as THREE from 'three';
import type { CatLook } from '../../shared/types';
import type { CatModel } from './catModel';
import { PATTERN_INDEX } from './catMaterial';

/**
 * 고양이 여러 마리를 한 번에 그린다 (InstancedMesh, 그리기 1번).
 * 자리(slot) 번호로 한 마리씩 다룬다.
 */
export class CatFlock {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private readonly fur: THREE.InstancedBufferAttribute;
  private readonly eye: THREE.InstancedBufferAttribute;
  private readonly pat: THREE.InstancedBufferAttribute;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(model: CatModel, capacity: number, detail: 'high' | 'low' | 'tiny' = 'high') {
    this.capacity = capacity;
    // 마리별 속성을 붙이려고 모양을 복사해서 쓴다
    const base =
      detail === 'tiny'
        ? (model.tinyGeometry ?? model.lowGeometry ?? model.geometry)
        : detail === 'low' && model.lowGeometry
          ? model.lowGeometry
          : model.geometry;
    const geo = base.clone();
    this.fur = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.eye = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.pat = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iFur', this.fur);
    geo.setAttribute('iEye', this.eye);
    geo.setAttribute('iPat', this.pat);
    geo.setAttribute('iAnim', this.anim);

    this.mesh = new THREE.InstancedMesh(geo, model.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (model.depthMaterial) this.mesh.customDepthMaterial = model.depthMaterial;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  set count(n: number) {
    this.mesh.count = Math.min(n, this.capacity);
  }
  get count() {
    return this.mesh.count;
  }

  /** 겉모습 (털 색, 무늬, 눈 색). seed 는 0~1, 같은 번지는 항상 같은 값 */
  setLook(slot: number, look: CatLook, seed: number) {
    this.c.set(look.fur);
    this.fur.setXYZ(slot, this.c.r, this.c.g, this.c.b);
    this.c.set(look.eyeColor);
    this.eye.setXYZ(slot, this.c.r, this.c.g, this.c.b);
    this.pat.setXYZW(slot, PATTERN_INDEX[look.pattern] ?? 0, seed, 0, 0);
    this.fur.needsUpdate = true;
    this.eye.needsUpdate = true;
    this.pat.needsUpdate = true;
  }

  /**
   * setLook 과 같지만 미리 바꿔 둔 색을 그대로 쓴다 (매 프레임 자리를 다시 채울 때 쓴다).
   * sit, yawn 도 같이 넣는다.
   */
  setLookRaw(slot: number, fur: THREE.Color, eye: THREE.Color, pattern: number, seed: number, sit: number, yawn: number) {
    this.fur.setXYZ(slot, fur.r, fur.g, fur.b);
    this.eye.setXYZ(slot, eye.r, eye.g, eye.b);
    this.pat.setXYZW(slot, pattern, seed, sit, yawn);
    this.fur.needsUpdate = true;
    this.eye.needsUpdate = true;
    this.pat.needsUpdate = true;
  }

  /** 위치와 바라보는 방향(yaw, 라디안. 0이면 +z) */
  setPose(slot: number, x: number, y: number, z: number, yaw: number, scale: number) {
    this.q.setFromAxisAngle(CatFlock.UP, yaw);
    this.m.compose(this.v.set(x, y, z), this.q, this.s.setScalar(scale));
    this.mesh.setMatrixAt(slot, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 앉은 정도(식빵 자세)와 하품 (0~1). 내가 조작하는 고양이에만 쓴다 */
  setMood(slot: number, sit: number, yawn: number) {
    this.pat.setZ(slot, sit);
    this.pat.setW(slot, yawn);
    this.pat.needsUpdate = true;
  }

  /** 움직임 상태 */
  setAnim(slot: number, walkPhase: number, walk: number, sleep: number, happy = 0) {
    this.anim.setXYZW(slot, walkPhase, walk, sleep, happy);
    this.anim.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}
