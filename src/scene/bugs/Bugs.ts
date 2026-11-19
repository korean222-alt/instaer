import * as THREE from 'three';
import { groundHeightAt, type Bridge } from '../walk/Walker';

/**
 * 곤충 (2026-11-19, 곤충 채집). 앱이 setBugs 로 준 자리(anchor) 둘레에서
 * - fly: 날개를 파닥이며 둥실둥실 날아다닌다 (나비, 잠자리)
 * - ground: 땅 위를 천천히 기어 다닌다 (무당벌레, 사슴벌레)
 * - glow: 밤에 빛나며 떠다닌다 (반딧불이)
 * 목록에서 빠지면(잡았거나 날아가면) 작아지며 사라진다. 모두 InstancedMesh 몇 개로 그린다.
 * 고양이 키가 1m 쯤이라 멀리서도 보이게 실제보다 크게 그린다.
 */
export interface SceneBug {
  id: string;
  kind: 'fly' | 'ground' | 'glow';
  x: number;
  z: number;
  /** 날개(fly)나 등껍질(ground)이나 빛(glow) 색 */
  color: string;
  /** 크기 배율 (기본 1) */
  size?: number;
}

const POOL = 16;
const BODY = '#3a302a';

interface Rec {
  id: string;
  kind: SceneBug['kind'];
  x: number;
  z: number;
  size: number;
  color: THREE.Color;
  ph: number;
  show: number;
  alive: boolean;
  /** 지금 그린 자리 */
  px: number;
  pz: number;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export class Bugs {
  readonly group = new THREE.Group();
  bridges: readonly Bridge[] = [];
  private readonly recs: Rec[] = [];
  private readonly byId = new Map<string, Rec>();
  private readonly body: THREE.InstancedMesh;
  private readonly wings: THREE.InstancedMesh;
  private readonly shell: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly halo: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly dark = new THREE.Color(BODY);
  private t = 0;

  constructor() {
    const lambert = new THREE.MeshLambertMaterial();
    // 몸통: 앞(+z)으로 길쭉한 캡슐
    const bodyGeo = new THREE.CapsuleGeometry(0.035, 0.2, 3, 6).rotateX(Math.PI / 2);
    this.body = new THREE.InstancedMesh(bodyGeo, lambert, POOL * 2);
    // 날개: 몸 옆(+x)으로 뻗은 둥근 판. 왼쪽은 거울로 뒤집어 그린다
    const wingGeo = new THREE.CircleGeometry(0.16, 12).scale(1, 0.8, 1).translate(0.15, 0, 0).rotateX(-Math.PI / 2);
    this.wings = new THREE.InstancedMesh(wingGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), POOL * 2);
    // 등껍질 (땅 곤충)
    const shellGeo = new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1.2);
    this.shell = new THREE.InstancedMesh(shellGeo, lambert, POOL);
    // 반딧불이: 밝은 알 + 은은한 빛무리
    this.glow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial(), POOL);
    this.halo = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
      POOL,
    );
    for (const mesh of [this.body, this.wings, this.shell, this.glow, this.halo]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      // 색 버퍼를 미리 만든다
      mesh.setColorAt(0, this.dark);
      this.group.add(mesh);
    }
    this.body.castShadow = this.shell.castShadow = true;
  }

  set(list: readonly SceneBug[]) {
    const seen = new Set<string>();
    for (const b of list) {
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      const id = String(b.id);
      seen.add(id);
      let r = this.byId.get(id);
      if (!r) {
        if (this.recs.length >= POOL) continue;
        const ph = hashString(id) * 100;
        r = { id, kind: b.kind, x: b.x, z: b.z, size: 1, color: new THREE.Color(), ph, show: 0, alive: true, px: b.x, pz: b.z };
        this.recs.push(r);
        this.byId.set(id, r);
      }
      r.kind = b.kind === 'ground' || b.kind === 'glow' ? b.kind : 'fly';
      r.x = b.x;
      r.z = b.z;
      r.size = Math.max(0.4, Math.min(2, b.size ?? 1));
      r.color.set(b.color || '#ffffff');
      r.alive = true;
    }
    for (const r of this.recs) if (!seen.has(r.id)) r.alive = false;
  }

  clear() {
    this.recs.length = 0;
    this.byId.clear();
  }

  /** 그 곤충이 지금 그려진 자리 (없으면 null) */
  posOf(id: string): { x: number; z: number } | null {
    const r = this.byId.get(id);
    return r && r.alive ? { x: r.px, z: r.pz } : null;
  }

  update(dt: number, visible: boolean) {
    this.t += dt;
    const t = this.t;
    let nb = 0;
    let nw = 0;
    let ns = 0;
    let ng = 0;
    for (let i = this.recs.length - 1; i >= 0; i--) {
      const r = this.recs[i];
      r.show = r.alive ? Math.min(1, r.show + dt / 0.4) : r.show - dt / 0.3;
      if (r.show <= 0 && !r.alive) {
        this.byId.delete(r.id);
        this.recs.splice(i, 1);
        continue;
      }
      if (!visible) continue;
      const k = Math.max(0.001, r.show * r.show * (3 - 2 * r.show)) * r.size * (r.kind === 'ground' ? 1.5 : 1.15);
      const ph = r.ph;
      if (r.kind === 'ground') {
        // 작은 원을 그리며 천천히 기어 다닌다
        const a = t * 0.35 + ph;
        r.px = r.x + Math.sin(a) * 0.45;
        r.pz = r.z + Math.cos(a) * 0.45;
        const g = groundHeightAt(this.bridges, r.px, r.pz);
        const yaw = a + Math.PI / 2;
        this.q.setFromEuler(this.e.set(0, yaw, 0));
        this.m.compose(this.v.set(r.px, g + 0.02, r.pz), this.q, this.s.setScalar(k));
        this.shell.setMatrixAt(ns, this.m);
        this.shell.setColorAt(ns++, r.color);
        // 머리 (몸통 모양을 짧게)
        this.v.set(r.px + Math.sin(yaw) * 0.15 * k, g + 0.06 * k, r.pz + Math.cos(yaw) * 0.15 * k);
        this.m.compose(this.v, this.q, this.s.set(k * 1.4, k * 1.4, k * 0.45));
        this.body.setMatrixAt(nb, this.m);
        this.body.setColorAt(nb++, this.dark);
        continue;
      }
      // 날거나 떠다니는 것: 둘레를 둥실둥실
      const w = r.kind === 'glow' ? 0.8 : 1.3;
      const a1 = t * 0.5 + ph;
      const a2 = t * 0.37 + ph * 1.3;
      r.px = r.x + Math.sin(a1) * w;
      r.pz = r.z + Math.cos(a2) * w * 0.85;
      const vx = Math.cos(a1) * 0.5;
      const vz = -Math.sin(a2) * 0.37 * 0.85;
      const g = groundHeightAt(this.bridges, r.px, r.pz);
      const y = g + (r.kind === 'glow' ? 0.9 : 0.85) + Math.sin(t * 1.9 + ph) * 0.25;
      if (r.kind === 'glow') {
        const pulse = 0.65 + 0.35 * Math.sin(t * 3.2 + ph);
        this.q.identity();
        this.m.compose(this.v.set(r.px, y, r.pz), this.q, this.s.setScalar(k));
        this.glow.setMatrixAt(ng, this.m);
        this.glow.setColorAt(ng, r.color);
        this.m.compose(this.v, this.q, this.s.setScalar(k * pulse));
        this.halo.setMatrixAt(ng, this.m);
        this.halo.setColorAt(ng++, r.color);
        continue;
      }
      const yaw = Math.atan2(vx, vz);
      this.q.setFromEuler(this.e.set(0, yaw, 0));
      this.m.compose(this.v.set(r.px, y, r.pz), this.q, this.s.setScalar(k));
      this.body.setMatrixAt(nb, this.m);
      this.body.setColorAt(nb++, this.dark);
      // 날개 파닥임 (잠자리처럼 큰 것은 더 빨리, 덜 접는다)
      const fast = r.size > 1.1 ? 26 : 15;
      const flap = 0.15 + 0.95 * (0.5 + 0.5 * Math.sin(t * fast + ph));
      for (const side of [1, -1]) {
        this.q2.setFromEuler(this.e.set(0, 0, side * flap));
        this.q2.premultiply(this.q);
        this.m.compose(this.v, this.q2, this.s.set(side * k, k, k));
        this.wings.setMatrixAt(nw, this.m);
        this.wings.setColorAt(nw++, r.color);
      }
    }
    this.flush(this.body, nb);
    this.flush(this.wings, nw);
    this.flush(this.shell, ns);
    this.flush(this.glow, ng);
    this.flush(this.halo, ng);
  }

  dispose() {
    for (const mesh of [this.body, this.wings, this.shell, this.glow, this.halo]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }

  private flush(mesh: THREE.InstancedMesh, n: number) {
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
