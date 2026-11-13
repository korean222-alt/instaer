import * as THREE from 'three';
import type { Atmosphere } from '../core/atmosphere';
import { createGlowLambert, GLOW_ATTRS } from '../core/glowLambert';
import {
  colX,
  LOCAL_SLOTS,
  PLAZA_LOCAL,
  RESERVED_LOTS,
  rowZ,
  ZONE,
  zoneBaseLand,
  zoneCenter,
  zoneLink,
} from '../layout';
import { mergeParts } from '../util/geo';
import { hash01, mulberry32, valueNoise2 } from '../util/rand';
import { GROUND_Y } from './constants';
import { createNoiseTexture, MapField, type PathSeg, type ZoneShape } from './mapField';
import { applyMap, createMapUniforms, type MapUniforms } from './mapUniforms';
import { Fireflies, GlowPools, type Pool } from './nightFx';
import * as props from './props';
import { createSea } from './sea';
import { buildTerrainGeometry, createTerrainMaterial } from './terrain';

/**
 * 섬 전체(군도)를 만든다: 구역별 땅, 장식, 다리, 항구, 잠긴 구역의 구름, 바다.
 * 집/고양이/아이템은 여기서 다루지 않는다.
 *
 * 구역 수가 바뀔 때만 다시 만든다 (드문 일). 장식은 한 번 만든 모양을 구역마다 다시 쓴다.
 */
const HARBOR = { x: 14, r: 5.6, dockLength: 6.2 };
const BRIDGE_OVERLAP = 4.3;
const pathZ = (row: number) => rowZ(row) + ZONE.rowPath;
const MID_ROW = Math.floor(ZONE.rows / 2);

