import * as THREE from 'three';
import { mulberry32 } from '../util/rand';

/**
 * 동굴 안 (2026-11-15). 섬과 따로 떨어진 장면이라 들어가 있는 동안 섬은 그리지 않는다 (집 안과 같은 방식).
 *
 * - 깊이(level) 1~3. 깊을수록 어둡고 수정 빛이 많다. 1, 2 에는 안쪽에 더 깊이 가는 굴이 있다.
 * - 광석 바위(node)는 앱이 정해서 넘긴다 (자리, 색). 앱이 캐면 목록에서 빼고 다시 넘긴다.
 * - 바닥 높이 0, 가운데가 (0, 0). 앞쪽(+z) 가운데가 나가는 길이다.
 */
export const CAVE_HALF_X = 7.2;
export const CAVE_MIN_Z = -9.5;
export const CAVE_MAX_Z = 7;
/** 걷기에 쓰는 동굴 크기 (Walker.room) */
export const CAVE_WALK = {
  minX: -CAVE_HALF_X + 0.4,
  maxX: CAVE_HALF_X - 0.4,
  minZ: CAVE_MIN_Z + 0.5,
  maxZ: CAVE_MAX_Z - 0.1,
  y: 0,
  doorHalf: 1.3,
  doorZ: CAVE_MAX_Z + 1.2,
};
export const CAVE_START = { x: 0, z: CAVE_MAX_Z - 1.2 };
/** 이 선을 넘으면 밖으로 나간다 */
export const CAVE_EXIT_Z = CAVE_MAX_Z + 0.35;
/** 더 깊은 곳으로 가는 굴 앞 (여기 가까이 가면 앱이 "더 깊이" 버튼을 띄운다) */
export const CAVE_DEEPER = { x: 0, z: CAVE_MIN_Z + 1.1 };

export interface CaveNode {
  id: string;
  x: number;
  z: number;
  /** 광석 색 (#rrggbb) */
  color: string;
  /** 크기 0.7~1.4 (희귀한 것일수록 크게) */
  size?: number;
}

const FOV = 46;
const PITCH = THREE.MathUtils.degToRad(60);

function lumpy(g: THREE.BufferGeometry, seed: number, amount: number) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + (Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed * 0.7) + Math.sin(y * 3.3 + seed * 1.3)) * amount;
    pos.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function floorTexture(level: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const base = ['#6b5d55', '#5a5060', '#4a4258'][level - 1] ?? '#5a5060';
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(level * 31);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    const r = 2 + rnd() * 9;
    g.beginPath();
    g.ellipse(rnd() * 128, rnd() * 128, r, r * 0.6, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 5);
  return t;
}

