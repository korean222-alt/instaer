import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createGlowLambert, GLOW_ATTRS, type GlowShared } from '../core/glowLambert';
import { fillAttr, mergeParts, paint } from '../util/geo';

/**
 * 고양이 자동차 (2026-11-16 사용자 요청: 아이들이 타는 붕붕카처럼).
 * 앞이 +z, 원점은 바닥 가운데. 앞자리(운전)와 뒷자리(같이 타기) 두 자리.
 * 보닛에 고양이 귀 두 개, 헤드라이트가 눈, 수염, 뒤에 꼬리 안테나.
 *
 * 내 차와 다른 유저 차를 InstancedMesh 하나로 그린다.
 */
/** 자리 높이와 앞뒤 위치 (고양이 발바닥이 놓이는 곳) */
export const CAR_SEAT_Y = 0.36;
export const CAR_FRONT_Z = 0.12;
export const CAR_BACK_Z = -0.62;
/** 자동차 빠르기 배수 */
export const CAR_SPEED = 1.75;

const pc = (g: THREE.BufferGeometry, color: string, glow = 0) => {
  paint(g, color);
  fillAttr(g, 'aMask', [0, glow]);
  return g;
};
const rbox = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, r = 0.08, glow = 0) =>
  pc(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)).translate(x, y, z), color, glow);

export function buildCarGeometry(): THREE.BufferGeometry {
  const body = '#ff9f6b';
  const dark = '#e9794f';
  const cream = '#fff4e2';
  const o: THREE.BufferGeometry[] = [];
  // 차체: 아래 통, 앞 보닛, 뒤 짐칸
  o.push(rbox(1.18, 0.3, 2.1, 0, 0.3, -0.15, body, 0.14));
  o.push(rbox(1.06, 0.26, 0.62, 0, 0.5, 0.62, body, 0.12));
  // 자리 두 개 (방석과 등받이)
  for (const z of [CAR_FRONT_Z, CAR_BACK_Z]) {
    o.push(rbox(0.86, 0.06, 0.56, 0, CAR_SEAT_Y + 0.02, z, cream, 0.03));
    o.push(rbox(0.86, 0.36, 0.1, 0, CAR_SEAT_Y + 0.2, z - 0.3, dark, 0.04));
  }
  // 보닛 위 고양이 귀
  for (const sx of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.16, 0.3, 4).rotateY(Math.PI / 4).scale(1, 1, 0.55);
    o.push(pc(ear.translate(sx * 0.32, 0.77, 0.66), body));
    const inner = new THREE.ConeGeometry(0.09, 0.18, 4).rotateY(Math.PI / 4).scale(1, 1, 0.4);
    o.push(pc(inner.translate(sx * 0.32, 0.74, 0.7), '#ffc7b8'));
  }
  // 헤드라이트 눈 (밤에 빛난다)
  for (const sx of [-1, 1]) {
    o.push(pc(new THREE.SphereGeometry(0.1, 10, 8).scale(1, 1, 0.5).translate(sx * 0.3, 0.5, 0.94), '#fffbe6', 1));
    o.push(pc(new THREE.SphereGeometry(0.045, 8, 6).scale(1, 1, 0.5).translate(sx * 0.3, 0.5, 0.985), '#3b2f2a'));
  }
  // 코와 수염
  o.push(pc(new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0.42, 0.96), '#ff7a8a'));
  for (const sx of [-1, 1])
    for (const k of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.008, 0.008, 0.32, 4).rotateZ(Math.PI / 2 + k * 0.18 * sx);
      o.push(pc(w.translate(sx * 0.62, 0.42 + k * 0.03, 0.88), '#5b4636'));
    }
  // 바퀴 넷
  for (const sx of [-1, 1])
    for (const z of [0.55, -0.85]) {
      o.push(pc(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 14).rotateZ(Math.PI / 2).translate(sx * 0.6, 0.2, z), '#4a4448'));
      o.push(pc(new THREE.CylinderGeometry(0.09, 0.09, 0.15, 10).rotateZ(Math.PI / 2).translate(sx * 0.6, 0.2, z), cream));
    }
  // 뒤 꼬리 안테나 (끝에 방울)
  const tail = new THREE.CylinderGeometry(0.03, 0.04, 0.7, 6).rotateX(-0.45).translate(0.38, 0.72, -1.2);
  o.push(pc(tail, dark));
  o.push(pc(new THREE.SphereGeometry(0.07, 8, 6).translate(0.38, 1.04, -1.36), '#ffd166'));
  return mergeParts(o, GLOW_ATTRS);
}

export class CarLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private n = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(shared: GlowShared, max: number) {
    this.material = createGlowLambert(shared, { instanced: false });
    this.mesh = new THREE.InstancedMesh(buildCarGeometry(), this.material, max);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  begin() {
    this.n = 0;
  }

  /** 차 하나. bob: 달릴 때 살짝 들썩이는 값 */
  push(x: number, y: number, z: number, yaw: number, scale = 1, bob = 0) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(this.p.set(x, y + bob, z), this.q, this.s.setScalar(scale));
    this.mesh.setMatrixAt(this.n++, this.m);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** 자리(앞/뒤)의 세계 좌표 오프셋 */
export function seatOffset(yaw: number, back: boolean): { dx: number; dz: number } {
  const z = back ? CAR_BACK_Z : CAR_FRONT_Z;
  return { dx: Math.sin(yaw) * z, dz: Math.cos(yaw) * z };
}
