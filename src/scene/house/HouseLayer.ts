import * as THREE from 'three';
import { REGIONS } from '../../shared/config';
import type { House, YardItem } from '../../shared/types';
import { CatBrain } from '../cat/catBrain';
import { CatFlock } from '../cat/CatFlock';
import type { CatModel } from '../cat/catModel';
import { createGlowLambert, type GlowShared } from '../core/glowLambert';
import { LABEL_CAPACITY, LabelLayer, regionIndex, type LabelEntry } from '../core/labelLayer';
import { itemDef, type ItemGeometries } from '../free/catalog';
import type { DrawingStore } from '../free/drawings';
import { FreeItems, type FreeGroup } from '../free/FreeItems';
import { blockersOf, yardSpace, type Space } from '../free/space';
import type { PlacedItem } from '../free/types';
import { cellToLocal, ItemField } from '../items/ItemField';
import { houseSlot, NEIGHBORHOODS, NEIGHBORHOODS_PER_ZONE, ZONE, zoneCenter } from '../layout';
import { hash01 } from '../util/rand';
import { GROUND_Y, HOUSE_OFFSET_Z, YARD_WORLD } from '../world/constants';
import { GlowPools, type Pool } from '../world/nightFx';
import {
  buildFarHouseGeometry,
  buildFlagGeometry,
  buildHouseGeometry,
  buildRoofArtGeometry,
  buildYardGeometry,
  FLAG_DIM,
  HOUSE_DIM,
} from './houseGeometry';

/**
 * 집 전체를 관리한다. 3,000채에서도 가볍게 돌도록 두 단계로 그린다.
 *
 * - 먼 집: 구역마다 InstancedMesh 하나. 단순한 집 모양(삼각형 약 70개)에 지붕 색, 창문 불빛만.
 *          화면 밖 구역은 통째로 건너뛴다.
 * - 가까운 집: 화면 가운데 근처 몇십 채만 자세한 집 + 마당 + 고양이 + 이름표 + 꾸미기 아이템.
 *          집이 화면에서 작아지면(1칸이 NEAR_PX 픽셀보다 작으면) 가까운 집은 0채가 된다.
 *          그림자는 가까운 집도 단순 모델이 대신 드리운다 (자세한 모델은 그림자를 만들지 않는다).
 * - 깃발: 구역마다 InstancedMesh 하나, 색은 인스턴스 색. 동네 시점에서만 작게 보인다.
 * - 동네 색: 전체 시점에서는 깃발 대신 동네마다 그 동네에 가장 많은 지역의 색을 옅게 깐다.
 * - 걷기 모드에서는 화면 가운데가 아니라 내 고양이 둘레의 집을 자세히 그린다.
 */
const NEAR_MAX = 64;
const NEAR_PORTRAIT = 36;
/** 마당 한 칸(1)이 화면에서 이 픽셀보다 작게 보이면 전부 단순 모델로 그린다 */
const NEAR_PX = 10.5;
/** 이보다 작게 보이면 이름표를 숨긴다 (옆집 이름표와 겹치기 때문) */
const LABEL_PX = 14;
/** 이보다 크게 보이면(아주 가까이) 고양이를 자세한 모델로 바꾼다 */
const CAT_HI_PX = 42;
const CAT_SCALE = 1.12;
/** 깃발 위치 (마당 가운데 기준): 입구 디딤돌 바로 왼쪽, 마당 앞 테두리 위 */
const FLAG_LOCAL = { x: -1.55, z: YARD_WORLD / 2 - 0.02 };
const FLAG_SCALE = 0.8;
/** 걷기 모드에서 자세히 그리는 범위 (내 고양이 기준) */
const WALK_NEAR_RADIUS = 40;
const WALK_NEAR_MAX = 26;
/** 고양이가 돌아다니는 범위 (마당 가운데 기준): 집 앞 잔디밭 */
/** 걸어서 지나갈 수 없는 큰 아이템과 그 반지름 (나머지는 작아서 지나간다) */
/** 지붕 그림은 가까운 집부터 이만큼까지만 그린다 (그림마다 텍스처가 달라서 하나씩 따로 그린다) */
const ROOF_ART_MAX = 32;
const BLOCKING_ITEMS: Partial<Record<YardItem['type'], number>> = { cat_tower: 0.42, bench: 0.48, hammock: 0.5, fish_rack: 0.42 };
const CAT_AREA = { minX: -2.2, maxX: 2.2, minZ: 0.7, maxZ: 2.45 };

