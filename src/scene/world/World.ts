import * as THREE from 'three';
import type { Atmosphere } from '../core/atmosphere';
import { createGlowLambert, GLOW_ATTRS } from '../core/glowLambert';
import {
  BRIDGE,
  bridgeOf,
  CAVE_HILL,
  HARBOR,
  linkPaths,
  NEIGHBORHOODS,
  PLAZA_R,
  POND_R,
  TOWN_SQUARE,
  ZONE,
  ZONE_PATHS,
  ZONE_SCENERY,
  zoneBaseLand,
  zoneCenter,
  zoneLandLocal,
  zoneLink,
} from '../layout';
import { fillAttr, mergeParts } from '../util/geo';
import { hash01, mulberry32 } from '../util/rand';
import { GROUND_Y } from './constants';
import { createNoiseTexture, MapField, type ZoneShape } from './mapField';
import { applyMap, createMapUniforms, type MapUniforms } from './mapUniforms';
import { Fireflies, GlowPools, type Pool } from './nightFx';
import * as props from './props';
import { createSea } from './sea';
import { buildTerrainGeometry, createTerrainMaterial } from './terrain';
import { buildWinterTemplate, createLedMaterial, type WinterTemplate } from './winter';

const WINTER_TREES = new Set(['plazaTree', 'bigTree', 'roundTree', 'coneTree', 'townTree']);
/** 섬 장식 꼭짓점 값. aSnow: 0 이면 겨울 밤에 위쪽에 눈, -1 이면 눈 없음(물, 눈을 모양으로 만든 겨울 나무) */
const DECOR_ATTRS = { ...GLOW_ATTRS, aSnow: 1 } as const;

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

