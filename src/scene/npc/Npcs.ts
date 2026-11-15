import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CatLook } from '../../shared/types';
import { CatFlock } from '../cat/CatFlock';
import { PATTERN_INDEX } from '../cat/catMaterial';
import type { CatModel } from '../cat/catModel';
import { createGlowLambert, GLOW_ATTRS, type GlowShared } from '../core/glowLambert';
import { NameTags } from '../remote/NameTags';
import { fillAttr, mergeParts, paint } from '../util/geo';
import { hash01 } from '../util/rand';
import { groundHeightAt, STRIDE, type Bridge } from '../walk/Walker';

/**
 * 주민(NPC) 고양이. 다른 유저와 같은 고양이 모양이지만
 * - 이름표가 연두색이고 '@' 가 없다
 * - 역할마다 작은 표시가 있다: 몸에 걸친 것(모자, 목도리)과 자리에 놓인 것(바구니, 게임기, 낚싯대, 물뿌리개)
 * - 앱이 준 자리에 앉아 있다가 가끔 둘레를 조금 걷고 돌아온다. 내 고양이가 가까이 오면 멈춰서 쳐다본다
 *
 * 고양이는 InstancedMesh 하나, 역할 표시는 역할마다 InstancedMesh 둘(걸친 것 / 놓인 것)까지만 쓴다.
 */
export interface SceneNpc {
  id: string;
  name: string;
  x: number;
  z: number;
  rotY: number;
  cat: CatLook;
  /** 'shop' | 'arcade' | 'fisher' | 'gardener' | 'resident'. 모르는 값이면 표시 없이 고양이만 그린다 */
  role?: string;
}