function smoothUnion(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** 구역의 해안 모양 (구역 가운데 기준 좌표). 구역마다 굴곡이 다르다 */
function zoneLandLocal(zone: number, lx: number, lz: number): number {
  let d = zoneBaseLand(lx, lz);
  if (zone === 0) d = smoothUnion(d, HARBOR.r - Math.hypot(lx - HARBOR.x, lz - (ZONE.halfZ + 0.8)), 3.5);
  d += (valueNoise2(lx * 0.085 + zone * 17.3 + 50, lz * 0.085 + zone * 7.1 + 50, 5) - 0.5) * 2.6;
  d += (valueNoise2(lx * 0.3 + zone * 3.7 + 9, lz * 0.3 + 9, 9) - 0.5) * 0.7;
  return d;
}

/** 줄마다 마당(빈터 포함)이 놓인 가로 범위 */
const ROW_EXTENT: Array<{ min: number; max: number }> = [];
for (let r = 0; r < ZONE.rows; r++) {
  let min = Infinity;
  let max = -Infinity;
  for (const lot of [...LOCAL_SLOTS, ...RESERVED_LOTS]) {
    if (lot.row !== r) continue;
    min = Math.min(min, lot.x);
    max = Math.max(max, lot.x);
  }
  ROW_EXTENT.push({ min: min - 3, max: max + 3 });
}

/** 구역 안의 길 (구역 가운데 기준). links: 다리가 놓이는 방향 */
function zonePathsLocal(zone: number, links: { e: boolean; w: boolean; n: boolean; s: boolean }): PathSeg[] {
  const r = ZONE.pathR;
  const out: PathSeg[] = [];
  for (let row = 0; row < ZONE.rows; row++) {
    const ext = ROW_EXTENT[row];
    let ax = ext.min;
    let bx = ext.max;
    if (row === MID_ROW) {
      if (links.w) ax = -ZONE.halfX + 0.6;
      if (links.e) bx = ZONE.halfX - 0.6;
    }
    out.push({ ax, az: pathZ(row), bx, bz: pathZ(row), r });
  }
  // 가운데 큰길
  out.push({
    ax: 0,
    az: links.n ? -ZONE.halfZ + 0.6 : pathZ(0),
    bx: 0,
    bz: links.s ? ZONE.halfZ - 0.6 : pathZ(ZONE.rows - 1),
    r: r + 0.08,
  });
  if (zone === 0) out.push({ ax: HARBOR.x, az: pathZ(ZONE.rows - 1), bx: HARBOR.x, bz: ZONE.halfZ + 0.4, r });
  return out;
}

interface DecorTemplate {
  /** 나무, 등불, 벤치처럼 그림자를 드리우는 큰 것 */
  geometry: THREE.BufferGeometry;
  /** 꽃, 덤불, 바위처럼 낮은 것 (그림자 없음, 멀리서는 숨김) */
  ground: THREE.BufferGeometry;
  lanterns: Array<[number, number]>;
  fireflies: Array<[number, number, number]>;
}

function buildDecorTemplate(withHarbor: boolean): DecorTemplate {
  const tall: THREE.BufferGeometry[] = [];
  const low: THREE.BufferGeometry[] = [];
  let pieces = tall;
  const lanterns: Array<[number, number]> = [];
  const fireflies: Array<[number, number, number]> = [];
  const rnd = mulberry32(withHarbor ? 2026 : 4051);
  const add = (list: THREE.BufferGeometry[], x: number, z: number, rot = 0, scale = 1, y = GROUND_Y) =>
    pieces.push(...props.place(list, x, y, z, rot, scale));
  /** 낮은 장식으로 넣는다 */
  const addLow = (list: THREE.BufferGeometry[], x: number, z: number, rot = 0, scale = 1) => {
    pieces = low;
    add(list, x, z, rot, scale);
    pieces = tall;
  };
  const seed = () => Math.floor(rnd() * 1e6);

  // 광장: 큰 귤나무, 벤치, 등불
  add(props.plazaTree(), PLAZA_LOCAL.x, PLAZA_LOCAL.z, 0, 1.15);
  for (const [dx, dz, rot] of [
    [-4.3, -2.6, 0.55],
    [4.3, -2.6, -0.55],
    [-4.4, 2.5, Math.PI - 0.6],
    [4.4, 2.5, Math.PI + 0.6],
  ] as Array<[number, number, number]>) {
    add(props.plazaBench(), PLAZA_LOCAL.x + dx, PLAZA_LOCAL.z + dz, rot);
  }
  for (const [dx, dz] of [
    [-3.2, -4.6],
    [3.2, -4.6],
    [-3.4, 4.4],
    [3.4, 4.4],
  ]) {
    lanterns.push([PLAZA_LOCAL.x + dx, PLAZA_LOCAL.z + dz]);
  }
  // 광장 둘레 잔디밭 (집 자리를 뺀 곳)
  const plazaLawn = { x0: colX(4) - 3, x1: colX(7) + 3, z0: rowZ(4) - 3, z1: rowZ(5) + 3 };
  for (let i = 0; i < 26; i++) {
    const x = plazaLawn.x0 + rnd() * (plazaLawn.x1 - plazaLawn.x0);
    const z = plazaLawn.z0 + rnd() * (plazaLawn.z1 - plazaLawn.z0);
    const dp = Math.hypot(x - PLAZA_LOCAL.x, z - PLAZA_LOCAL.z);
    if (dp < PLAZA_LOCAL.r + 0.8 || Math.abs(x) < 1.6 || Math.abs(z - pathZ(4)) < 1.5 || z > plazaLawn.z1 - 0.6) continue;
    const k = rnd();
    if (k < 0.5) {
      addLow(props.flowers(seed()), x, z, rnd() * 6, 1.1);
      fireflies.push([x, GROUND_Y + 0.8 + rnd() * 1.2, z]);
    } else if (k < 0.8) addLow(props.bush(seed()), x, z, rnd() * 6, 1.1);
    else add(props.roundTree(seed()), x, z, rnd() * 6, 1.05);
  }

  // 큰길 모퉁이 등불 (줄마다 좌우 번갈아)
  for (let row = 0; row < ZONE.rows; row += 1) {
    if (row === 4) continue;
    lanterns.push([(row % 2 ? -1 : 1) * 1.14, pathZ(row) - 1.02]);
  }
  // 줄 끝 등불
  for (let row = 1; row < ZONE.rows; row += 2) {
    lanterns.push([ROW_EXTENT[row].max + 0.9, pathZ(row) - 0.2], [ROW_EXTENT[row].min - 0.9, pathZ(row) - 0.2]);
  }

  // 빈터: 작은 쉼터처럼 꾸민다 (나중에 땅 넓히기용 자리)
  RESERVED_LOTS.forEach((lot, i) => {
    const v = i % 3;
    if (v === 0) {
      add(props.roundTree(seed()), lot.x - 0.8, lot.z - 1.2, rnd() * 6, 1.3);
      addLow(props.bush(seed()), lot.x + 1.4, lot.z - 0.2, rnd() * 6, 1.2);
    } else if (v === 1) {
      add(props.coneTree(seed()), lot.x + 1.0, lot.z - 1.4, rnd() * 6, 1.15);
      add(props.coneTree(seed()), lot.x - 1.3, lot.z - 0.6, rnd() * 6, 0.95);
      addLow(props.rock(seed()), lot.x + 0.4, lot.z + 1.5, rnd() * 6, 1);
    } else {
      add(props.plazaBench(), lot.x, lot.z - 0.6, 0);
      addLow(props.bush(seed()), lot.x - 1.9, lot.z - 1.5, rnd() * 6, 1.1);
    }
    for (let k = 0; k < 3; k++) {
      const fx = lot.x + (rnd() - 0.5) * 4.6;
      const fz = lot.z + 0.4 + rnd() * 2.2;
      addLow(props.flowers(seed()), fx, fz, rnd() * 6, 1.2);
      if (k < 2) fireflies.push([fx, GROUND_Y + 0.7 + rnd() * 1.1, fz]);
    }
  });

  // 섬 가장자리: 마당과 길을 피해서 나무와 덤불을 흩뿌린다
  const lots = [...LOCAL_SLOTS, ...RESERVED_LOTS];
  const isFree = (x: number, z: number, margin: number) => {
    if (zoneBaseLand(x, z) < 4.3 + margin) return false;
    if (Math.abs(x) < 1.5 + margin) return false;
    if (withHarbor && Math.abs(x - HARBOR.x) < 1.6 + margin && z > 40) return false;
    for (let row = 0; row < ZONE.rows; row++) {
      if (Math.abs(z - pathZ(row)) < 1.2 + margin && x > ROW_EXTENT[row].min - 1 && x < ROW_EXTENT[row].max + 1) return false;
    }
    if (Math.abs(z - pathZ(MID_ROW)) < 1.6 + margin) return false;
    for (const l of lots) if (Math.abs(x - l.x) < 3.5 + margin && Math.abs(z - l.z) < 3.5 + margin) return false;
    if (x > plazaLawn.x0 && x < plazaLawn.x1 && z > plazaLawn.z0 && z < plazaLawn.z1) return false;
    return true;
  };
  const taken: Array<[number, number, number]> = [];
  const scatter = (
    count: number,
    margin: number,
    gap: number,
    make: (s: number) => props.Pieces,
    scale: [number, number],
    isLow = false,
  ) => {
    let placed = 0;
    let tries = 0;
    while (placed < count && tries++ < 6000) {
      const x = (rnd() - 0.5) * ZONE.halfX * 2;
      const z = (rnd() - 0.5) * ZONE.halfZ * 2;
      if (!isFree(x, z, margin)) continue;
      if (taken.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + gap)) continue;
      taken.push([x, z, gap]);
      (isLow ? addLow : add)(make(seed()), x, z, rnd() * Math.PI * 2, scale[0] + rnd() * (scale[1] - scale[0]));
      placed++;
    }
  };
  scatter(24, 0.5, 1.5, props.roundTree, [1.0, 1.4]);
  scatter(16, 0.4, 1.3, props.coneTree, [0.95, 1.3]);
  scatter(28, 0.0, 0.8, props.bush, [0.9, 1.3], true);
  scatter(10, 0.0, 0.7, props.rock, [0.7, 1.1], true);
  scatter(44, -0.2, 0.4, props.flowers, [1.0, 1.3], true);

  for (const [x, z] of lanterns) add(props.lantern(), x, z);

  if (withHarbor) {
    const dockZ = ZONE.halfZ + 3.4;
    pieces.push(...props.place(props.dock(HARBOR.dockLength, 0.5), HARBOR.x, 0, dockZ));
    lanterns.push([HARBOR.x + 1.5, ZONE.halfZ - 2.2]);
    add(props.lantern(), HARBOR.x + 1.5, ZONE.halfZ - 2.2);
  }

  return { geometry: mergeParts(tall, GLOW_ATTRS), ground: mergeParts(low, GLOW_ATTRS), lanterns, fireflies };
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class World {
  readonly group = new THREE.Group();
  readonly mapUniforms: MapUniforms = createMapUniforms();
  readonly seaUniforms: ReturnType<typeof createSea>['uniforms'];
  map!: MapField;
  /** 열린 구역 수 / 그려진 구역 수(열린 구역 + 맛보기로 보이는 잠긴 구역) */
  unlocked = 0;
  built = 0;
  bounds: WorldBounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };

  private readonly atmosphere: Atmosphere;
  private readonly noise = createNoiseTexture();
  private readonly terrainMaterial: THREE.MeshLambertMaterial;
  private readonly decorMaterial: THREE.MeshLambertMaterial;
  private readonly cloudMaterial: THREE.MeshLambertMaterial;
  private readonly sea: THREE.Mesh;
  private readonly zonesGroup = new THREE.Group();
  private readonly templates = new Map<boolean, DecorTemplate>();
  private readonly pools = new GlowPools(1200);
  private readonly fireflyLayers: Fireflies[] = [];
  private bridgeGeometry: THREE.BufferGeometry | null = null;
  private boatGeometry: THREE.BufferGeometry | null = null;
  private cloudGeometry: THREE.BufferGeometry | null = null;
  private boat: THREE.Mesh | null = null;
  private clouds: THREE.InstancedMesh[] = [];
  private fireflyScale: [number, number] = [800, 30];
  private readonly zoneOnly: THREE.BufferGeometry[] = [];
  private readonly tallDecor: THREE.Mesh[] = [];
  private readonly groundDecor: THREE.Mesh[] = [];

  constructor(atmosphere: Atmosphere) {
    this.atmosphere = atmosphere;
    this.terrainMaterial = createTerrainMaterial(this.mapUniforms, this.noise, atmosphere);
    this.decorMaterial = createGlowLambert(atmosphere.shared, { instanced: false });
    this.cloudMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#9fb4c8', emissiveIntensity: 0.35 });
    const sea = createSea(this.mapUniforms, this.noise, atmosphere);
    this.sea = sea.mesh;
    this.seaUniforms = sea.uniforms;
    this.group.add(this.sea, this.zonesGroup, this.pools.mesh);
  }

  /** 구역 가운데 기준 땅 높이를 알려준다 (집/고양이 배치용은 아님, 전부 GROUND_Y 평지) */
  landAt(x: number, z: number) {
    return this.map.landAt(x, z);
  }

  /** 필요한 구역 수에 맞춰 섬을 다시 만든다. 바뀐 게 없으면 아무것도 하지 않는다 */
  rebuild(unlocked: number, teaser: number) {
    unlocked = Math.max(1, Math.floor(unlocked));
    const built = unlocked + teaser;
    if (unlocked === this.unlocked && built === this.built) return false;
    this.unlocked = unlocked;
    this.built = built;
    this.clearZones();

    // 다리가 놓이는 방향 (열린 구역끼리만)
    const links = Array.from({ length: built }, () => ({ e: false, w: false, n: false, s: false }));
    const bridges: Array<{ x: number; z: number; axis: 'x' | 'z' }> = [];
    for (let k = 1; k < unlocked; k++) {
      const l = zoneLink(k)!;
      const a = zoneCenter(l.from);
      const b = zoneCenter(l.to);
      if (l.axis === 'x') {
        links[l.from][l.sign > 0 ? 'e' : 'w'] = true;
        links[l.to][l.sign > 0 ? 'w' : 'e'] = true;
        bridges.push({ x: (a.x + b.x) / 2, z: a.z + pathZ(MID_ROW), axis: 'x' });
      } else {
        links[l.from][l.sign > 0 ? 's' : 'n'] = true;
        links[l.to][l.sign > 0 ? 'n' : 's'] = true;
        bridges.push({ x: a.x, z: (a.z + b.z) / 2, axis: 'z' });
      }
    }

    const shapes: ZoneShape[] = [];
    const b: WorldBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let zone = 0; zone < built; zone++) {
      const c = zoneCenter(zone);
      const south = zone === 0 ? 13 : 6;
      const shape: ZoneShape = {
        minX: c.x - ZONE.halfX - 6,
        maxX: c.x + ZONE.halfX + 6,
        minZ: c.z - ZONE.halfZ - 6,
        maxZ: c.z + ZONE.halfZ + south,
        land: (x, z) => zoneLandLocal(zone, x - c.x, z - c.z),
        paths: zonePathsLocal(zone, links[zone]).map((s) => ({
          ax: s.ax + c.x,
          az: s.az + c.z,
          bx: s.bx + c.x,
          bz: s.bz + c.z,
          r: s.r,
        })),
        plazas: [{ x: c.x + PLAZA_LOCAL.x, z: c.z + PLAZA_LOCAL.z, r: PLAZA_LOCAL.r }],
        locked: zone >= unlocked,
      };
      shapes.push(shape);
      if (zone < unlocked) {
        b.minX = Math.min(b.minX, c.x - ZONE.halfX);
        b.maxX = Math.max(b.maxX, c.x + ZONE.halfX);
        b.minZ = Math.min(b.minZ, c.z - ZONE.halfZ);
        b.maxZ = Math.max(b.maxZ, c.z + ZONE.halfZ + (zone === 0 ? 8 : 0));
      }
    }
    this.bounds = b;
    this.map?.dispose();
    this.map = new MapField(shapes);
    applyMap(this.mapUniforms, this.map);

    const poolList: Pool[] = [];
    for (let zone = 0; zone < built; zone++) {
      const c = zoneCenter(zone);
      const shape = shapes[zone];
      const geo = buildTerrainGeometry(shape, shape.land, 1.5);
      this.zoneOnly.push(geo);
      const terrain = new THREE.Mesh(geo, this.terrainMaterial);
      terrain.receiveShadow = true;
      this.zonesGroup.add(terrain);

      if (zone >= unlocked) {
        this.addClouds(zone, c);
        continue;
      }
      const tpl = this.template(zone === 0);
      const decor = new THREE.Mesh(tpl.geometry, this.decorMaterial);
      decor.position.set(c.x, 0, c.z);
      decor.castShadow = true;
      decor.receiveShadow = true;
      this.tallDecor.push(decor);
      const ground = new THREE.Mesh(tpl.ground, this.decorMaterial);
      ground.position.set(c.x, 0, c.z);
      ground.receiveShadow = true;
      this.groundDecor.push(ground);
      this.zonesGroup.add(decor, ground);
      for (const [lx, lz] of tpl.lanterns) poolList.push({ x: c.x + lx, y: GROUND_Y + 0.05, z: c.z + lz, sx: 5.2, sz: 5.2 });
      const ff = new Fireflies(tpl.fireflies, this.atmosphere.shared);
      ff.points.position.set(c.x, 0, c.z);
      ff.resize(this.fireflyScale[0], this.fireflyScale[1]);
      this.fireflyLayers.push(ff);
      this.zonesGroup.add(ff.points);

      if (zone === 0) {
        this.boatGeometry ??= mergeParts(props.boat(), GLOW_ATTRS);
        this.boat = new THREE.Mesh(this.boatGeometry, this.decorMaterial);
        this.boat.castShadow = true;
        this.boat.position.set(c.x + HARBOR.x + 2.9, 0, c.z + ZONE.halfZ + 3.4 + 3.7);
        this.boat.rotation.y = 0.25;
        this.zonesGroup.add(this.boat);
      }
    }

    if (bridges.length) {
      this.bridgeGeometry ??= mergeParts(props.bridge(ZONE.gap + BRIDGE_OVERLAP * 2, GROUND_Y), GLOW_ATTRS);
      for (const br of bridges) {
        const m = new THREE.Mesh(this.bridgeGeometry, this.decorMaterial);
        m.position.set(br.x, 0, br.z);
        if (br.axis === 'z') m.rotation.y = Math.PI / 2;
        m.castShadow = true;
        m.receiveShadow = true;
        this.zonesGroup.add(m);
      }
    }
    this.pools.set(poolList.slice(0, 1200));
    return true;
  }

  /** 그려진 구역(잠긴 맛보기 구역 포함) 전체의 범위. 카메라가 여기까지는 갈 수 있다 */
  get viewBounds(): WorldBounds {
    const b = { ...this.bounds };
    for (let zone = this.unlocked; zone < this.built; zone++) {
      const c = zoneCenter(zone);
      b.minX = Math.min(b.minX, c.x - ZONE.halfX * 0.5);
      b.maxX = Math.max(b.maxX, c.x + ZONE.halfX * 0.5);
      b.minZ = Math.min(b.minZ, c.z - ZONE.halfZ * 0.5);
      b.maxZ = Math.max(b.maxZ, c.z + ZONE.halfZ * 0.5);
    }
    return b;
  }

  resize(viewportHpx: number, fovDeg: number) {
    this.fireflyScale = [viewportHpx, fovDeg];
    for (const f of this.fireflyLayers) f.resize(viewportHpx, fovDeg);
  }

  update(focusX: number, focusZ: number, dist: number) {
    const t = this.atmosphere.shared.uTime.value;
    const night = this.atmosphere.shared.uNight.value;
    this.seaUniforms.uFocus.value.set(focusX, focusZ);
    this.seaUniforms.uFade.value.set(80 + dist * 1.6, 420 + dist * 4);
    this.pools.update(night);
    for (const f of this.fireflyLayers) f.points.visible = night > 0.02 && dist < 150;
    // 멀리서는 꽃/덤불을 숨기고, 나무 그림자도 끈다 (그 거리에서는 거의 안 보인다)
    for (const g of this.groundDecor) g.visible = dist < 210;
    for (const d of this.tallDecor) d.castShadow = dist < 190;
    if (this.boat) {
      this.boat.position.y = Math.sin(t * 1.1) * 0.05 - 0.02;
      this.boat.rotation.z = Math.sin(t * 0.9) * 0.045;
      this.boat.rotation.x = Math.sin(t * 0.7 + 1) * 0.03;
    }
    // 구름은 아주 천천히 일렁인다
    for (const c of this.clouds) c.position.y = Math.sin(t * 0.25 + c.id) * 0.25;
  }

  dispose() {
    this.clearZones();
    this.map?.dispose();
    this.noise.dispose();
    this.terrainMaterial.dispose();
    this.decorMaterial.dispose();
    this.cloudMaterial.dispose();
    this.sea.geometry.dispose();
    (this.sea.material as THREE.Material).dispose();
    this.pools.dispose();
    for (const t of this.templates.values()) {
      t.geometry.dispose();
      t.ground.dispose();
    }
    this.bridgeGeometry?.dispose();
    this.boatGeometry?.dispose();
    this.cloudGeometry?.dispose();
  }

  private template(withHarbor: boolean): DecorTemplate {
    let t = this.templates.get(withHarbor);
    if (!t) {
      t = buildDecorTemplate(withHarbor);
      this.templates.set(withHarbor, t);
    }
    return t;
  }

  private addClouds(zone: number, c: { x: number; z: number }) {
    this.cloudGeometry ??= new THREE.SphereGeometry(1, 12, 8);
    const rnd = mulberry32(zone * 131 + 7);
    const puffs: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (let gx = -ZONE.halfX; gx <= ZONE.halfX; gx += 10.5) {
      for (let gz = -ZONE.halfZ; gz <= ZONE.halfZ; gz += 10.5) {
        if (zoneBaseLand(gx, gz) < -3) continue;
        const r = 7.5 + rnd() * 4.5;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(c.x + gx + (rnd() - 0.5) * 6, 5.5 + rnd() * 3.5, c.z + gz + (rnd() - 0.5) * 6),
          q,
          new THREE.Vector3(r, r * (0.42 + hash01(puffs.length, zone) * 0.2), r * 0.9),
        );
        puffs.push(m);
      }
    }
    const mesh = new THREE.InstancedMesh(this.cloudGeometry, this.cloudMaterial, puffs.length);
    puffs.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    this.clouds.push(mesh);
    this.zonesGroup.add(mesh);
  }

  private clearZones() {
    this.zonesGroup.clear();
    this.tallDecor.length = 0;
    this.groundDecor.length = 0;
    for (const g of this.zoneOnly) g.dispose();
    this.zoneOnly.length = 0;
    for (const f of this.fireflyLayers) f.dispose();
    this.fireflyLayers.length = 0;
    for (const c of this.clouds) c.dispose();
    this.clouds.length = 0;
    this.boat = null;
  }
}