export class Cave {
  readonly scene = new THREE.Scene();
  level = 1;
  /** 걷기를 막는 바위 (세계 좌표 = 동굴 좌표) */
  private readonly rocks: Array<{ x: number; z: number; r: number }> = [];
  private readonly nodeHits: Array<{ x: number; z: number; r: number; id: string }> = [];
  private readonly shell = new THREE.Group();
  private readonly nodes = new THREE.Group();
  private readonly hemi = new THREE.HemisphereLight('#fff0dc', '#5a4a40', 1.4);
  private readonly torches: THREE.PointLight[] = [];
  private readonly torchFlames: THREE.Mesh[] = [];
  private readonly rockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly floorMat = new THREE.MeshLambertMaterial();
  private readonly woodMat = new THREE.MeshLambertMaterial({ color: '#8a6a52' });
  private readonly flameMat = new THREE.MeshBasicMaterial({ color: '#ffcf6b' });
  private readonly glowMats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly baseMat = new THREE.MeshLambertMaterial({ color: '#7b6f68' });
  private readonly crystalGeo = new THREE.ConeGeometry(0.16, 0.7, 5);
  private readonly baseGeo = lumpy(new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.55, 1), 3, 0.08);
  private readonly sparkGeo = new THREE.OctahedronGeometry(0.06, 0);
  private readonly sparks: THREE.Mesh[] = [];
  private floorTex: THREE.CanvasTexture | null = null;
  private readonly focus = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
  private time = 0;

  constructor() {
    this.scene.background = new THREE.Color('#15121b');
    this.scene.fog = new THREE.Fog('#15121b', 22, 40);
    // 고양이 재질은 방향광이 있어야 제 색이 나온다 (집 안과 같은 방식)
    const key = new THREE.DirectionalLight('#ffe9cc', 1.3);
    key.position.set(3, 12, 8);
    this.scene.add(this.hemi, key, key.target, this.shell, this.nodes);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight('#ffb35c', 14, 11, 1.6);
      this.torches.push(l);
      this.scene.add(l);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), this.flameMat);
      this.torchFlames.push(flame);
      this.scene.add(flame);
    }
  }

  /** 깊이 level 의 동굴로 바꾼다 (모양은 깊이마다 같다) */
  open(level: number, nodes: readonly CaveNode[]) {
    this.level = Math.max(1, Math.min(3, Math.round(level) || 1));
    this.buildShell();
    this.setNodes(nodes);
    this.focus.set(CAVE_START.x, 0.6, CAVE_START.z);
  }

  setNodes(list: readonly CaveNode[]) {
    for (const child of [...this.nodes.children]) this.nodes.remove(child);
    this.nodeHits.length = 0;
    this.sparks.length = 0;
    for (const n of list) {
      if (!n || typeof n.id !== 'string' || !Number.isFinite(n.x) || !Number.isFinite(n.z)) continue;
      const size = Math.max(0.6, Math.min(1.5, n.size ?? 1));
      const g = new THREE.Group();
      g.position.set(n.x, 0, n.z);
      g.scale.setScalar(size);
      const base = new THREE.Mesh(this.baseGeo, this.baseMat);
      base.position.y = 0.18;
      g.add(base);
      let mat = this.glowMats.get(n.color);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color: n.color, emissive: n.color, emissiveIntensity: 0.8 });
        this.glowMats.set(n.color, mat);
      }
      const rnd = mulberry32(n.id.length * 131 + Math.round(n.x * 10) * 7 + Math.round(n.z * 10));
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(this.crystalGeo, mat);
        const a = (i / 4) * Math.PI * 2 + rnd();
        c.position.set(Math.cos(a) * 0.2, 0.5 + rnd() * 0.12, Math.sin(a) * 0.2);
        c.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        c.scale.setScalar(0.8 + rnd() * 0.5);
        g.add(c);
      }
      const spark = new THREE.Mesh(this.sparkGeo, this.flameMat);
      spark.position.set(0.15, 1.0, 0.1);
      g.add(spark);
      this.sparks.push(spark);
      this.nodes.add(g);
      this.nodeHits.push({ x: n.x, z: n.z, r: 0.55 * size, id: n.id });
    }
  }

  /** 걷기를 막는 것 (바위 + 광석 바위) */
  blockers(out: Array<{ x: number; z: number; r: number }>) {
    for (const r of this.rocks) out.push(r);
    for (const n of this.nodeHits) out.push(n);
  }

  /** (x, z) 에서 가장 가까운 광석 바위 (reach 안). 없으면 null */
  nodeNear(x: number, z: number, reach: number): string | null {
    let best: string | null = null;
    let bestD = reach;
    for (const n of this.nodeHits) {
      const d = Math.hypot(n.x - x, n.z - z) - n.r;
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /** 주민이 설 수 있는가 */
  canStand(x: number, z: number, pad: number) {
    if (Math.abs(x) > CAVE_WALK.maxX - pad || z < CAVE_WALK.minZ + pad || z > CAVE_WALK.maxZ - pad) return false;
    for (const r of this.rocks) if (Math.hypot(x - r.x, z - r.z) < r.r + pad) return false;
    for (const r of this.nodeHits) if (Math.hypot(x - r.x, z - r.z) < r.r + pad) return false;
    return true;
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number, catX: number, catZ: number) {
    const k = 1 - Math.exp(-dt * 5);
    this.focus.x += (catX * 0.45 - this.focus.x) * k;
    this.focus.z += (catZ * 0.75 - 1.2 - this.focus.z) * k;
    const dist = camera.aspect < 0.8 ? 21 : 15;
    camera.position.copy(this.focus).addScaledVector(this.dir, dist);
    camera.lookAt(this.focus);
    if (camera.fov !== FOV || camera.near !== 0.5) {
      camera.fov = FOV;
      camera.near = 0.5;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  update(dt: number) {
    this.time += dt;
    this.torches.forEach((l, i) => {
      const f = 1 + Math.sin(this.time * 9 + i * 2.1) * 0.08 + Math.sin(this.time * 23 + i) * 0.05;
      l.intensity = (this.level === 3 ? 10 : 14) * f;
      this.torchFlames[i].scale.setScalar(f);
    });
    this.sparks.forEach((s, i) => {
      const t = (this.time * 0.9 + i * 0.37) % 1;
      s.visible = t < 0.35;
      s.scale.setScalar(Math.sin((t / 0.35) * Math.PI) * 1.4 + 0.01);
      s.rotation.y = this.time * 3;
    });
  }

  dispose() {
    this.clearShell();
    this.rockMat.dispose();
    this.floorMat.dispose();
    this.woodMat.dispose();
    this.flameMat.dispose();
    this.baseMat.dispose();
    for (const m of this.glowMats.values()) m.dispose();
    this.crystalGeo.dispose();
    this.baseGeo.dispose();
    this.sparkGeo.dispose();
    this.floorTex?.dispose();
    for (const f of this.torchFlames) f.geometry.dispose();
  }

  private clearShell() {
    for (const child of [...this.shell.children]) {
      this.shell.remove(child);
      if (child instanceof THREE.Mesh && child.geometry !== this.crystalGeo) child.geometry.dispose();
    }
  }

  private buildShell() {
    this.clearShell();
    this.rocks.length = 0;
    const level = this.level;
    const rnd = mulberry32(900 + level * 17);
    this.floorTex?.dispose();
    this.floorTex = floorTexture(level);
    this.floorMat.map = this.floorTex;
    this.floorMat.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CAVE_HALF_X * 2 + 6, CAVE_MAX_Z - CAVE_MIN_Z + 8).rotateX(-Math.PI / 2), this.floorMat);
    floor.position.set(0, 0, (CAVE_MAX_Z + CAVE_MIN_Z) / 2 + 2);
    this.shell.add(floor);

    const tone = (['#8a7b70', '#7a6d80', '#655a78'] as const)[level - 1];
    const toneHi = (['#b3a596', '#a196ae', '#8f84a8'] as const)[level - 1];
    const parts: THREE.BufferGeometry[] = [];
    const paint = (g: THREE.BufferGeometry, lo: string, hi: string) => {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const a = new THREE.Color(lo);
      const b = new THREE.Color(hi);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - bb.min.y) / Math.max(1e-4, bb.max.y - bb.min.y);
        col[i * 3] = a.r + (b.r - a.r) * t;
        col[i * 3 + 1] = a.g + (b.g - a.g) * t;
        col[i * 3 + 2] = a.b + (b.b - a.b) * t;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const wallRock = (x: number, z: number, r: number, h: number, block = true) => {
      const g = new THREE.CylinderGeometry(r * 0.75, r, h, 9, 2);
      g.translate(0, h / 2, 0);
      lumpy(g, Math.floor(rnd() * 99), 0.12);
      g.rotateY(rnd() * 6);
      g.translate(x, 0, z);
      parts.push(paint(g.toNonIndexed(), tone, toneHi));
      if (block) this.rocks.push({ x, z, r: r * 0.92 });
    };
    // 양옆 벽
    for (const side of [-1, 1]) {
      for (let z = CAVE_MAX_Z + 0.5; z >= CAVE_MIN_Z - 1; z -= 1.6) {
        const wobble = Math.sin(z * 0.7 + side + level) * 0.6;
        wallRock(side * (CAVE_HALF_X + 0.6 + wobble), z, 1.3 + rnd() * 0.6, 2.6 + rnd() * 1.8);
      }
    }
    // 뒷벽 (가운데 굴은 깊이 3 이면 막는다)
    for (let x = -CAVE_HALF_X - 1; x <= CAVE_HALF_X + 1; x += 1.5) {
      if (level < 3 && Math.abs(x) < 1.6) continue;
      wallRock(x, CAVE_MIN_Z - 0.7 + Math.sin(x) * 0.4, 1.3 + rnd() * 0.5, 2.8 + rnd() * 1.6);
    }
    if (level < 3) {
      // 더 깊은 곳으로 가는 어두운 굴과 나무 틀
      const hole = new THREE.Mesh(new THREE.CircleGeometry(1.4, 16, 0, Math.PI).scale(1, 1.2, 1), new THREE.MeshBasicMaterial({ color: '#050407' }));
      hole.position.set(0, 0.01, CAVE_MIN_Z - 0.9);
      this.shell.add(hole);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.9, 0.22), this.woodMat);
        post.position.set(sx * 1.45, 0.95, CAVE_MIN_Z - 0.6);
        this.shell.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.22, 0.26), this.woodMat);
      beam.position.set(0, 1.95, CAVE_MIN_Z - 0.6);
      this.shell.add(beam);
      this.rocks.push({ x: -1.9, z: CAVE_MIN_Z - 0.2, r: 0.5 }, { x: 1.9, z: CAVE_MIN_Z - 0.2, r: 0.5 });
    }
    // 입구 양옆 (밖으로 나가는 길)
    for (const side of [-1, 1]) wallRock(side * 2.8, CAVE_MAX_Z + 0.9, 1.2, 2.2);
    // 동굴 안 돌기둥과 종유석
    const pillars = 3 + level;
    for (let i = 0; i < pillars; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const x = (rnd() - 0.5) * (CAVE_HALF_X * 2 - 4);
        const z = CAVE_MIN_Z + 2.5 + rnd() * (CAVE_MAX_Z - CAVE_MIN_Z - 6);
        if (Math.abs(x) < 1.6) continue;
        if (this.rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.r + 1.6)) continue;
        const r = 0.45 + rnd() * 0.35;
        const g = new THREE.ConeGeometry(r, 1.4 + rnd() * 1.6, 7, 2);
        g.translate(0, g.parameters.height / 2, 0);
        lumpy(g, i * 7, 0.1);
        g.translate(x, 0, z);
        parts.push(paint(g.toNonIndexed(), tone, toneHi));
        this.rocks.push({ x, z, r: r * 0.9 });
        break;
      }
    }
    // 바닥의 작은 돌 (막지 않는다)
    for (let i = 0; i < 18; i++) {
      const g = new THREE.IcosahedronGeometry(0.1 + rnd() * 0.15, 0);
      g.translate((rnd() - 0.5) * CAVE_HALF_X * 1.8, 0.05, CAVE_MIN_Z + rnd() * (CAVE_MAX_Z - CAVE_MIN_Z));
      parts.push(paint(g.toNonIndexed(), tone, toneHi));
    }
    // 레일 (입구에서 안쪽으로)
    const rail = new THREE.Group();
    for (let z = CAVE_MAX_Z + 1; z > CAVE_MIN_Z + 2; z -= 0.6) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.16), this.woodMat);
      tie.position.set(0, 0.03, z);
      rail.add(tie);
    }
    this.shell.add(rail);
    const merged = new THREE.Mesh(mergeAll(parts), this.rockMat);
    this.shell.add(merged);

    // 횃불: 양옆 벽 두 개 + 안쪽 하나
    const spots: Array<[number, number]> = [
      [-CAVE_HALF_X + 0.9, 2.5],
      [CAVE_HALF_X - 0.9, -2.5],
      [level < 3 ? 2.4 : -2.4, CAVE_MIN_Z + 1.2],
    ];
    spots.forEach(([x, z], i) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.5, 6), this.woodMat);
      post.position.set(x, 0.75, z);
      this.shell.add(post);
      this.torchFlames[i].position.set(x, 1.6, z);
      this.torches[i].position.set(x, 2.0, z);
      this.rocks.push({ x, z, r: 0.25 });
    });
    this.hemi.intensity = [1.5, 1.25, 1.0][level - 1];
    this.scene.fog = new THREE.Fog('#15121b', 22 + (3 - level) * 2, 40);
  }
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
