import * as THREE from 'three';
import type { House, RegionId, YardItem } from '../shared/types';
import { createProceduralCatModel } from './cat/catModel';
import { Atmosphere } from './core/atmosphere';
import { CameraRig } from './core/cameraRig';
import { regionIndex } from './core/labelLayer';
import { HighlightMark } from './house/highlightMark';
import { HouseLayer } from './house/HouseLayer';
import { houseNoAt, houseSlot, neighborhoodArea } from './layout';
import { GROUND_Y } from './world/constants';
import { World } from './world/World';

export { houseSlot, neighborhoodArea, neighborhoodAt, NEIGHBORHOOD_SIZE } from './layout';

/**
 * 고양이섬 3D 씬.
 * 씬은 DB나 서버를 직접 부르지 않는다. 데이터는 항상 아래 함수로 받는다.
 */
export interface IslandScene {
  /** 섬에 있는 집 전체 (빈 집 포함). 바뀔 때마다 전체 목록을 다시 넘긴다 */
  setHouses(houses: House[]): void;
  /** 집 한 채의 꾸미기 아이템 */
  setYardItems(houseNo: number, items: YardItem[]): void;
  /** 열린 구역 수 (1부터). 나머지는 구름에 가려진다 */
  setUnlockedZones(count: number): void;
  setTimeOfDay(mode: 'day' | 'night'): void;
  /** 그 집이 있는 동네로 부드럽게 이동 (동네 시점) */
  focusHouse(houseNo: number): void;
  /** 오늘의 특이한 집: 금색 테두리. null 이면 해제 */
  highlightHouse(houseNo: number | null): void;
  /** 그 지역의 집은 밝게, 나머지는 살짝 흐리게 (깃발은 계속 보임). null 이면 해제 */
  highlightRegion(regionId: RegionId | null): void;
  /** 집(또는 그 집 고양이)을 탭했을 때 */
  onHouseTap(cb: (houseNo: number) => void): void;
  /** 캔버스 크기가 바뀌면 부른다 */
  resize(): void;
  dispose(): void;
}

/** 확인용 수치 (그리기 횟수, 삼각형 수 등). 앱에서는 쓰지 않는다 */
export interface SceneStats {
  calls: number;
  triangles: number;
  /** 한 프레임을 준비하는 데 걸린 시간(ms, 그리기 명령 포함. GPU 시간은 빠져 있다) */
  cpuMs: number;
  cameraDist: number;
}
const statsOf = new WeakMap<IslandScene, () => SceneStats>();
export const getSceneStats = (scene: IslandScene): SceneStats | null => statsOf.get(scene)?.() ?? null;
const riggedOf = new WeakMap<IslandScene, CameraRig>();
/** 확인용: 카메라를 원하는 거리로 바로 옮긴다 */
export const debugSetCamera = (scene: IslandScene, x: number, z: number, dist: number) => riggedOf.get(scene)?.jumpTo(x, z, dist);

/** 전체 시점: 구역(동네 10개)이 한눈에 들어오는 거리 */
const MAX_DIST = 900;
/** 동네 시점 (기본) */
const NEIGHBORHOOD_DIST = 78;
const MIN_DIST = 10;

