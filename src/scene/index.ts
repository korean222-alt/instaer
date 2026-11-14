import * as THREE from 'three';
import type { CatLook, House, RegionId, YardItem } from '../shared/types';
import { CatFlock } from './cat/CatFlock';
import { createProceduralCatModel } from './cat/catModel';
import { Atmosphere } from './core/atmosphere';
import { CameraRig } from './core/cameraRig';
import { regionIndex } from './core/labelLayer';
import { HighlightMark } from './house/highlightMark';
import { HouseLayer } from './house/HouseLayer';
import { houseNoAt, houseSlot, LOCAL_SLOTS, lotGate, neighborhoodArea, neighborhoodAt, zoneAt, zoneCenter } from './layout';
import { ZONE_CAPACITY } from '../shared/config';
import { WalkControls } from './walk/controls';
import { WALK_DIST, WALK_FOV, WalkCamera } from './walk/walkCamera';
import { Walker } from './walk/Walker';
import { hash01 } from './util/rand';
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
  /**
   * 걷기 모드. on=true 이면 startHouseNo(내 집) 앞에서 그 집 고양이로 걷기 시작한다.
   * 집 번호가 없으면 지금 보고 있는 곳에서 가장 가까운 동네 가운데에서 시작한다.
   * on=false 이면 동네 시점으로 부드럽게 돌아간다.
   */
  setWalkMode(on: boolean, startHouseNo?: number): void;
  /** 걷다가 어떤 집 마당 입구에 가까이 가면 그 집 번호를, 멀어지면 null 을 알린다 */
  onNearHouse(cb: (houseNo: number | null) => void): void;
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
  /** 자동 품질 단계 (0=최고). 프레임이 떨어지면 올라간다 */
  quality: number;
  /** 지금 화면에 걸려서 그리는 구역 수 */
  zones: number;
  /** 지금 그리는 해상도 비율 */
  pixelRatio: number;
  /** 걷기 모드일 때 내 고양이 위치 */
  walker: { x: number; z: number; y: number; anim: string } | null;
}
const statsOf = new WeakMap<IslandScene, () => SceneStats>();
export const getSceneStats = (scene: IslandScene): SceneStats | null => statsOf.get(scene)?.() ?? null;
const riggedOf = new WeakMap<IslandScene, CameraRig>();
const qualityOf = new WeakMap<IslandScene, (level: number | 'auto') => void>();
/** 확인용: 자동 품질을 끄고 단계를 고정한다 ('auto' 면 다시 자동) */
export const debugSetQuality = (scene: IslandScene, level: number | 'auto') => qualityOf.get(scene)?.(level);
const walkOf = new WeakMap<IslandScene, (x: number, z: number, yaw?: number) => void>();
/** 확인용: 걷기 모드에서 내 고양이를 원하는 곳으로 옮긴다 */
export const debugPlaceWalker = (scene: IslandScene, x: number, z: number, yaw?: number) => walkOf.get(scene)?.(x, z, yaw);
/** 확인용: 카메라를 원하는 거리로 바로 옮긴다 */
export const debugSetCamera = (scene: IslandScene, x: number, z: number, dist: number) => riggedOf.get(scene)?.jumpTo(x, z, dist);