/** 한 번에 그리는 주민 수 */
const POOL = 16;
const SCALE = 1.12;
const WALK_SPEED = 0.95;
/** 자리에서 이만큼까지 돌아다닌다 (밖 / 집 안) */
const ROAM_OUT = 1.5;
const ROAM_IN = 0.9;
/** 내 고양이가 이 안에 오면 멈춰서 쳐다본다 */
const LOOK_AT = 3.4;
const TAG_RANGE = 30;
/** 놓인 소품은 주민 자리에서 오른쪽으로 이만큼 떨어져 있다 */
const PROP_SIDE = 0.62;
const DEFAULT_CAT: CatLook = { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' };

function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ───────────── 역할 표시 모양 (고양이 기준: 키 1, 앞 +z, 발바닥 y=0) ─────────────

type Piece = THREE.BufferGeometry;
const pc = (g: THREE.BufferGeometry, color: string, glow = 0): Piece => {
  paint(g, color);
  fillAttr(g, 'aMask', [0, glow]);
  return g;
};
/** 머리 꼭대기 (두 귀 사이) */
const HEAD_TOP = { y: 0.83, z: 0.2 };

function strawHat(band: string, flower?: string): Piece[] {
  const out: Piece[] = [];
  out.push(pc(new THREE.CylinderGeometry(0.235, 0.25, 0.022, 14).translate(0, HEAD_TOP.y, HEAD_TOP.z), '#f1d58e'));
  out.push(pc(new THREE.CylinderGeometry(0.105, 0.135, 0.1, 12).translate(0, HEAD_TOP.y + 0.06, HEAD_TOP.z), '#f6dfa0'));
  out.push(pc(new THREE.CylinderGeometry(0.139, 0.139, 0.035, 12).translate(0, HEAD_TOP.y + 0.03, HEAD_TOP.z), band));
  if (flower) {
    out.push(pc(new THREE.SphereGeometry(0.04, 7, 5).translate(0.12, HEAD_TOP.y + 0.05, HEAD_TOP.z + 0.08), flower));
    out.push(pc(new THREE.SphereGeometry(0.02, 5, 4).translate(0.12, HEAD_TOP.y + 0.05, HEAD_TOP.z + 0.115), '#ffe08a'));
  }
  return out;
}
function cap(color: string, visor: string): Piece[] {
  const dome = new THREE.SphereGeometry(0.15, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.72, 1).translate(0, HEAD_TOP.y - 0.015, HEAD_TOP.z);
  const brim = new THREE.CylinderGeometry(0.13, 0.13, 0.018, 12, 1, false, -Math.PI / 2, Math.PI);
  brim.scale(1, 1, 1.25).translate(0, HEAD_TOP.y - 0.005, HEAD_TOP.z + 0.1);
  return [pc(dome, color), pc(brim, visor), pc(new THREE.SphereGeometry(0.022, 6, 4).translate(0, HEAD_TOP.y + 0.095, HEAD_TOP.z), visor)];
}
function scarf(color: string, bell = false): Piece[] {
  const ring = new THREE.TorusGeometry(0.2, 0.05, 6, 16).rotateX(Math.PI / 2);
  ring.scale(1.05, 1, 0.95).translate(0, 0.395, 0.13);
  const out = [pc(ring, color)];
  // 한쪽으로 늘어진 끝자락
  out.push(pc(new RoundedBoxGeometry(0.09, 0.17, 0.045, 1, 0.02).rotateZ(0.25).translate(0.12, 0.31, 0.33), color));
  if (bell) out.push(pc(new THREE.SphereGeometry(0.042, 8, 6).translate(0, 0.35, 0.345), '#f4c95d'));
  return out;
}

/** 놓인 것: 주민 자리 옆 (오른쪽 앞) 에 둔다. 원점은 주민 자리, 앞은 +z */
function basket(): Piece[] {
  const out: Piece[] = [];
  const x = 0.62;
  const z = 0.1;
  out.push(pc(new RoundedBoxGeometry(0.5, 0.26, 0.38, 1, 0.05).translate(x, 0.13, z), '#d7a878'));
  out.push(pc(new THREE.BoxGeometry(0.52, 0.04, 0.4).translate(x, 0.2, z), '#b98557'));
  const goods: Array<[number, number, string]> = [[-0.13, -0.06, '#ff8f7a'], [0.02, 0.07, '#ffd166'], [0.14, -0.05, '#9ed27f'], [-0.05, 0.1, '#ff9ec2']];
  for (const [dx, dz, c] of goods) out.push(pc(new THREE.SphereGeometry(0.085, 8, 6).translate(x + dx, 0.29, z + dz), c));
  // 작은 가격표 깃발
  out.push(pc(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 5).translate(x + 0.2, 0.42, z + 0.12), '#8a6a52'));
  out.push(pc(new THREE.BoxGeometry(0.15, 0.1, 0.012).translate(x + 0.12, 0.55, z + 0.12), '#fffaf0'));
  return out;
}
function gameBox(): Piece[] {
  const out: Piece[] = [];
  const x = 0.62;
  const z = 0.1;
  out.push(pc(new RoundedBoxGeometry(0.42, 0.34, 0.34, 1, 0.05).translate(x, 0.17, z), '#7cc4f2'));
  const top = new RoundedBoxGeometry(0.42, 0.06, 0.34, 1, 0.025).rotateX(0.32).translate(x, 0.37, z + 0.01);
  out.push(pc(top, '#fff6ea'));
  out.push(pc(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 5).translate(x - 0.09, 0.45, z + 0.03), '#5b4636'));
  out.push(pc(new THREE.SphereGeometry(0.042, 8, 6).translate(x - 0.09, 0.52, z + 0.03), '#ff6f61'));
  out.push(pc(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8).rotateX(0.32).translate(x + 0.05, 0.4, z + 0.07), '#ffd166', 0.6));
  out.push(pc(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8).rotateX(0.32).translate(x + 0.13, 0.415, z + 0.02), '#9ed27f', 0.6));
  return out;
}
function rodStand(): Piece[] {
  const out: Piece[] = [];
  const x = 0.5;
  // 받침 (Y 자 막대) 과 그 위에 걸쳐 둔 낚싯대
  out.push(pc(new THREE.CylinderGeometry(0.02, 0.025, 0.42, 5).translate(x, 0.21, 0.35), '#9c6f4b'));
  const rod = new THREE.CylinderGeometry(0.012, 0.022, 1.5, 5).rotateX(1.05).translate(x, 0.52, 0.52);
  out.push(pc(rod, '#b98557'));
  out.push(pc(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6).rotateX(1.05).translate(x, 0.2, -0.04), '#5b4636'));
  // 물고기 통
  out.push(pc(new THREE.CylinderGeometry(0.15, 0.12, 0.22, 10).translate(x + 0.32, 0.11, -0.05), '#8fd3e8'));
  out.push(pc(new THREE.TorusGeometry(0.15, 0.014, 4, 12).rotateX(Math.PI / 2).translate(x + 0.32, 0.22, -0.05), '#fffaf0'));
  return out;
}
function wateringCan(): Piece[] {
  const out: Piece[] = [];
  const x = 0.6;
  const z = 0.12;
  out.push(pc(new THREE.CylinderGeometry(0.13, 0.15, 0.26, 12).translate(x, 0.13, z), '#7fd8b0'));
  out.push(pc(new THREE.CylinderGeometry(0.026, 0.034, 0.34, 6).rotateZ(-0.95).translate(x + 0.24, 0.24, z), '#7fd8b0'));
  out.push(pc(new THREE.CylinderGeometry(0.06, 0.03, 0.05, 8).rotateZ(-0.95).translate(x + 0.39, 0.345, z), '#fffaf0'));
  out.push(pc(new THREE.TorusGeometry(0.1, 0.018, 5, 12, Math.PI).rotateZ(Math.PI / 2).translate(x - 0.13, 0.17, z), '#5cc2b5'));
  // 옆에 핀 꽃 한 송이
  out.push(pc(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4).translate(x + 0.1, 0.15, z + 0.36), '#7cc46a'));
  out.push(pc(new THREE.SphereGeometry(0.07, 8, 6).translate(x + 0.1, 0.32, z + 0.36), '#ff9ec2'));
  out.push(pc(new THREE.SphereGeometry(0.03, 6, 4).translate(x + 0.1, 0.36, z + 0.39), '#ffe08a'));
  return out;
}