export function createIslandScene(canvas: HTMLCanvasElement): IslandScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 2, 4000);
  const atmosphere = new Atmosphere(scene, 2048);
  scene.background = atmosphere.horizon;

  const world = new World(atmosphere);
  const houses = new HouseLayer(atmosphere.shared, createProceduralCatModel(atmosphere.shared));
  const mark = new HighlightMark();
  scene.add(world.group, houses.group, mark.group);

  const rig = new CameraRig(camera, canvas, {
    groundY: GROUND_Y,
    minDist: MIN_DIST,
    maxDist: MAX_DIST,
    bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 60 },
  });

  let requestedZones = 1;
  let viewportW = 1;
  let viewportH = 1;
  let tapCb: ((houseNo: number) => void) | null = null;
  let disposed = false;
  let raf = 0;

  // 지역 강조: 공용 값 하나만 부드럽게 바꾼다 (집마다 건드리지 않는다)
  let regionGoal = -1;
  let regionNow = -1;
  let regionAmount = 0;

  const syncWorld = () => {
    // 집이 있는 구역은 항상 열려 있어야 한다
    const unlocked = Math.max(requestedZones, houses.zoneCount(), 1);
    world.rebuild(unlocked, 1);
    const b = world.viewBounds;
    rig.setLimits({ bounds: { minX: b.minX + 6, maxX: b.maxX - 6, minZ: b.minZ + 4, maxZ: b.maxZ + 6 } });
  };

  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight;
    if (!w || !h) return;
    viewportW = w;
    viewportH = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    world.resize(h * renderer.getPixelRatio(), camera.fov);
  };

  syncWorld();
  resize();
  // 처음 화면: 첫 동네(1~10번지)를 동네 시점으로
  const n0 = neighborhoodArea(0);
  rig.jumpTo(n0.x, n0.z - 1, camera.aspect < 0.8 ? NEIGHBORHOOD_DIST : 60);

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);

  rig.onTap((cx, cy) => {
    const ray = rig.rayFrom(cx, cy);
    let houseNo = houses.petCat(ray) ?? houses.pickBuilding(ray);
    if (houseNo === null) {
      const g = rig.groundPoint(cx, cy);
      if (g) {
        // 지붕을 누르면 광선이 집 뒤쪽 땅에 닿으므로 앞쪽으로 조금씩 당겨 가며 찾는다
        for (const dz of [0, 1.6, 3.1, 4.4]) {
          const n = houseNoAt(g.x, g.z + dz);
          if (n !== null && houses.has(n)) {
            houseNo = n;
            break;
          }
        }
      }
    }
    if (houseNo !== null) tapCb?.(houseNo);
  });

  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  let shadowX = Infinity;
  let shadowZ = Infinity;
  let shadowR = 0;
  let cpuMs = 0;
  let last = performance.now();

  const frame = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    // 첫 프레임은 시간이 거꾸로 잡힐 수 있어서 0 아래로 내려가지 않게 한다
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const t0 = performance.now();

    atmosphere.update(dt);
    rig.update(dt);
    const target = rig.target;

    // 지역 강조 전환
    if (regionGoal !== regionNow && regionAmount > 0) regionAmount = Math.max(0, regionAmount - dt / 0.16);
    else if (regionGoal !== regionNow) regionNow = regionGoal;
    else if (regionNow >= 0) regionAmount = Math.min(1, regionAmount + dt / 0.35);
    else regionAmount = Math.max(0, regionAmount - dt / 0.25);
    regionAmount = Math.min(1, Math.max(0, regionAmount));
    atmosphere.shared.uRegion.value.set(regionNow, regionAmount * regionAmount * (3 - 2 * regionAmount));

    // 그림자는 보이는 범위만. 살짝 움직일 때마다 다시 잡지 않도록 격자에 맞춘다
    const radius = THREE.MathUtils.clamp(target.dist * 0.5, 18, 260);
    const snap = radius / 24;
    const sx = Math.round(target.x / snap) * snap;
    const sz = Math.round((target.z - radius * 0.15) / snap) * snap;
    if (sx !== shadowX || sz !== shadowZ || Math.abs(radius - shadowR) > shadowR * 0.08) {
      shadowX = sx;
      shadowZ = sz;
      shadowR = radius;
      atmosphere.setShadowArea(sx, sz, radius);
    }

    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    world.update(target.x, target.z, target.dist, frustum);
    houses.update(dt, camera, target, { w: viewportW, h: viewportH }, frustum);
    mark.update(atmosphere.shared.uTime.value, target.dist);

    renderer.render(scene, camera);
    cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  };
  raf = requestAnimationFrame(frame);

  const api: IslandScene = {
    setHouses(list) {
      houses.setHouses(list);
      syncWorld();
    },
    setYardItems(houseNo, items) {
      houses.setYardItems(houseNo, items);
    },
    setUnlockedZones(count) {
      requestedZones = Math.max(1, Math.floor(count));
      syncWorld();
    },
    setTimeOfDay(mode) {
      atmosphere.setMode(mode);
    },
    focusHouse(houseNo) {
      // 집과 동네 가운데 사이를 보면서 동네 시점으로 간다
      const s = houseSlot(houseNo);
      const n = neighborhoodArea(s.neighborhood);
      rig.flyTo(s.x * 0.7 + n.x * 0.3, s.z * 0.7 + n.z * 0.3, camera.aspect < 0.8 ? NEIGHBORHOOD_DIST * 0.82 : 54);
    },
    highlightHouse(houseNo) {
      mark.set(houseNo === null ? null : houseSlot(houseNo));
    },
    highlightRegion(regionId) {
      regionGoal = regionId === null ? -1 : regionIndex(regionId);
      if (regionGoal < 0) regionGoal = -1;
    },
    onHouseTap(cb) {
      tapCb = cb;
    },
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      rig.dispose();
      world.dispose();
      houses.dispose();
      mark.dispose();
      renderer.dispose();
    },
  };
  statsOf.set(api, () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    cpuMs,
    cameraDist: rig.target.dist,
  }));
  riggedOf.set(api, rig);
  return api;
}