/** 전체 시점: 구역(동네 10개)이 한눈에 들어오는 거리 */
const MAX_DIST = 900;
/** 동네 시점 (기본) */
const NEIGHBORHOOD_DIST = 78;
const MIN_DIST = 10;
const VIEW_FOV = 30;
/** 집 번호 없이 걷기를 시작할 때 쓰는 고양이 */
const DEFAULT_CAT: CatLook = { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' };
const PLAYER_SCALE = 1.12;
/** 마당 입구에서 이 거리 안에 들어오면 "가까이 왔다", 이보다 멀어지면 "멀어졌다" */
const NEAR_IN = 3.3;
const NEAR_OUT = 4.4;
/** 자동 품질 단계별 해상도 비율 (기기 비율, 최대 2 에 곱한다) */
const QUALITY_SCALE = [1, 0.82, 0.68, 0.56, 0.48];

export function createIslandScene(canvas: HTMLCanvasElement): IslandScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 2, 4000);
  const atmosphere = new Atmosphere(scene, 2048);
  scene.background = atmosphere.horizon;

  const world = new World(atmosphere);
  const catModel = createProceduralCatModel(atmosphere.shared);
  const houses = new HouseLayer(atmosphere.shared, catModel);
  const mark = new HighlightMark();
  // 내가 조작하는 고양이 (걷기 모드에서만 보인다)
  const player = new CatFlock(catModel, 1, 'high');
  player.mesh.visible = false;
  scene.add(world.group, houses.group, mark.group, player.mesh);

  const rig = new CameraRig(camera, canvas, {
    groundY: GROUND_Y,
    minDist: MIN_DIST,
    maxDist: MAX_DIST,
    bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 60 },
  });

  const controls = new WalkControls(canvas);
  const walker = new Walker();
  const walkCam = new WalkCamera();
  walker.hasHouse = walkCam.hasHouse = (houseNo) => houses.has(houseNo);
  walker.blockers = (x, z, out) => houses.blockersNear(x, z, out);
  let walking = false;
  let nearCb: ((houseNo: number | null) => void) | null = null;
  let nearHouse: number | null = null;
  const walkFocus = { x: 0, z: 0 };
  const target = { x: 0, z: 0, dist: 60 };
  // 시점 전환(동네 시점 ↔ 걷기)을 부드럽게 섞는다
  let blend = 1;
  const blendPos = new THREE.Vector3();
  const blendQuat = new THREE.Quaternion();
  let blendFov = VIEW_FOV;
  const toPos = new THREE.Vector3();
  const toQuat = new THREE.Quaternion();

  // 자동 품질: 프레임이 떨어지면 해상도 → 그림자 → 자세히 그리는 집 수 순서로 낮춘다
  let quality = 0;
  let qualityAuto = true;
  let fpsFrames = 0;
  let fpsTime = 0;
  let goodWindows = 0;
  let lastDrop = 0;
  let contextLost = false;

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
    walker.bridges = world.bridges;
    const b = world.viewBounds;
    rig.setLimits({ bounds: { minX: b.minX + 6, maxX: b.maxX - 6, minZ: b.minZ + 4, maxZ: b.maxZ + 6 } });
  };

  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight;
    if (!w || !h) return;
    viewportW = w;
    viewportH = h;
    // 해상도는 기기 비율 최대 2 까지만, 품질 단계가 내려가면 더 낮춘다
    renderer.setPixelRatio(Math.max(0.6, Math.min(window.devicePixelRatio || 1, 2) * QUALITY_SCALE[quality]));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    world.resize(h * renderer.getPixelRatio(), camera.fov);
    controls.layout();
  };

  const applyQuality = (level: number) => {
    level = Math.max(0, Math.min(QUALITY_SCALE.length - 1, level));
    if (level === quality) return;
    quality = level;
    atmosphere.sun.castShadow = level < 3;
    houses.setNearLimit(level >= 4 ? 16 : level >= 2 ? 24 : 64);
    resize();
  };

  syncWorld();
  resize();
  // 처음 화면: 첫 동네(1~10번지)를 동네 시점으로
  const n0 = neighborhoodArea(0);
  rig.jumpTo(n0.x, n0.z - 1, camera.aspect < 0.8 ? NEIGHBORHOOD_DIST : 60);

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);

  const onTap = (cx: number, cy: number) => {
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
  };
  rig.onTap(onTap);
  controls.onTap(onTap);

  /** 걷는 중: 가장 가까운 마당 입구를 찾아서 가까워지거나 멀어지면 알린다 */
  const checkNearHouse = () => {
    let best: number | null = null;
    let bestD = NEAR_IN;
    const zone = zoneAt(walker.x, walker.z);
    if (zone >= 0) {
      const c = zoneCenter(zone);
      const lx = walker.x - c.x;
      const lz = walker.z - c.z;
      for (let i = 0; i < LOCAL_SLOTS.length; i++) {
        const lot = LOCAL_SLOTS[i];
        if (Math.abs(lot.x - lx) > 9 || Math.abs(lot.z - lz) > 9) continue;
        const houseNo = zone * ZONE_CAPACITY + i + 1;
        if (!houses.has(houseNo)) continue;
        // 마당 입구(대문 자리)까지의 거리. 지금 가까운 집은 조금 더 멀어져야 놓는다
        const d = Math.hypot(lot.x + 3 * Math.sin(lot.rot) - lx, lot.z + 3 * Math.cos(lot.rot) - lz);
        const limit = houseNo === nearHouse ? NEAR_OUT : NEAR_IN;
        if (d < limit && d - (houseNo === nearHouse ? NEAR_OUT - NEAR_IN : 0) < bestD) {
          bestD = d - (houseNo === nearHouse ? NEAR_OUT - NEAR_IN : 0);
          best = houseNo;
        }
      }
    }
    if (best !== nearHouse) {
      nearHouse = best;
      nearCb?.(best);
    }
  };

  const startBlend = () => {
    blend = 0;
    blendPos.copy(camera.position);
    blendQuat.copy(camera.quaternion);
    blendFov = camera.fov;
  };

  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  let shadowX = Infinity;
  let shadowZ = Infinity;
  let shadowR = 0;
  let cpuMs = 0;
  let last = performance.now();

  const frame = (now: number) => {
    if (disposed || contextLost) return;
    raf = requestAnimationFrame(frame);
    // 첫 프레임은 시간이 거꾸로 잡힐 수 있어서 0 아래로 내려가지 않게 한다
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.05, rawDt);
    last = now;
    const t0 = performance.now();

    // 자동 품질: 1.5초씩 평균 fps 를 보고 단계를 정한다 (탭이 가려졌다 돌아온 직후는 빼고)
    if (rawDt > 0 && rawDt < 0.5) {
      fpsFrames++;
      fpsTime += rawDt;
      if (fpsTime >= 1.5) {
        const fps = fpsFrames / fpsTime;
        fpsFrames = 0;
        fpsTime = 0;
        if (qualityAuto) {
          if (fps < 27) {
            goodWindows = 0;
            lastDrop = now;
            applyQuality(quality + 1);
          } else if (fps > 54 && quality > 0 && now - lastDrop > 20000) {
            // 여유가 충분히 오래 이어질 때만 다시 올린다 (오르내리기를 되풀이하지 않게)
            if (++goodWindows >= 4) {
              goodWindows = 0;
              lastDrop = now - 8000;
              applyQuality(quality - 1);
            }
          } else goodWindows = 0;
        }
      }
    } else {
      fpsFrames = 0;
      fpsTime = 0;
    }

    atmosphere.update(dt);
    if (walking) {
      controls.update();
      walker.update(dt, controls.moveX, controls.moveY, walkCam.yaw, controls.takeJump());
      walkCam.update(dt, camera, walker.x, walker.groundY, walker.air, walker.z, controls.takeLook());
      player.setPose(0, walker.x, walker.y + 0.035, walker.z, walker.yaw, PLAYER_SCALE);
      player.setAnim(0, walker.phase, walker.walk, 0, 0);
      player.setMood(0, walker.sit, walker.yawn);
      walkFocus.x = walker.x;
      walkFocus.z = walker.z;
      target.x = walkCam.focus.x;
      target.z = walkCam.focus.z;
      target.dist = WALK_DIST;
      checkNearHouse();
    } else {
      rig.update(dt);
      const t = rig.target;
      target.x = t.x;
      target.z = t.z;
      target.dist = t.dist;
    }
    // 시점이 바뀌는 동안에는 이전 카메라 자리에서 새 자리로 부드럽게 옮긴다
    const fovGoal = walking ? WALK_FOV : VIEW_FOV;
    if (blend < 1) {
      blend = Math.min(1, blend + dt / 0.9);
      const e = blend * blend * (3 - 2 * blend);
      toPos.copy(camera.position);
      toQuat.copy(camera.quaternion);
      camera.position.lerpVectors(blendPos, toPos, e);
      camera.quaternion.slerpQuaternions(blendQuat, toQuat, e);
      camera.fov = blendFov + (fovGoal - blendFov) * e;
      camera.near = Math.min(camera.near, 1);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    } else if (camera.fov !== fovGoal) {
      camera.fov = fovGoal;
      camera.updateProjectionMatrix();
    }

    // 지역 강조 전환
    if (regionGoal !== regionNow && regionAmount > 0) regionAmount = Math.max(0, regionAmount - dt / 0.16);
    else if (regionGoal !== regionNow) regionNow = regionGoal;
    else if (regionNow >= 0) regionAmount = Math.min(1, regionAmount + dt / 0.35);
    else regionAmount = Math.max(0, regionAmount - dt / 0.25);
    regionAmount = Math.min(1, Math.max(0, regionAmount));
    atmosphere.shared.uRegion.value.set(regionNow, regionAmount * regionAmount * (3 - 2 * regionAmount));

    // 그림자는 보이는 범위만. 살짝 움직일 때마다 다시 잡지 않도록 격자에 맞춘다
    // 걷기 모드에서는 카메라가 보는 쪽(고양이 앞쪽)을 넓게 잡는다
    const radius = walking ? 34 : THREE.MathUtils.clamp(target.dist * 0.5, 18, 260);
    const snap = radius / 24;
    const ahead = walking ? 15 : 0;
    const sx = Math.round((target.x - Math.sin(walkCam.yaw) * ahead) / snap) * snap;
    const sz = Math.round((target.z - (walking ? Math.cos(walkCam.yaw) * ahead : radius * 0.15)) / snap) * snap;
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

  // WebGL 컨텍스트가 끊기면(메모리가 모자란 WebView 에서 생긴다) 멈췄다가, 돌아오면 다시 그린다.
  // three.js 가 돌아온 컨텍스트에 텍스처와 모양을 다시 올린다.
  const onLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    cancelAnimationFrame(raf);
  };
  const onRestored = () => {
    if (disposed) return;
    contextLost = false;
    shadowX = Infinity;
    last = performance.now();
    resize();
    raf = requestAnimationFrame(frame);
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const api: IslandScene = {
    setHouses(list) {
      houses.setHouses(list);
      syncWorld();
      nearHouse = null;
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
    setWalkMode(on, startHouseNo) {
      if (on) {
        const start = startHouseNo !== undefined && houses.has(startHouseNo) ? startHouseNo : null;
        let look = DEFAULT_CAT;
        let seed = 0.37;
        if (start !== null) {
          // 내 집 대문 앞에서, 집을 등지고 선다
          const s = houseSlot(start);
          const lot = { x: s.x, z: s.z, rot: s.rot, nb: 0 };
          const g = lotGate(lot, 1.3);
          walker.place(g.x, g.z, s.rot);
          look = houses.house(start)?.cat ?? DEFAULT_CAT;
          seed = hash01(start, 99);
        } else {
          // 지금 보고 있는 곳에서 가장 가까운 동네 가운데(광장/연못/큰 나무 앞)
          const t = walking ? walker : rig.target;
          let nb = neighborhoodAt(t.x, t.z);
          if (nb < 0) nb = 0;
          const n = neighborhoodArea(nb);
          walker.place(n.x, n.z + 7.4, 0);
        }
        player.setLook(0, look, seed);
        player.count = 1;
        player.mesh.visible = true;
        houses.setAwayCat(start);
        houses.setWalkFocus(walkFocus);
        walkFocus.x = walker.x;
        walkFocus.z = walker.z;
        if (!walking) startBlend();
        walkCam.snap(walker.x, walker.groundY, walker.z, 0);
        walking = true;
        rig.enabled = false;
        controls.setActive(true);
      } else if (walking) {
        walking = false;
        controls.setActive(false);
        player.mesh.visible = false;
        houses.setAwayCat(null);
        houses.setWalkFocus(null);
        startBlend();
        rig.enabled = true;
        rig.jumpTo(walker.x, walker.z - 1, camera.aspect < 0.8 ? NEIGHBORHOOD_DIST : 60);
        if (nearHouse !== null) {
          nearHouse = null;
          nearCb?.(null);
        }
      }
    },
    onNearHouse(cb) {
      nearCb = cb;
    },
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      controls.dispose();
      player.dispose();
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
    cameraDist: target.dist,
    quality,
    pixelRatio: renderer.getPixelRatio(),
    zones: world.visibleZones,
    walker: walking ? { x: walker.x, z: walker.z, y: walker.y, anim: walker.anim } : null,
  }));
  qualityOf.set(api, (level) => {
    qualityAuto = level === 'auto';
    if (level !== 'auto') applyQuality(level);
  });
  walkOf.set(api, (x, z, yaw = 0) => {
    if (walking) walker.place(x, z, yaw);
  });
  riggedOf.set(api, rig);
  return api;
}
