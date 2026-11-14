import * as THREE from 'three';
import type { Atmosphere } from '../core/atmosphere';
import { createGlowLambert, GLOW_ATTRS } from '../core/glowLambert';
import {
  BRIDGE,
  bridgeOf,
  HARBOR,
  linkPaths,
  NEIGHBORHOODS,
  PLAZA_R,
  POND_R,
  ZONE,
  ZONE_PATHS,
  ZONE_SCENERY,
  zoneBaseLand,
  zoneCenter,
  zoneLandLocal,
  zoneLink,
} from '../layout';
import { mergeParts } from '../util/geo';
import { hash01, mulberry32 } from '../util/rand';
import { GROUND_Y } from './constants';
import { createNoiseTexture, MapField, type ZoneShape } from './mapField';
import { applyMap, createMapUniforms, type MapUniforms } from './mapUniforms';
import { Fireflies, GlowPools, type Pool } from './nightFx';
import * as props from './props';
import { createSea } from './sea';
import { buildTerrainGeometry, createTerrainMaterial } from './terrain';

/**
 * 섬 전체(군도)를 만든다: 구역별 땅, 장식, 다리, 항구, 잠긴 구역의 구름, 바다.
 * 집/고양이/아이템은 여기서 다루지 않는다.
 *
 * 어디에 무엇이 있는지(동네, 길, 나무, 바위)는 layout.ts 가 정하고, 여기서는 그대로 그리기만 한다.
 * 구역 수가 바뀔 때만 다시 만든다 (드문 일). 장식은 한 번 만든 모양을 구역마다 다시 쓴다.
 */

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
  const lanterns: Array<[number, number]> = [];
  const fireflies: Array<[number, number, number]> = [];
  const rnd = mulberry32(4051);
  for (const s of ZONE_SCENERY) {
    let pieces: props.Pieces;
    let list = tall;
    switch (s.kind) {
      case 'plazaTree':
        pieces = props.plazaTree();
        break;
      case 'bigTree':
        pieces = props.bigTree();
        break;
      case 'roundTree':
        pieces = props.roundTree(s.seed);
        break;
      case 'coneTree':
        pieces = props.coneTree(s.seed);
        break;
      case 'bench':
        pieces = props.plazaBench();
        break;
      case 'lantern':
        pieces = props.lantern();
        lanterns.push([s.x, s.z]);
        break;
      case 'pond':
        pieces = props.pond(POND_R, s.seed);
        break;
      case 'bush':
        pieces = props.bush(s.seed);
        list = low;
        break;
      case 'rock':
        pieces = props.rock(s.seed);
        break;
      case 'tuft':
        pieces = props.tuft(s.seed);
        list = low;
        break;
      default:
        pieces = props.flowers(s.seed);
        list = low;
        if (rnd() < 0.3) fireflies.push([s.x, GROUND_Y + 0.7 + rnd() * 1.2, s.z]);
    }
    list.push(...props.place(pieces, s.x, GROUND_Y, s.z, s.rot, s.scale));
  }
  if (withHarbor) {
    const dockZ = ZONE.halfZ + 3.4;
    tall.push(...props.place(props.dock(HARBOR.dockLength, 0.5), HARBOR.x, 0, dockZ));
    lanterns.push([HARBOR.x + 1.5, ZONE.halfZ - 2.2]);
    tall.push(...props.place(props.lantern(), HARBOR.x + 1.5, GROUND_Y, ZONE.halfZ - 2.2));
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
  /** 놓인 다리 (걷기에서 바다를 건널 수 있는 곳) */
  bridges: Array<{ x: number; z: number; axis: 'x' | 'z' }> = [];

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
  /** 구역별 묶음과 그 범위. 화면에 안 걸리는 구역은 통째로 건너뛴다 */
  private readonly zoneGroups: Array<{ group: THREE.Group; box: THREE.Box3 }> = [];
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
      if (l.axis === 'x') {
        links[l.from][l.sign > 0 ? 'e' : 'w'] = true;
        links[l.to][l.sign > 0 ? 'w' : 'e'] = true;
      } else {
        links[l.from][l.sign > 0 ? 's' : 'n'] = true;
        links[l.to][l.sign > 0 ? 'n' : 's'] = true;
      }
      bridges.push(bridgeOf(k)!);
    }

    this.bridges = bridges;
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
        paths: [...ZONE_PATHS, ...linkPaths(links[zone], zone === 0)].map((s) => ({
          ax: s.ax + c.x,
          az: s.az + c.z,
          bx: s.bx + c.x,
          bz: s.bz + c.z,
          r: s.r,
        })),
        plazas: NEIGHBORHOODS.filter((n) => n.feature === 'plaza').map((n) => ({ x: c.x + n.x, z: c.z + n.z, r: PLAZA_R })),
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
      terrain.frustumCulled = false;
      const zg = new THREE.Group();
      zg.add(terrain);
      this.zonesGroup.add(zg);
      this.zoneGroups.push({
        group: zg,
        box: new THREE.Box3(new THREE.Vector3(shape.minX, -2, shape.minZ), new THREE.Vector3(shape.maxX, 16, shape.maxZ)),
      });

      if (zone >= unlocked) {
        zg.add(this.addClouds(zone, c));
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
      decor.frustumCulled = false;
      ground.frustumCulled = false;
      this.groundDecor.push(ground);
      zg.add(decor, ground);
      for (const [lx, lz] of tpl.lanterns) if (poolList.length < 1200) poolList.push({ x: c.x + lx, y: GROUND_Y + 0.05, z: c.z + lz, sx: 5.2, sz: 5.2 });
      const ff = new Fireflies(tpl.fireflies, this.atmosphere.shared);
      ff.points.position.set(c.x, 0, c.z);
      ff.resize(this.fireflyScale[0], this.fireflyScale[1]);
      this.fireflyLayers.push(ff);
      zg.add(ff.points);

      if (zone === 0) {
        this.boatGeometry ??= mergeParts(props.boat(), GLOW_ATTRS);
        this.boat = new THREE.Mesh(this.boatGeometry, this.decorMaterial);
        this.boat.castShadow = true;
        this.boat.position.set(c.x + HARBOR.x + 2.9, 0, c.z + ZONE.halfZ + 3.4 + 3.7);
        this.boat.rotation.y = 0.25;
        zg.add(this.boat);
      }
    }

    if (bridges.length) {
      this.bridgeGeometry ??= mergeParts(props.bridge(BRIDGE.length, GROUND_Y, BRIDGE.rise), GLOW_ATTRS);
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

  update(focusX: number, focusZ: number, dist: number, frustum: THREE.Frustum) {
    for (const z of this.zoneGroups) z.group.visible = frustum.intersectsBox(z.box);
    const t = this.atmosphere.shared.uTime.value;
    const night = this.atmosphere.shared.uNight.value;
    this.seaUniforms.uFocus.value.set(focusX, focusZ);
    this.seaUniforms.uFade.value.set(80 + dist * 1.6, 420 + dist * 4);
    this.pools.update(night);
    for (const f of this.fireflyLayers) f.points.visible = night > 0.02 && dist < 150;
    // 멀리서는 꽃/덤불을 숨기고, 나무 그림자도 끈다 (그 거리에서는 거의 안 보인다)
    for (const g of this.groundDecor) g.visible = dist < 300;
    for (const d of this.tallDecor) d.visible = dist < 620;
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
    for (let gx = -ZONE.halfX; gx <= ZONE.halfX; gx += 13) {
      for (let gz = -ZONE.halfZ; gz <= ZONE.halfZ; gz += 13) {
        if (zoneBaseLand(gx, gz) < -3) continue;
        const r = 9.5 + rnd() * 5;
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
    return mesh;
  }

  private clearZones() {
    this.zonesGroup.clear();
    this.zoneGroups.length = 0;
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