interface Rec {
  house: House;
  x: number;
  z: number;
  /** 집이 몸을 튼 각도와 그 cos/sin */
  rot: number;
  cos: number;
  sin: number;
  /** 집(건물) 가운데 */
  hx: number;
  hz: number;
  zone: number;
  /** 구역 안 동네 번호 */
  nb: number;
  /** 구역 먼 집 메시 안에서의 순번 */
  farIndex: number;
  occupied: boolean;
  region: number;
  lit: number;
  score: number;
}

interface ZoneBatch {
  zone: number;
  cx: number;
  cz: number;
  list: Rec[];
  far: THREE.InstancedMesh;
  state: THREE.InstancedBufferAttribute;
  flags: THREE.InstancedMesh | null;
  /** 전체 시점에서 보이는 동네 색 */
  tint: THREE.InstancedMesh;
  box: THREE.Box3;
}

interface NearCat {
  brain: CatBrain;
  rec: Rec;
}

export class HouseLayer {
  readonly group = new THREE.Group();
  private readonly shared: GlowShared;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly flagMaterial: THREE.MeshLambertMaterial;
  private readonly flagUniforms = { uTime: { value: 0 }, uFlagScale: { value: 1 } };
  private readonly farGeometry = buildFarHouseGeometry(YARD_WORLD, -HOUSE_OFFSET_Z);
  private readonly flagGeometry = buildFlagGeometry();
  private readonly tintGeometry = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  private readonly tintMaterial: THREE.ShaderMaterial;
  private readonly tintUniforms: { uOpacity: { value: number }; uRegion: { value: THREE.Vector2 } };
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  /** 걷기 모드에서 내 고양이 위치 (없으면 null) */
  private walkAt: { x: number; z: number } | null = null;
  private nearLimit = NEAR_MAX;
  /** 걷기 모드에서 내가 조작 중인 고양이의 집 (마당에는 그리지 않는다) */
  private awayCat: number | null = null;
  private readonly nearHouses: THREE.InstancedMesh;
  private readonly nearYards: THREE.InstancedMesh;
  private readonly nearTint: THREE.InstancedBufferAttribute;
  private readonly nearState: THREE.InstancedBufferAttribute;
  private readonly yardState: THREE.InstancedBufferAttribute;
  private readonly flockLo: CatFlock;
  private readonly flockHi: CatFlock;
  /** 지금 쓰는 고양이 무리 (거리에 따라 가벼운 것 / 자세한 것) */
  private flock: CatFlock;
  private lastNearOn = false;
  private farShadows = true;
  private readonly items: ItemField;
  private readonly labels: LabelLayer;
  private readonly pools = new GlowPools(NEAR_MAX);
  private readonly recs = new Map<number, Rec>();
  private readonly zones = new Map<number, ZoneBatch>();
  private readonly yardItems = new Map<number, YardItem[]>();
  /** 자유 배치 아이템 (집 번호 → 목록) */
  private readonly freeLists = new Map<number, PlacedItem[]>();
  private readonly spaces = new Map<number, Space>();
  readonly free: FreeItems;
  /** 지금 손에 들고 있어서 따로 그리는 아이템 */
  private freeSkip: string | null = null;
  /** 지붕 그림 (집 번호 → 그림 id) */
  private readonly roofArt = new Map<number, string>();
  private readonly roofArtGeometry = buildRoofArtGeometry();
  private readonly roofArtMeshes: THREE.Mesh[] = [];
  /** 확인용: 지금 그리는 지붕 그림 수 */
  shownRoofArt = 0;
  private near: Rec[] = [];
  private readonly cats = new Map<number, NearCat>();
  private catOrder: NearCat[] = [];
  private dirty = true;
  private lastX = Infinity;
  private lastZ = Infinity;
  private lastDist = 0;
  private lastAspect = 0;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private readonly box = new THREE.Box3();
  private readonly v = new THREE.Vector3();