const ROLE_PARTS: Record<string, { worn: () => Piece[]; prop?: () => Piece[] }> = {
  shop: { worn: () => scarf('#ff8f7a', true), prop: basket },
  arcade: { worn: () => cap('#7c8cf0', '#fff6ea'), prop: gameBox },
  fisher: { worn: () => strawHat('#5cc2b5'), prop: rodStand },
  gardener: { worn: () => strawHat('#ff9ec2', '#ff8fa3'), prop: wateringCan },
  resident: { worn: () => scarf('#8fd3e8') },
  explorer: { worn: () => cap('#f4c95d', '#9a6645') },
};

interface Batch {
  mesh: THREE.InstancedMesh;
  n: number;
}

class Rec {
  id = '';
  name = '';
  role = '';
  alive = true;
  stamp = 0;
  /** 앱이 준 자리 (걸을 수 없는 곳이면 가까운 빈 곳으로 옮긴 값) */
  homeX = 0;
  homeZ = 0;
  homeYaw = 0;
  /** 앱이 준 값 그대로 (바뀌었는지 볼 때 쓴다) */
  givenX = NaN;
  givenZ = NaN;
  x = 0;
  z = 0;
  yaw = 0;
  groundY = 0;
  walking = false;
  /** 다음 행동까지 남은 시간 */
  wait = 0;
  tx = 0;
  tz = 0;
  phase = 0;
  walk = 0;
  sit = 1;
  show = 0;
  d2 = 0;
  readonly fur = new THREE.Color();
  readonly eye = new THREE.Color();
  pattern = 0;
  seed = 0;
  lookKey = '';
  tagSlot = -1;
  tagAlpha = 0;
}

export interface NpcView {
  /** 거리 기준점 */
  focusX: number;
  focusZ: number;
  /** 걷는 중이면 내 고양이 자리 (주민이 쳐다본다) */
  walking: boolean;
  dist: number;
  viewportW: number;
  viewportH: number;
}

export class Npcs {
  readonly group = new THREE.Group();
  bridges: readonly Bridge[] = [];
  /** 집 안처럼 바닥이 평평한 곳에서는 그 높이. null 이면 섬의 땅 높이 */
  flatY: number | null = null;
  /** 주민이 설 수 있는 자리인가 (index 가 넣어 준다: 밖이면 땅과 막힌 곳, 안이면 방과 가구) */
  canStand: (x: number, z: number) => boolean = () => true;
  /** 확인용 */
  shown = 0;
  shownTags = 0;