/** winter: 나무를 눈 덮인 전나무로 (2026-11-16) */
function buildDecorTemplate(withHarbor: boolean, winter = false): DecorTemplate {
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
        pieces = winter ? props.plazaFir() : props.plazaTree();
        break;
      case 'bigTree':
        pieces = winter ? props.bigFir() : props.bigTree();
        break;
      case 'roundTree':
        pieces = winter ? props.frostedFir(props.roundFirTiers(s.seed), s.seed, undefined, 8) : props.roundTree(s.seed);
        break;
      case 'coneTree':
        pieces = winter ? props.frostedFir(props.coneFirTiers(s.seed), s.seed, undefined, 8) : props.coneTree(s.seed);
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
      case 'npcHome':
        pieces = props.npcHome(s.seed);
        break;
      case 'caveHill':
        // 산은 반지름을 직접 받으므로 scale 은 1 로 둔다
        pieces = props.caveHill(CAVE_HILL.r);
        break;
      case 'hill':
        pieces = props.hill(s.seed);
        break;
      case 'townBoard':
        pieces = props.townBoard();
        break;
      case 'stall':
        pieces = props.stall(s.seed);
        break;
      case 'townTree':
        pieces = winter ? props.townFir() : props.townTree();
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
    // 겨울 나무는 눈을 모양으로 만들었으므로 재질의 얼룩 눈을 끈다
    if (winter && WINTER_TREES.has(s.kind)) for (const g of pieces) fillAttr(g, 'aSnow', [-1]);
    if (s.kind === 'hill') {
      // 언덕은 옆으로 넓고 키는 덜 크게
      for (const g of pieces) g.scale(s.scale, s.scale * 0.85, s.scale);
      list.push(...props.place(pieces, s.x, GROUND_Y, s.z, s.rot, 1));
    } else list.push(...props.place(pieces, s.x, GROUND_Y, s.z, s.rot, s.scale));
  }
  if (withHarbor) {
    const dockZ = ZONE.halfZ + 3.4;
    tall.push(...props.place(props.dock(HARBOR.dockLength, 0.5), HARBOR.x, 0, dockZ));
    lanterns.push([HARBOR.x + 1.5, ZONE.halfZ - 2.2]);
    tall.push(...props.place(props.lantern(), HARBOR.x + 1.5, GROUND_Y, ZONE.halfZ - 2.2));
  }
  return { geometry: mergeParts(tall, DECOR_ATTRS), ground: mergeParts(low, DECOR_ATTRS), lanterns, fireflies };
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
  /** 지금 화면에 걸려서 그리는 구역 수 (확인용) */
  visibleZones = 0;
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
  private readonly templates = new Map<string, DecorTemplate>();
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
  /** 겨울 장식 (별, 장식 공, 선물)과 LED 전구. 겨울일 때만 보인다 */
  private winterTpl: WinterTemplate | null = null;
  private readonly winterDecor: THREE.Mesh[] = [];
  private readonly winterLeds: THREE.Points[] = [];
  private readonly ledMaterial: THREE.ShaderMaterial;
  private readonly ledScale = { value: 600 };
  private readonly ledMaxNight = { value: 16 };
  /** 저사양 모드: 반딧불 끔, 전구 빛 작게 (2026-11-17) */
  private low = false;
  private winter = false;

  constructor(atmosphere: Atmosphere) {
    this.atmosphere = atmosphere;
    this.terrainMaterial = createTerrainMaterial(this.mapUniforms, this.noise, atmosphere);
    this.decorMaterial = createGlowLambert(atmosphere.shared, { instanced: false, snow: 'decor' });
    this.ledMaterial = createLedMaterial(atmosphere.shared, this.ledScale, this.ledMaxNight);
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
        plazas: [...NEIGHBORHOODS.filter((n) => n.feature === 'plaza').map((n) => ({ x: c.x + n.x, z: c.z + n.z, r: PLAZA_R })), { x: c.x + TOWN_SQUARE.x, z: c.z + TOWN_SQUARE.z, r: TOWN_SQUARE.r }],
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
      decor.userData.harbor = zone === 0;
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
      // 겨울 장식은 처음 겨울을 켤 때 만든다 (안 쓰면 만들지 않는다)
      if (this.winter) this.addWinter(zg, c);
      const ff = new Fireflies(tpl.fireflies, this.atmosphere.shared);
      ff.points.position.set(c.x, 0, c.z);
      ff.resize(this.fireflyScale[0], this.fireflyScale[1]);
      this.fireflyLayers.push(ff);
      zg.add(ff.points);

      if (zone === 0) {
        this.boatGeometry ??= mergeParts(props.boat(), DECOR_ATTRS);
        this.boat = new THREE.Mesh(this.boatGeometry, this.decorMaterial);
        this.boat.castShadow = true;
        this.boat.position.set(c.x + HARBOR.x + 2.9, 0, c.z + ZONE.halfZ + 3.4 + 3.7);
        this.boat.rotation.y = 0.25;
        zg.add(this.boat);
      }
    }

    if (bridges.length) {
      this.bridgeGeometry ??= mergeParts(props.bridge(BRIDGE.length, GROUND_Y, BRIDGE.rise), DECOR_ATTRS);
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

  /** 겨울 꾸미기 켜기/끄기 */
  setWinter(on: boolean) {
    if (on === this.winter) return;
    this.winter = on;
    if (on && !this.winterDecor.length) {
      // 이미 만든 구역에 겨울 장식을 붙인다
      this.zoneGroups.forEach((z, zone) => {
        if (zone < this.unlocked) this.addWinter(z.group, zoneCenter(zone));
      });
    }
    for (const m of this.winterDecor) m.visible = on;
    for (const p of this.winterLeds) p.visible = on;
    // 나무를 겨울 전나무 / 원래 나무로 바꾼다 (장식 덩어리 모양만 갈아 끼운다)
    for (const d of this.tallDecor) d.geometry = this.template(!!d.userData.harbor, on).geometry;
  }

  private addWinter(zg: THREE.Group, c: { x: number; z: number }) {
    this.winterTpl ??= buildWinterTemplate();
    const decor = new THREE.Mesh(this.winterTpl.decor, this.decorMaterial);
    decor.position.set(c.x, 0, c.z);
    decor.castShadow = true;
    decor.frustumCulled = false;
    const leds = new THREE.Points(this.winterTpl.leds, this.ledMaterial);
    leds.position.set(c.x, 0, c.z);
    leds.frustumCulled = false;
    leds.renderOrder = 4;
    this.winterDecor.push(decor);
    this.winterLeds.push(leds);
    zg.add(decor, leds);
  }

  resize(viewportHpx: number, fovDeg: number) {
    this.ledScale.value = viewportHpx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.fireflyScale = [viewportHpx, fovDeg];
    for (const f of this.fireflyLayers) f.resize(viewportHpx, fovDeg);
  }

  /**
   * 그리는 양 조절 (2026-11-17). pixelRatio: 지금 해상도 비율, low: 저사양 모드.
   * 밤 전구는 기기 픽셀 기준 최대 크기를 해상도에 맞춰 줄인다 (해상도가 낮은데 점만 크면 화면을 덮는다).
   */
  setDetail(pixelRatio: number, low: boolean) {
    this.low = low;
    this.ledMaxNight.value = (low ? 9 : 16) * Math.min(1, pixelRatio / 2);
  }

  update(focusX: number, focusZ: number, dist: number, frustum: THREE.Frustum) {
    this.visibleZones = 0;
    for (const z of this.zoneGroups) {
      z.group.visible = frustum.intersectsBox(z.box);
      if (z.group.visible) this.visibleZones++;
    }
    const t = this.atmosphere.shared.uTime.value;
    const night = this.atmosphere.shared.uNight.value;
    this.seaUniforms.uFocus.value.set(focusX, focusZ);
    this.seaUniforms.uFade.value.set(80 + dist * 1.6, 420 + dist * 4);
    this.pools.update(night);
    // 겨울에는 반딧불 대신 전구
    for (const f of this.fireflyLayers) f.points.visible = !this.low && !this.winter && night > 0.02 && dist < 150;
    for (const d of this.winterDecor) d.visible = this.winter && dist < 620;
    for (const p of this.winterLeds) p.visible = this.winter && dist < 900;
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
    this.ledMaterial.dispose();
    this.winterTpl?.decor.dispose();
    this.winterTpl?.leds.dispose();
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

  private template(withHarbor: boolean, winter = this.winter): DecorTemplate {
    const key = `${withHarbor}-${winter}`;
    let t = this.templates.get(key);
    if (!t) {
      t = buildDecorTemplate(withHarbor, winter);
      this.templates.set(key, t);
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
    this.winterDecor.length = 0;
    this.winterLeds.length = 0;
    for (const g of this.zoneOnly) g.dispose();
    this.zoneOnly.length = 0;
    for (const f of this.fireflyLayers) f.dispose();
    this.fireflyLayers.length = 0;
    for (const c of this.clouds) c.dispose();
    this.clouds.length = 0;
    this.boat = null;
  }
}