  constructor(
    shared: GlowShared,
    catModel: CatModel,
    geometries: ItemGeometries,
    private readonly drawings: DrawingStore,
  ) {
    this.shared = shared;
    this.free = new FreeItems(shared, geometries, drawings);
    this.material = createGlowLambert(shared, { instanced: true });

    // 깃발 재질: 인스턴스 색은 천에만 입히고, 천은 바람에 펄럭인다
    this.flagUniforms.uTime = shared.uTime;
    this.flagMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.flagMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.flagUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec2 aMask;
          uniform float uTime;
          uniform float uFlagScale;
          varying float vCloth;`,
        )
        .replace(
          '#include <color_vertex>',
          `vColor = vec4(color, 1.0);
          #ifdef USE_INSTANCING_COLOR
            vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aMask.x);
          #endif
          vCloth = aMask.x;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          if (aMask.x > 0.5) {
            // 천: 깃대에 붙은 쪽을 기준으로 멀리서는 크게, 끝으로 갈수록 크게 펄럭인다
            vec3 hinge = vec3(0.04, ${(FLAG_DIM.height - FLAG_DIM.clothH / 2 - 0.06).toFixed(3)}, 0.0);
            transformed = hinge + (transformed - hinge) * uFlagScale;
            float phase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.4;
            float wave = sin(uTime * 4.2 - aMask.y * 4.5 + phase);
            transformed.z += wave * 0.08 * aMask.y * uFlagScale;
            transformed.y += cos(uTime * 3.1 - aMask.y * 3.0 + phase) * 0.02 * aMask.y * uFlagScale;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCloth;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // 밤이나 그늘에서도 지역 색이 읽히도록 천은 조금 스스로 빛난다
          totalEmissiveRadiance += diffuseColor.rgb * 0.22 * vCloth;`,
        );
    };
    this.flagMaterial.customProgramCacheKey = () => 'region-flag-v1';

    // 동네 색: 가장자리가 부드러운 옅은 색 원. 강조 지역이 있으면 다른 지역 동네는 흐려진다
    this.tintUniforms = { uOpacity: { value: 0 }, uRegion: shared.uRegion };
    this.tintMaterial = new THREE.ShaderMaterial({
      uniforms: this.tintUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 iColor;
        attribute float iRegion;
        uniform vec2 uRegion;
        varying vec3 vColor;
        varying float vR;
        varying float vDim;
        void main() {
          vColor = iColor;
          vR = length(position.xz);
          vDim = step(0.5, abs(iRegion - uRegion.x)) * uRegion.y;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vR;
        varying float vDim;
        void main() {
          float a = (1.0 - smoothstep(0.72, 1.0, vR)) * uOpacity * 0.7 * (1.0 - 0.8 * vDim);
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });

    const houseGeo = buildHouseGeometry();
    this.nearTint = new THREE.InstancedBufferAttribute(new Float32Array(NEAR_MAX * 3), 3);
    this.nearState = new THREE.InstancedBufferAttribute(new Float32Array(NEAR_MAX * 4), 4);
    houseGeo.setAttribute('iTint', this.nearTint);
    houseGeo.setAttribute('iState', this.nearState);
    this.nearHouses = new THREE.InstancedMesh(houseGeo, this.material, NEAR_MAX);

    const yardGeo = buildYardGeometry(YARD_WORLD, HOUSE_OFFSET_Z + HOUSE_DIM.depth / 2);
    this.yardState = new THREE.InstancedBufferAttribute(new Float32Array(NEAR_MAX * 4), 4);
    yardGeo.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(NEAR_MAX * 3).fill(1), 3));
    yardGeo.setAttribute('iState', this.yardState);
    this.nearYards = new THREE.InstancedMesh(yardGeo, this.material, NEAR_MAX);

    for (const mesh of [this.nearHouses, this.nearYards]) {
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }

    this.flockLo = new CatFlock(catModel, NEAR_MAX, 'low');
    this.flockHi = new CatFlock(catModel, NEAR_MAX, 'high');
    this.flock = this.flockLo;
    this.flockHi.mesh.visible = false;
    this.items = new ItemField(shared);
    this.labels = new LabelLayer(shared);
    this.group.add(this.flockLo.mesh, this.flockHi.mesh, this.items.group, this.free.group, this.pools.mesh, this.labels.mesh);
  }

  // ───────────── 데이터 ─────────────

  setHouses(houses: House[]) {
    this.clearZones();
    this.recs.clear();
    this.spaces.clear();
    const byZone = new Map<number, Rec[]>();
    for (const house of houses) {
      const slot = houseSlot(house.houseNo);
      const occupied = !house.isNpc && !!house.igHandle;
      const h = hash01(house.houseNo, 5);
      const rec: Rec = {
        house,
        x: slot.x,
        z: slot.z,
        rot: slot.rot,
        cos: Math.cos(slot.rot),
        sin: Math.sin(slot.rot),
        hx: slot.x + HOUSE_OFFSET_Z * Math.sin(slot.rot),
        hz: slot.z + HOUSE_OFFSET_Z * Math.cos(slot.rot),
        zone: slot.zone,
        nb: slot.neighborhood % NEIGHBORHOODS_PER_ZONE,
        farIndex: 0,
        occupied,
        region: occupied ? regionIndex(house.region) : -2,
        lit: occupied ? (h < 0.9 ? 1 : 0) : h < 0.3 ? 0.45 : 0,
        score: 0,
      };
      this.recs.set(house.houseNo, rec);
      let list = byZone.get(slot.zone);
      if (!list) byZone.set(slot.zone, (list = []));
      rec.farIndex = list.length;
      list.push(rec);
    }

    for (const [zone, list] of byZone) {
      const n = list.length;
      const geo = this.farGeometry.clone();
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const state = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      geo.setAttribute('iTint', tint);
      geo.setAttribute('iState', state);
      const far = new THREE.InstancedMesh(geo, this.material, n);
      const flagged = list.filter((r) => r.occupied);
      const flags = flagged.length ? new THREE.InstancedMesh(this.flagGeometry, this.flagMaterial, flagged.length) : null;
      list.forEach((r, i) => {
        far.setMatrixAt(i, this.place(r, 0, HOUSE_OFFSET_Z, GROUND_Y));
        this.c.set(r.house.roofColor);
        tint.setXYZ(i, this.c.r, this.c.g, this.c.b);
        state.setXYZW(i, r.occupied ? 0 : 1, r.lit, r.region, 0);
      });
      flagged.forEach((r, i) => {
        flags!.setMatrixAt(i, this.place(r, FLAG_LOCAL.x, FLAG_LOCAL.z, GROUND_Y, FLAG_SCALE));
        flags!.setColorAt(i, this.c.set(REGIONS[r.region]?.color ?? '#9aa3ad'));
      });
      far.castShadow = this.farShadows;
      far.receiveShadow = true;
      far.frustumCulled = false;
      if (flags) {
        flags.frustumCulled = false;
        if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
        this.group.add(flags);
      }
      this.group.add(far);
      const c = zoneCenter(zone);
      // 구역 범위 (화면에 안 걸리면 이 구역의 집과 깃발을 통째로 건너뛴다)
      const box = new THREE.Box3(
        new THREE.Vector3(c.x - ZONE.halfX, -1, c.z - ZONE.halfZ),
        new THREE.Vector3(c.x + ZONE.halfX, 12, c.z + ZONE.halfZ),
      );
      const nbTint = this.buildTint(list, c);
      this.group.add(nbTint);
      this.zones.set(zone, { zone, cx: c.x, cz: c.z, list, far, state, flags, tint: nbTint, box });
    }
    this.near = [];
    this.dirty = true;
  }

  setYardItems(houseNo: number, items: YardItem[]) {
    this.yardItems.set(houseNo, items);
    if (this.near.some((r) => r.house.houseNo === houseNo)) this.dirty = true;
  }

  /** 자유 배치 아이템 (기존 칸 방식 아이템과 같이 그린다) */
  setYardItemsFree(houseNo: number, items: readonly PlacedItem[]) {
    this.freeLists.set(
      houseNo,
      items.filter((it) => it && typeof it.id === 'string' && typeof it.type === 'string').map((it) => ({ ...it })),
    );
    if (this.near.some((r) => r.house.houseNo === houseNo)) this.redrawFree();
  }

  /** 지금 보여 줄 지붕 그림 전체. 목록에서 빠진 집은 그림을 뗀다 */
  setRoofArt(items: ReadonlyArray<{ houseNo: number; drawingId: string }>) {
    this.roofArt.clear();
    for (const it of items) {
      if (it && Number.isFinite(it.houseNo) && typeof it.drawingId === 'string' && it.drawingId) this.roofArt.set(it.houseNo, it.drawingId);
    }
    this.redrawRoofArt();
  }

  /** 지붕 그림만 다시 붙인다 (가까운 집이 바뀌었거나 그림 목록이 바뀌었을 때) */
  redrawRoofArt() {
    let n = 0;
    if (this.roofArt.size) {
      // near 는 가까운 순서라서 앞에서부터 채우면 가까운 집이 먼저다
      for (const r of this.near) {
        if (n >= ROOF_ART_MAX) break;
        const id = this.roofArt.get(r.house.houseNo);
        const mat = id === undefined ? null : this.drawings.roofMaterial(id);
        // 그림이 아직 안 왔으면 지붕 색만 보인다
        if (!mat) continue;
        let mesh = this.roofArtMeshes[n];
        if (!mesh) {
          mesh = this.roofArtMeshes[n] = new THREE.Mesh(this.roofArtGeometry);
          mesh.matrixAutoUpdate = false;
          mesh.frustumCulled = false;
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }
        mesh.material = mat;
        mesh.matrix.copy(this.place(r, 0, HOUSE_OFFSET_Z, GROUND_Y));
        mesh.visible = true;
        n++;
      }
    }
    for (let i = n; i < this.roofArtMeshes.length; i++) this.roofArtMeshes[i].visible = false;
    this.shownRoofArt = n;
  }

  /** 그 집의 자유 배치 목록 (끌어 놓기가 이 배열을 직접 고친다) */
  freeList(houseNo: number): PlacedItem[] {
    let list = this.freeLists.get(houseNo);
    if (!list) this.freeLists.set(houseNo, (list = []));
    return list;
  }

  /** 그 집 마당 (자유 배치 좌표의 기준). 집이 없으면 null */
  yardSpace(houseNo: number): Space | null {
    const r = this.recs.get(houseNo);
    if (!r) return null;
    let s = this.spaces.get(houseNo);
    if (!s) this.spaces.set(houseNo, (s = yardSpace(houseNo, r.x, r.z, r.rot, GROUND_Y)));
    return s;
  }

  /** 자유 배치 아이템만 다시 그린다 (skipId: 손에 든 아이템) */
  redrawFree(skipId: string | null = this.freeSkip) {
    this.freeSkip = skipId;
    const groups: FreeGroup[] = [];
    for (const r of this.near) {
      const items = this.freeLists.get(r.house.houseNo);
      if (items?.length) groups.push({ space: this.yardSpace(r.house.houseNo)!, items });
    }
    this.free.set(groups, skipId);
  }

  has(houseNo: number) {
    return this.recs.has(houseNo);
  }

  house(houseNo: number): House | undefined {
    return this.recs.get(houseNo)?.house;
  }

  /** 그 집에 놓인 꾸미기 아이템 (걷기 충돌용) */
  itemsOf(houseNo: number): YardItem[] | undefined {
    return this.yardItems.get(houseNo);
  }

  /** 걷기 모드: 내 고양이 위치를 알려주면 그 둘레의 집을 자세히 그린다. null 이면 원래대로 */
  setWalkFocus(at: { x: number; z: number } | null) {
    if (!!at !== !!this.walkAt) this.dirty = true;
    this.walkAt = at;
    this.labels.setFocus(at);
  }

  /** 이 집의 고양이는 마당에 그리지 않는다 (내가 데리고 걷는 중). null 이면 해제 */
  setAwayCat(houseNo: number | null) {
    if (houseNo !== this.awayCat) this.dirty = true;
    this.awayCat = houseNo;
  }

  /** (x, z) 가까이에 있는 큰 꾸미기 아이템을 막힌 곳으로 알려준다 (작은 아이템은 지나갈 수 있다) */
  blockersNear(x: number, z: number, out: Array<{ x: number; z: number; r: number }>) {
    let n = 0;
    for (const r of this.near) {
      if (Math.abs(r.x - x) > 5.5 || Math.abs(r.z - z) > 5.5) continue;
      const items = this.yardItems.get(r.house.houseNo);
      if (!items) continue;
      for (const it of items) {
        const size = BLOCKING_ITEMS[it.type];
        if (!size) continue;
        const lx = cellToLocal(it.x);
        const lz = cellToLocal(it.y);
        const b = (this.blockerPool[n] ??= { x: 0, z: 0, r: 0 });
        n++;
        b.x = r.x + lx * r.cos + lz * r.sin;
        b.z = r.z - lx * r.sin + lz * r.cos;
        b.r = size;
        out.push(b);
      }
    }
    for (const r of this.near) {
      if (Math.abs(r.x - x) > 5.5 || Math.abs(r.z - z) > 5.5) continue;
      const free = this.freeLists.get(r.house.houseNo);
      if (free?.length) n = blockersOf(this.yardSpace(r.house.houseNo)!, free, this.blockerPool, n, out);
    }
  }
  private readonly blockerPool: Array<{ x: number; z: number; r: number }> = [];

  /** 자세히 그리는 집 수 상한 (성능이 모자라면 줄인다) */
  setNearLimit(n: number) {
    n = Math.max(8, Math.min(NEAR_MAX, Math.floor(n)));
    if (n !== this.nearLimit) this.dirty = true;
    this.nearLimit = n;
  }

  /** 집 기준 좌표 (lx, lz) 에 놓는 행렬 */
  private place(r: Rec, lx: number, lz: number, y: number, scale = 1) {
    this.q.setFromAxisAngle(HouseLayer.UP, r.rot);
    this.v.set(r.x + lx * r.cos + lz * r.sin, y, r.z - lx * r.sin + lz * r.cos);
    return this.m.compose(this.v, this.q, this.s.setScalar(scale));
  }

  /** 동네마다 가장 많은 지역의 색을 옅게 까는 원 (전체 시점용) */
  private buildTint(list: Rec[], c: { x: number; z: number }) {
    const n = NEIGHBORHOODS.length;
    const geo = this.tintGeometry.clone();
    const color = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const region = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('iColor', color);
    geo.setAttribute('iRegion', region);
    const mesh = new THREE.InstancedMesh(geo, this.tintMaterial, n);
    const votes = NEIGHBORHOODS.map(() => new Map<number, number>());
    for (const r of list) if (r.occupied && r.region >= 0) votes[r.nb].set(r.region, (votes[r.nb].get(r.region) ?? 0) + 1);
    NEIGHBORHOODS.forEach((nb, i) => {
      let best = -2;
      let bestN = 0;
      for (const [reg, cnt] of votes[i]) {
        if (cnt > bestN || (cnt === bestN && reg < best)) {
          best = reg;
          bestN = cnt;
        }
      }
      const on = best >= 0;
      this.m.compose(
        this.v.set(c.x + nb.x, GROUND_Y + 0.5, c.z + nb.z + 1),
        this.q.identity(),
        this.s.set(on ? nb.rx + 8 : 0, 1, on ? nb.rz + 9 : 0),
      );
      mesh.setMatrixAt(i, this.m);
      this.c.set(REGIONS[best]?.color ?? '#9aa3ad');
      color.setXYZ(i, this.c.r, this.c.g, this.c.b);
      region.setX(i, best);
    });
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return mesh;
  }

  /** 집이 있는 가장 큰 구역 번호 + 1 */
  zoneCount() {
    let max = 0;
    for (const z of this.zones.keys()) max = Math.max(max, z + 1);
    return max;
  }

  // ───────────── 매 프레임 ─────────────

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    target: { x: number; z: number; dist: number },
    viewport: { w: number; h: number },
    frustum: THREE.Frustum,
  ) {
    const aspect = camera.aspect;
    const tintOpacity = THREE.MathUtils.smoothstep(target.dist, 230, 400);
    this.tintUniforms.uOpacity.value = tintOpacity;
    for (const zb of this.zones.values()) {
      const on = frustum.intersectsBox(zb.box);
      zb.far.visible = on;
      // 깃발은 동네 시점에서만, 동네 색은 전체 시점에서만
      if (zb.flags) zb.flags.visible = on && target.dist < 190;
      zb.tint.visible = on && tintOpacity > 0.01;
    }
    const moved = Math.hypot(target.x - this.lastX, target.z - this.lastZ);
    const zoomed = Math.abs(target.dist - this.lastDist) > this.lastDist * 0.05;
    // 마당 한 칸이 화면에서 몇 픽셀인가 (확대 정도)
    const px = viewport.h / (2 * target.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const nearOn = px >= NEAR_PX;
    // 걷기 모드에서는 내 고양이만 자세한 모델이고, 마당 고양이들은 가벼운 모델로 그린다
    const wantFlock = px >= CAT_HI_PX && !this.walkAt ? this.flockHi : this.flockLo;
    if (wantFlock !== this.flock) {
      this.flock.mesh.visible = false;
      this.flock = wantFlock;
      this.flock.mesh.visible = true;
      this.dirty = true;
    }
    if (this.dirty || moved > 1.8 || zoomed || nearOn !== this.lastNearOn || aspect !== this.lastAspect) {
      this.lastNearOn = nearOn;
      this.refreshNear(camera, target, nearOn);
      this.lastX = target.x;
      this.lastZ = target.z;
      this.lastDist = target.dist;
      this.lastAspect = aspect;
      this.dirty = false;
    }

    // 고양이: 가까운 집의 고양이만 움직인다
    this.catOrder.forEach((cat, i) => {
      const b = cat.brain;
      b.update(dt);
      const r = cat.rec;
      this.flock.setPose(i, r.x + b.x * r.cos + b.z * r.sin, GROUND_Y + 0.035 + b.hop, r.z - b.x * r.sin + b.z * r.cos, b.yaw + r.rot, CAT_SCALE);
      this.flock.setAnim(i, b.phase, b.walk, b.sleep, b.happy);
    });

    // 아주 멀리서는 집 그림자도 끈다
    const farShadows = target.dist < 230;
    if (farShadows !== this.farShadows) {
      this.farShadows = farShadows;
      for (const zb of this.zones.values()) zb.far.castShadow = farShadows;
    }

    this.pools.update(this.shared.uNight.value);
    const labelOpacity = THREE.MathUtils.smoothstep(px, LABEL_PX, LABEL_PX + 3.5);
    const labelScale = THREE.MathUtils.lerp(0.78, 1, THREE.MathUtils.smoothstep(px, LABEL_PX, 40));
    this.labels.update(viewport.w, viewport.h, this.walkAt ? 1 : labelScale, labelOpacity);
  }

  /** 화면에 가까이 보이는 집을 골라서 자세한 모델/고양이/이름표/아이템을 붙인다 */
  private refreshNear(camera: THREE.PerspectiveCamera, target: { x: number; z: number; dist: number }, nearOn: boolean) {
    const want: Rec[] = [];
    if (nearOn && this.walkAt) {
      // 걷기 모드: 내 고양이에서 가까운 집부터
      const w = this.walkAt;
      for (const zb of this.zones.values()) {
        if (Math.abs(zb.cx - w.x) > ZONE.halfX + WALK_NEAR_RADIUS || Math.abs(zb.cz - w.z) > ZONE.halfZ + WALK_NEAR_RADIUS) continue;
        for (const r of zb.list) {
          const d = Math.hypot(r.x - w.x, r.z - w.z);
          if (d < WALK_NEAR_RADIUS) {
            r.score = d;
            want.push(r);
          }
        }
      }
      want.sort((a, b) => a.score - b.score);
      want.length = Math.min(want.length, WALK_NEAR_MAX, this.nearLimit);
    } else if (nearOn) {
      // 화면에 보이는 땅의 대략적인 크기
      const vfov = THREE.MathUtils.degToRad(camera.fov);
      const halfW = target.dist * Math.tan(vfov / 2) * camera.aspect + 4.5;
      const halfD = (target.dist * Math.tan(vfov / 2)) / 0.66 + 4.5;
      for (const zb of this.zones.values()) {
        if (Math.abs(zb.cx - target.x) > ZONE.halfX + halfW || Math.abs(zb.cz - target.z) > ZONE.halfZ + halfD) continue;
        for (const r of zb.list) {
          const sx = Math.abs(r.x - target.x) / halfW;
          const sz = Math.abs(r.z - 1.5 - target.z) / halfD;
          const s = Math.max(sx, sz);
          if (s < 1.0) {
            r.score = s;
            want.push(r);
          }
        }
      }
      want.sort((a, b) => a.score - b.score);
      want.length = Math.min(want.length, camera.aspect < 0.8 ? NEAR_PORTRAIT : NEAR_MAX, this.nearLimit);
    }

    // 먼 집 메시에서 가까운 집은 숨기고, 빠진 집은 다시 보이게
    const now = new Set(want);
    const touched = new Set<ZoneBatch>();
    for (const r of this.near) {
      if (now.has(r)) continue;
      const zb = this.zones.get(r.zone);
      if (zb && zb.list[r.farIndex] === r) {
        zb.state.setW(r.farIndex, 0);
        touched.add(zb);
      }
    }
    const before = new Set(this.near);
    for (const r of want) {
      if (before.has(r)) continue;
      const zb = this.zones.get(r.zone)!;
      zb.state.setW(r.farIndex, 1);
      touched.add(zb);
    }
    for (const zb of touched) zb.state.needsUpdate = true;
    this.near = want;

    // 자세한 집과 마당
    want.forEach((r, i) => {
      this.nearHouses.setMatrixAt(i, this.place(r, 0, HOUSE_OFFSET_Z, GROUND_Y));
      this.nearYards.setMatrixAt(i, this.place(r, 0, 0, GROUND_Y));
      this.c.set(r.house.roofColor);
      this.nearTint.setXYZ(i, this.c.r, this.c.g, this.c.b);
      this.nearState.setXYZW(i, r.occupied ? 0 : 1, r.lit, r.region, 0);
      this.yardState.setXYZW(i, 0, 0, r.region, 0);
    });
    this.nearHouses.count = want.length;
    this.nearYards.count = want.length;
    this.nearHouses.instanceMatrix.needsUpdate = true;
    this.nearYards.instanceMatrix.needsUpdate = true;
    this.nearTint.needsUpdate = true;
    this.nearState.needsUpdate = true;
    this.yardState.needsUpdate = true;

    // 고양이: 계속 보이는 집의 고양이는 하던 행동을 이어간다
    for (const houseNo of [...this.cats.keys()]) {
      const rec = this.recs.get(houseNo);
      if (!rec || !now.has(rec)) this.cats.delete(houseNo);
    }
    this.catOrder = [];
    for (const r of want) {
      if (!r.house.cat || r.house.houseNo === this.awayCat) continue;
      let cat = this.cats.get(r.house.houseNo);
      if (!cat || cat.rec !== r) {
        cat = { brain: new CatBrain(CAT_AREA, r.house.houseNo), rec: r };
        this.cats.set(r.house.houseNo, cat);
      }
      cat.brain.setBlocked(this.blockedCells(r.house.houseNo));
      this.flock.setLook(this.catOrder.length, r.house.cat, hash01(r.house.houseNo, 99));
      this.catOrder.push(cat);
    }
    this.flock.count = this.catOrder.length;

    // 꾸미기 아이템
    this.items.set(want.map((r) => ({ x: r.x, z: r.z, rot: r.rot, items: this.yardItems.get(r.house.houseNo) })));
    this.redrawFree();
    this.redrawRoofArt();

    // 이름표: 사는 사람이 있는 집만, 화면 가운데에서 가까운 순서로
    const entries: LabelEntry[] = [];
    for (const r of want) {
      if (!r.occupied || entries.length >= LABEL_CAPACITY) continue;
      entries.push({
        houseNo: r.house.houseNo,
        handle: r.house.igHandle!,
        region: r.house.region,
        x: r.hx,
        y: GROUND_Y + HOUSE_DIM.labelY,
        z: r.hz,
      });
    }
    this.labels.set(entries);

    // 창문 불빛이 바닥에 번지는 빛
    const pools: Pool[] = [];
    for (const r of want) {
      if (r.lit < 0.9) continue;
      const front = HOUSE_OFFSET_Z + HOUSE_DIM.depth / 2 + 1.1;
      pools.push({ x: r.x + front * r.sin, y: GROUND_Y + 0.07, z: r.z + front * r.cos, sx: 4.6, sz: 4.6 });
    }
    this.pools.set(pools);
  }

  /** 고양이가 피해 다닐 칸 (아이템이 놓인 자리) */
  private blockedCells(houseNo: number): Array<[number, number]> {
    const items = this.yardItems.get(houseNo);
    const out = items ? items.map((it) => [cellToLocal(it.x), cellToLocal(it.y)] as [number, number]) : [];
    // 자유 배치 아이템 중 걸어서 못 지나가는 것
    for (const it of this.freeLists.get(houseNo) ?? []) if (itemDef(it.type).block) out.push([it.x, it.z]);
    return out;
  }

  // ───────────── 탭 ─────────────

  /** 광선에 맞은 가까운 고양이를 쓰다듬고 그 집 번호를 돌려준다 */
  petCat(ray: THREE.Ray): number | null {
    let best: NearCat | null = null;
    let bestD = 0.62;
    for (const cat of this.catOrder) {
      const r = cat.rec;
      const b = cat.brain;
      this.v.set(r.x + b.x * r.cos + b.z * r.sin, GROUND_Y + 0.5, r.z - b.x * r.sin + b.z * r.cos);
      const d = ray.distanceToPoint(this.v);
      if (d < bestD) {
        bestD = d;
        best = cat;
      }
    }
    if (!best) return null;
    best.brain.pet();
    return best.rec.house.houseNo;
  }

  /** 광선에 맞은 집(건물)을 찾는다. 가까운 집만 본다 */
  pickBuilding(ray: THREE.Ray): number | null {
    let best: Rec | null = null;
    let bestT = Infinity;
    for (const r of this.near) {
      this.box.min.set(r.hx - 1.7, GROUND_Y, r.hz - 1.5);
      this.box.max.set(r.hx + 1.7, GROUND_Y + 3.3, r.hz + 1.5);
      const hit = ray.intersectBox(this.box, this.v);
      if (!hit) continue;
      const t = hit.distanceTo(ray.origin);
      if (t < bestT) {
        bestT = t;
        best = r;
      }
    }
    return best ? best.house.houseNo : null;
  }

  dispose() {
    this.clearZones();
    this.farGeometry.dispose();
    this.flagGeometry.dispose();
    this.tintGeometry.dispose();
    this.tintMaterial.dispose();
    this.nearHouses.geometry.dispose();
    this.nearYards.geometry.dispose();
    this.roofArtGeometry.dispose();
    this.material.dispose();
    this.flagMaterial.dispose();
    this.flockLo.dispose();
    this.flockHi.dispose();
    this.items.dispose();
    this.free.dispose();
    this.labels.dispose();
    this.pools.dispose();
  }

  private clearZones() {
    for (const zb of this.zones.values()) {
      this.group.remove(zb.far);
      zb.far.geometry.dispose();
      zb.far.dispose();
      if (zb.flags) {
        this.group.remove(zb.flags);
        zb.flags.dispose();
      }
      this.group.remove(zb.tint);
      zb.tint.geometry.dispose();
      zb.tint.dispose();
    }
    this.zones.clear();
    this.cats.clear();
    this.catOrder = [];
  }
}