  private readonly flock: CatFlock;
  private readonly tags = new NameTags({ prefix: '', bg: 'rgba(96, 148, 66, 0.9)', fg: '#fffdf2' });
  private readonly material: THREE.MeshLambertMaterial;
  private readonly worn = new Map<string, Batch>();
  private readonly props = new Map<string, Batch>();
  private readonly recs: Rec[] = [];
  private readonly byId = new Map<string, Rec>();
  private stamp = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(model: CatModel, shared: GlowShared) {
    this.flock = new CatFlock(model, POOL, 'low');
    this.flock.mesh.visible = false;
    this.material = createGlowLambert(shared, { instanced: false });
    this.group.add(this.flock.mesh, this.tags.mesh);
  }

  /** 지금 보여 줄 주민 전체. 목록에서 빠진 주민은 스르르 사라진다 */
  set(npcs: readonly SceneNpc[]) {
    const stamp = ++this.stamp;
    for (const n of npcs) {
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.z)) continue;
      const id = String(n.id);
      let r = this.byId.get(id);
      if (!r) {
        if (this.recs.length >= POOL) continue;
        r = new Rec();
        r.id = id;
        r.phase = hash01(hashString(id) % 100000, 3) * 6.28;
        r.wait = 3 + hash01(hashString(id) % 100000, 5) * 8;
        this.recs.push(r);
        this.byId.set(id, r);
      }
      r.stamp = stamp;
      r.alive = true;
      const name = String(n.name ?? '');
      if (name !== r.name) {
        r.name = name;
        this.tags.give(r.tagSlot);
        r.tagSlot = -1;
      }
      r.role = n.role ?? '';
      const yaw = Number.isFinite(n.rotY) ? n.rotY : 0;
      if (n.x !== r.givenX || n.z !== r.givenZ || yaw !== r.homeYaw) {
        const first = Number.isNaN(r.givenX);
        r.givenX = n.x;
        r.givenZ = n.z;
        r.homeYaw = yaw;
        this.settle(r, n.x, n.z);
        // 처음이거나 자리가 크게 바뀌었으면 바로 그 자리에 앉힌다
        if (first || Math.hypot(r.x - r.homeX, r.z - r.homeZ) > 4) {
          r.x = r.homeX;
          r.z = r.homeZ;
          r.yaw = yaw;
          r.walking = false;
          r.sit = 1;
          r.walk = 0;
          r.groundY = this.flatY ?? groundHeightAt(this.bridges, r.x, r.z);
        }
      }
      const cat = n.cat ?? DEFAULT_CAT;
      const key = `${cat.fur}|${cat.pattern}|${cat.eyeColor}`;
      if (key !== r.lookKey) {
        r.lookKey = key;
        r.fur.set(cat.fur);
        r.eye.set(cat.eyeColor);
        r.pattern = PATTERN_INDEX[cat.pattern] ?? 0;
        r.seed = hash01(hashString(id) % 100000, 7);
      }
    }
    for (const r of this.recs) if (r.stamp !== stamp) r.alive = false;
  }

  /** 모두 바로 지운다 (집 안팎을 오갈 때) */
  clear() {
    for (const r of this.recs) this.tags.give(r.tagSlot);
    this.recs.length = 0;
    this.byId.clear();
  }

  /** 광선에 맞은 주민의 id (없으면 null) */
  pick(ray: THREE.Ray): string | null {
    let best: Rec | null = null;
    let bestD = 0.62;
    for (const r of this.recs) {
      if (!r.alive) continue;
      const d = ray.distanceToPoint(this.v.set(r.x, r.groundY + 0.5, r.z));
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best ? best.id : null;
  }

  update(dt: number, view: NpcView) {
    for (const b of this.worn.values()) b.n = 0;
    for (const b of this.props.values()) b.n = 0;
    this.tags.begin();
    const visible = view.dist < 300;
    let n = 0;
    let nTags = 0;
    for (let i = this.recs.length - 1; i >= 0; i--) {
      const r = this.recs[i];
      r.show = r.alive ? Math.min(1, r.show + dt / 0.38) : r.show - dt / 0.28;
      if (r.show <= 0 && !r.alive) {
        this.tags.give(r.tagSlot);
        this.byId.delete(r.id);
        this.recs.splice(i, 1);
        continue;
      }
      this.think(r, dt, view);
      if (!visible) continue;

      const k = r.show * r.show * (3 - 2 * r.show);
      const scale = SCALE * Math.max(0.001, k);
      const hop = Math.abs(Math.sin(r.phase)) * 0.045 * r.walk;
      const y = r.groundY + hop + 0.035;
      this.flock.setLookRaw(n, r.fur, r.eye, r.pattern, r.seed, r.sit, 0);
      this.flock.setPose(n, r.x, y, r.z, r.yaw, scale);
      this.flock.setAnim(n, r.phase, r.walk, 0, 0);
      n++;

      const parts = ROLE_PARTS[r.role];
      if (parts) {
        // 걸친 것은 고양이를 따라가고(앉으면 몸이 낮아진 만큼 같이 내려간다), 놓인 것은 자리에 그대로 있다
        const worn = this.batch(this.worn, r.role, parts.worn);
        this.q.setFromAxisAngle(Npcs.UP, r.yaw);
        this.m.compose(this.v.set(r.x, y - 0.1 * r.sit * scale, r.z), this.q, this.s.setScalar(scale));
        worn.mesh.setMatrixAt(worn.n++, this.m);
        if (parts.prop) {
          const prop = this.batch(this.props, r.role, parts.prop);
          this.q.setFromAxisAngle(Npcs.UP, r.homeYaw);
          const gy = this.flatY ?? groundHeightAt(this.bridges, r.homeX, r.homeZ);
          this.m.compose(this.v.set(r.homeX, gy + 0.02, r.homeZ), this.q, this.s.setScalar(Math.max(0.001, k)));
          prop.mesh.setMatrixAt(prop.n++, this.m);
        }
      }

      // 이름표
      const dx = r.x - view.focusX;
      const dz = r.z - view.focusZ;
      r.d2 = dx * dx + dz * dz;
      const range = view.walking ? TAG_RANGE : Math.max(TAG_RANGE, view.dist * 0.55);
      const want = r.alive && !!r.name && r.d2 < range * range;
      r.tagAlpha = want ? Math.min(1, r.tagAlpha + dt / 0.22) : Math.max(0, r.tagAlpha - dt / 0.22);
      if (r.tagAlpha <= 0) {
        if (r.tagSlot >= 0) {
          this.tags.give(r.tagSlot);
          r.tagSlot = -1;
        }
        continue;
      }
      if (r.tagSlot < 0) r.tagSlot = this.tags.take(r.name);
      if (r.tagSlot < 0) continue;
      const d = Math.sqrt(r.d2);
      const far = THREE.MathUtils.smoothstep(d, 7, range * 0.85);
      const edge = 1 - THREE.MathUtils.smoothstep(d, range * 0.82, range);
      const a = r.tagAlpha * edge * Math.min(1, r.show * 1.4);
      if (a <= 0.01) continue;
      // 모자가 있어서 유저 이름표보다 조금 높게 띄운다
      this.tags.push(r.tagSlot, r.x, r.groundY + SCALE * 1.02 + 0.2 - 0.08 * r.sit, r.z, 1 - 0.36 * far, a);
      nTags++;
    }
    this.tags.end(view.viewportW, view.viewportH);
    this.flock.count = n;
    this.flock.mesh.visible = n > 0;
    for (const b of this.worn.values()) this.flush(b);
    for (const b of this.props.values()) this.flush(b);
    this.shown = n;
    this.shownTags = nTags;
  }

  dispose() {
    this.flock.dispose();
    this.tags.dispose();
    for (const b of [...this.worn.values(), ...this.props.values()]) {
      b.mesh.geometry.dispose();
      b.mesh.dispose();
    }
    this.material.dispose();
  }

  /** 앱이 준 자리(와 그 옆에 놓는 소품 자리)가 나무나 벤치에 걸리면 가장 가까운 빈 곳으로 옮긴다 */
  private settle(r: Rec, x: number, z: number) {
    const hasProp = !!ROLE_PARTS[r.role]?.prop;
    const sin = Math.sin(r.homeYaw);
    const cos = Math.cos(r.homeYaw);
    const free = (px: number, pz: number) =>
      this.canStand(px, pz) && (!hasProp || this.canStand(px + PROP_SIDE * cos + 0.1 * sin, pz - PROP_SIDE * sin + 0.1 * cos));
    r.homeX = x;
    r.homeZ = z;
    if (free(x, z)) return;
    for (let ring = 1; ring <= 8; ring++) {
      for (let i = 0; i < 12; i++) {
        // 화면 앞쪽(+z)부터 좌우로 번갈아 찾는다 (벤치 뒤에 가려지지 않게)
        const a = ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 6;
        const nx = x + Math.sin(a) * ring * 0.4;
        const nz = z + Math.cos(a) * ring * 0.4;
        if (free(nx, nz)) {
          r.homeX = nx;
          r.homeZ = nz;
          return;
        }
      }
    }
  }

  /** 주민 한 마리의 행동: 앉아 있기 → 가끔 둘레 걷기 → 돌아와 앉기 */
  private think(r: Rec, dt: number, view: NpcView) {
    let goalYaw = r.yaw;
    let moved = 0;
    const px = view.focusX - r.x;
    const pz = view.focusZ - r.z;
    const near = view.walking && px * px + pz * pz < LOOK_AT * LOOK_AT;
    if (near) {
      // 내 고양이를 쳐다보며 기다린다
      r.walking = false;
      r.wait = Math.max(r.wait, 2.5);
      if (px * px + pz * pz > 0.04) goalYaw = Math.atan2(px, pz);
    } else if (r.walking) {
      const ex = r.tx - r.x;
      const ez = r.tz - r.z;
      const d = Math.hypot(ex, ez);
      // 일어선 다음에 걷는다
      if (r.sit < 0.25) {
        const step = WALK_SPEED * dt;
        if (d <= step) {
          r.x = r.tx;
          r.z = r.tz;
          moved = d;
          r.walking = false;
          r.wait = 5 + Math.random() * 9;
        } else {
          r.x += (ex / d) * step;
          r.z += (ez / d) * step;
          moved = step;
        }
      }
      if (d > 0.05) goalYaw = Math.atan2(ex, ez);
    } else {
      r.wait -= dt;
      const atHome = Math.hypot(r.x - r.homeX, r.z - r.homeZ) < 0.05;
      if (atHome) goalYaw = r.homeYaw;
      if (r.wait <= 0) {
        // 세 번에 한 번은 제자리로 돌아간다
        const roam = this.flatY === null ? ROAM_OUT : ROAM_IN;
        let tx = r.homeX;
        let tz = r.homeZ;
        if (atHome || Math.random() > 0.35) {
          const a = Math.random() * Math.PI * 2;
          const len = roam * (0.45 + Math.random() * 0.55);
          tx += Math.sin(a) * len;
          tz += Math.cos(a) * len;
        }
        if (this.clearPath(r.x, r.z, tx, tz)) {
          r.tx = tx;
          r.tz = tz;
          r.walking = true;
        } else r.wait = 1 + Math.random();
      }
    }
    r.yaw += angleDiff(goalYaw, r.yaw) * (1 - Math.exp(-dt * 7));
    const g = this.flatY ?? groundHeightAt(this.bridges, r.x, r.z);
    r.groundY += (g - r.groundY) * (1 - Math.exp(-dt * 18));
    r.phase += (moved / STRIDE) * Math.PI * 2;
    r.walk += ((moved > 0 ? 0.62 : 0) - r.walk) * (1 - Math.exp(-dt * 9));
    r.sit += ((r.walking ? 0 : 1) - r.sit) * (1 - Math.exp(-dt * 4));
  }

  private clearPath(x0: number, z0: number, x1: number, z1: number): boolean {
    for (let i = 1; i <= 5; i++) {
      const k = i / 5;
      if (!this.canStand(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k)) return false;
    }
    return true;
  }

  private batch(map: Map<string, Batch>, role: string, build: () => Piece[]): Batch {
    let b = map.get(role);
    if (!b) {
      const mesh = new THREE.InstancedMesh(mergeParts(build(), GLOW_ATTRS), this.material, POOL);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      b = { mesh, n: 0 };
      map.set(role, b);
    }
    return b;
  }

  private flush(b: Batch) {
    b.mesh.count = b.n;
    b.mesh.visible = b.n > 0;
    if (b.n) b.mesh.instanceMatrix.needsUpdate = true;
  }
}
