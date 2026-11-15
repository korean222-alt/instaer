import * as THREE from 'three';
import type { CatLook, House, RegionId, YardItem } from '../shared/types';
import { CatFlock } from './cat/CatFlock';
import { createProceduralCatModel } from './cat/catModel';
import { CatPreview, type CatPreviewOptions } from './cat/catPreview';
import { Atmosphere } from './core/atmosphere';
import { CameraRig } from './core/cameraRig';
import { regionIndex } from './core/labelLayer';
import { HighlightMark } from './house/highlightMark';
import { HouseLayer } from './house/HouseLayer';
import { ItemGeometries } from './free/catalog';
import { DrawingStore } from './free/drawings';
import { FishingRig, type FishingState } from './fishing/FishingRig';
import { Placer } from './free/Placer';
import { blockersOf, pickItem, type Space } from './free/space';
import type { Drawing, InteriorItem, PlacedItem } from './free/types';
import { Interior, ROOM_CAM_YAW, ROOM_EXIT_Z, ROOM_START, ROOM_WALK } from './interior/Interior';
import { Npcs, type SceneNpc } from './npc/Npcs';
import { RemotePlayers } from './remote/RemotePlayers';
import type { LocalState, RemotePlayer } from './remote/types';
import {
  collidersNear,
  fishingSpotAt,
  houseNoAt,
  houseSlot,
  landAt,
  LOCAL_SLOTS,
  lotGate,
  neighborhoodArea,
  neighborhoodAt,
  zoneAt,
  zoneCenter,
  type Collider,
} from './layout';
import { ZONE_CAPACITY } from '../shared/config';
import { WalkControls } from './walk/controls';
import { WALK_DIST, WALK_FOV, WalkCamera } from './walk/walkCamera';
import { Walker } from './walk/Walker';
import { hash01 } from './util/rand';
import { GROUND_Y } from './world/constants';
import { World } from './world/World';

export { houseSlot, neighborhoodArea, neighborhoodAt, NEIGHBORHOOD_SIZE } from './layout';
export type { LocalState, PlayerAnim, RemotePlayer } from './remote/types';
export type { Drawing, InteriorItem, PlacedItem } from './free/types';
export { FREE_ITEM_LIST } from './free/catalog';
export { DEFAULT_PALETTE, DRAWING_SIZE, decodeDrawing, encodeDrawing } from './free/drawings';
export { ROOM_SIZE } from './free/space';
export { ROOM_STYLES } from './interior/Interior';
export { dockArea, fishingSpotAt, POND_FISH_REACH, POND_R } from './layout';
export type { FishingSpot } from './layout';
export type { FishingState } from './fishing/FishingRig';
export type { SceneNpc } from './npc/Npcs';
export type { CatPreviewOptions } from './cat/catPreview';

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
  /**
   * 내 주변에 보여줄 다른 유저 목록 전체. 위치가 올 때마다(1초에 8~10번쯤) 통째로 다시 넘긴다.
   * 새로 생긴 유저는 부드럽게 나타나고, 목록에서 빠진 유저는 부드럽게 사라진다. 빈 목록도 된다.
   */
  setRemotePlayers(players: RemotePlayer[]): void;
  /** 걷는 동안 내 고양이의 위치/방향/동작이 바뀌면 알린다 (많아야 1초에 20번쯤) */
  onLocalMove(cb: (state: LocalState) => void): void;
  /** 내 고양이의 지금 상태 */
  getLocalState(): LocalState;

  // ── 작업 4: 집 안, 자유 배치, 직접 그린 그림 ──

  /**
   * 집 안으로 들어간다 (방 하나, 8x8). 들어가 있는 동안에는 섬 대신 그 집 안만 그린다.
   * 걷기 모드가 아니면 기본 고양이로 걷기를 켠 뒤 들어간다(내 고양이로 들어가려면 먼저 setWalkMode(true, 내 집 번호)).
   * 이미 그 집 안이면 아이템과 벽지/바닥만 바꾼다.
   * @param wallpaper 'cream' | 'stripe' | 'dots' | '#rrggbb' | 'drawing:그림id'
   * @param floor     'wood' | 'tile' | 'carpet' | '#rrggbb' | 'drawing:그림id'
   */
  enterHouse(houseNo: number, interior: InteriorItem[], wallpaper?: string, floor?: string): void;
  /** 집 밖(그 집 문 앞)으로 나온다. 이때는 onExitHouse 를 부르지 않는다 */
  exitHouse(): void;
  /** 지금 들어가 있는 집의 아이템만 바꾼다 (집 안이 아니면 아무 일도 없다) */
  setInteriorItems(items: InteriorItem[]): void;
  /** 걷다가 어떤 집 문 앞에 서면 그 집 번호를, 떠나면 null 을 알린다 ("들어가기" 버튼용) */
  onDoor(cb: (houseNo: number | null) => void): void;
  /** 집 안에서 문(앞쪽 발판)을 지나 걸어 나가면 알린다. 씬이 알아서 문 앞으로 내보낸 뒤에 부른다 */
  onExitHouse(cb: (houseNo: number) => void): void;
  /** 집 한 채 마당의 자유 배치 아이템 (기존 setYardItems 의 칸 방식 아이템과 같이 그린다) */
  setYardItemsFree(houseNo: number, items: PlacedItem[]): void;
  /**
   * 꾸미기 모드를 켠다. 켜 있는 동안 아이템을 손가락으로 끌어서 옮길 수 있다.
   * - 아이템 종류 이름(예: 'bed')을 주면 새 아이템을 빈 자리에 꺼내 놓는다 (바로 onPlace 로 알린다)
   * - 놓여 있는 아이템의 id 를 주면 그 아이템을 고른다 (rotatePlacing 으로 돌릴 수 있다)
   * - 아무것도 안 주면 꾸미기 모드만 켠다
   * 집 안이면 그 방을, 밖이면 houseNo 번지의 마당을 꾸민다(안 주면 가장 가까운 집).
   */
  startPlacing(typeOrItemId?: string | null, houseNo?: number): void;
  stopPlacing(): void;
  /** 지금 고른 아이템을 돌린다 (라디안, 기본 45도) */
  rotatePlacing(step?: number): void;
  /** 아이템이 놓일 때마다 (새로 놓았든 옮겼든 돌렸든) 그 아이템의 새 값을 알린다. 같은 id 면 덮어쓰면 된다 */
  onPlace(cb: (item: PlacedItem) => void): void;
  /** 아이템을 끌지 않고 짧게 눌렀을 때 (꾸미기 모드에서는 마당/집 안, 꾸미기 모드가 아니면 집 안에서만) */
  onPick(cb: (itemId: string) => void): void;
  /** 직접 그린 그림 전체 (가까운 집 것만 넘긴다). drawingId 가 같은 아이템에 붙는다. 목록에서 빠진 그림은 지운다 */
  setDrawings(drawings: Drawing[]): void;

  // ── 작업 5: 지붕 그림, 주민, 낚시, 위치 되돌리기, 고양이 그림 ──

  /**
   * 지금 보여 줄 지붕 그림 전체 (가까운 집 것만). 목록에서 빠진 집은 그림을 뗀다.
   * 그림 내용은 setDrawings 로 넘긴 것을 쓴다. 그림이 아직 안 왔으면 지붕 색만 보인다.
   */
  setRoofArt(items: Array<{ houseNo: number; drawingId: string }>): void;
  /**
   * 지금 보여 줄 주민(NPC) 고양이 전체. 이름표는 '@' 없이 연두색이고, role 에 따라 작은 표시가 붙는다.
   * 주민은 준 자리에 앉아 있다가 가끔 둘레를 조금 걷는다. 집 안에 있을 때는 방 좌표로 넘긴다.
   * 집 안팎을 오갈 때 씬이 주민을 모두 지우므로(다른 유저와 같다) 그때 다시 넘긴다.
   */
  setNpcs(npcs: SceneNpc[]): void;
  /** 주민을 눌렀을 때 그 주민의 id 를 알린다 */
  onNpcTap(cb: (id: string) => void): void;
  /**
   * 내 고양이가 낚시하는 모습. 걷기 모드에서 집 밖일 때만 된다.
   * 처음 켤 때 서 있는 곳이 낚시터(fishingSpotAt)면 그 물 쪽을, 아니면 바라보던 쪽을 보고 앉아 낚싯대를 든다.
   * 켜 있는 동안에는 조이스틱과 점프가 듣지 않는다. null 이면 원래대로.
   */
  setFishing(state: FishingState | null): void;
  /**
   * 내 고양이를 (x, z) 로 바로 옮긴다 (서버가 위치를 되돌릴 때). 막힌 곳이면 가장 가까운 빈 곳에 선다.
   * 집 안이면 방 좌표다. 옮긴 뒤 onLocalMove 로 새 위치를 한 번 알린다.
   */
  setLocalPosition(x: number, z: number, rotY?: number): void;
  /**
   * 고양이 한 마리를 그림으로 찍는다 (입양 카드용). 배경이 투명한 PNG 의 data URL 을 돌려준다.
   * size 는 한 변의 픽셀 수(32~512, 기본 256). WebGL 이 끊긴 동안에는 빈 글자를 돌려준다.
   */
  renderCatPreview(cat: CatLook, size?: number, options?: CatPreviewOptions): string;

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
  /** 지금 그리는 다른 유저 수 (전체 / 그중 자세한 모양 / 이름표) */
  remotes: { shown: number; near: number; tags: number };
  /** 들어가 있는 집 번호 (밖이면 null) */
  inside: number | null;
  /** 지금 그리는 자유 배치 아이템 수 / 그중 그림이 붙은 것 */
  free: { shown: number; art: number };
  /** 꾸미기 모드 상태 */
  placing: { active: boolean; held: PlacedItem | null; valid: boolean; placed: boolean };
  /** 지금 그리는 지붕 그림 수 */
  roofArt: number;
  /** 지금 그리는 주민 수 / 이름표 수 */
  npcs: { shown: number; tags: number };
  /** 낚시 상태 (아니면 null) */
  fishing: FishingState | null;
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
const projectOf = new WeakMap<IslandScene, (x: number, y: number, z: number) => { x: number; y: number }>();
/** 확인용: 화면 좌표(지금 그리는 장면 기준)의 점이 화면 어디에 보이는지 (clientX, clientY) */
export const debugProject = (scene: IslandScene, x: number, y: number, z: number) => projectOf.get(scene)?.(x, y, z) ?? null;
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
/** 문 앞 (마당 가운데 기준 z). 여기서 DOOR_IN 안에 들어오면 "문 앞에 섰다" */
const DOOR_Z = 0.3;
const DOOR_IN = 1.0;
const DOOR_OUT = 1.5;
/** 집에서 나왔을 때 서는 자리 */
const DOOR_STAND_Z = 0.62;
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
  const geometries = new ItemGeometries();
  const drawings = new DrawingStore();
  const houses = new HouseLayer(atmosphere.shared, catModel, geometries, drawings);
  const mark = new HighlightMark();
  // 내가 조작하는 고양이 (걷기 모드에서만 보인다)
  const player = new CatFlock(catModel, 1, 'high');
  player.mesh.visible = false;
  // 다른 유저의 고양이
  const remotes = new RemotePlayers(catModel);
  // 주민(NPC) 고양이, 낚시 소품, 고양이 그림 찍기
  const npcs = new Npcs(catModel, atmosphere.shared);
  const fishRig = new FishingRig(atmosphere.shared);
  let fishing: FishingState | null = null;
  let fishYaw = 0;
  let npcTapCb: ((id: string) => void) | null = null;
  let preview: CatPreview | null = null;
  // 꾸미기(끌어 놓기)와 집 안. 집 안은 처음 들어갈 때 만든다
  const placer = new Placer(canvas, camera, geometries, drawings, atmosphere.shared);
  let interior: Interior | null = null;
  let inside: number | null = null;
  let doorCb: ((houseNo: number | null) => void) | null = null;
  let exitCb: ((houseNo: number) => void) | null = null;
  let doorHouse: number | null = null;
  const roomBlockers: Array<{ x: number; z: number; r: number }> = [];
  scene.add(world.group, houses.group, mark.group, player.mesh, remotes.group, npcs.group, fishRig.group, placer.group);
  placer.onChange = () => {
    if (inside !== null) interior?.redraw(placer.heldId);
    else houses.redrawFree(placer.heldId);
  };

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
  walker.blockers = (x, z, out) => {
    if (inside !== null && interior) blockersOf(interior.space, interior.list, roomBlockers, 0, out);
    else houses.blockersNear(x, z, out);
  };
  // 주민이 설 수 있는 자리: 밖이면 땅 위이고 집/나무/가구에 안 걸리는 곳, 집 안이면 방 안이고 가구에 안 걸리는 곳
  const npcNear: Collider[] = [];
  const npcBlock: Array<{ x: number; z: number; r: number }> = [];
  npcs.canStand = (x, z) => {
    const pad = 0.42;
    npcBlock.length = 0;
    if (inside !== null && interior) {
      if (Math.abs(x) > ROOM_WALK.maxX - pad || z < ROOM_WALK.minZ + pad || z > ROOM_WALK.maxZ - pad) return false;
      blockersOf(interior.space, interior.list, roomBlockers, 0, npcBlock);
    } else {
      const zone = zoneAt(x, z);
      if (zone < 0 || landAt(x, z) < 2.2) return false;
      const c = zoneCenter(zone);
      const lx = x - c.x;
      const lz = z - c.z;
      for (const col of collidersNear(lx, lz, pad + 0.2, npcNear)) {
        if (col.lot >= 0 && !houses.has(zone * ZONE_CAPACITY + col.lot + 1)) continue;
        const dx = lx - col.x;
        const dz = lz - col.z;
        if (col.r > 0) {
          if (Math.hypot(dx, dz) < col.r + pad) return false;
        } else if (Math.abs(dx * col.cos - dz * col.sin) < col.hx + pad && Math.abs(dx * col.sin + dz * col.cos) < col.hz + pad) return false;
      }
      houses.blockersNear(x, z, npcBlock);
    }
    for (const b of npcBlock) if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return false;
    return true;
  };
  const npcView = { focusX: 0, focusZ: 0, walking: false, dist: 60, viewportW: 1, viewportH: 1 };
  const stopFishing = () => {
    if (fishing === null) return;
    fishing = null;
    fishRig.setState(null);
    walker.holdSit = false;
  };
  let walking = false;
  let nearCb: ((houseNo: number | null) => void) | null = null;
  let nearHouse: number | null = null;
  // onLocalMove: 마지막으로 알린 값. 달라졌을 때만, 너무 잦지 않게 알린다
  let moveCb: ((state: LocalState) => void) | null = null;
  const sent = { x: NaN, z: NaN, rotY: NaN, anim: '', at: 0 };
  const remoteView = { focusX: 0, focusZ: 0, walking: false, dist: 60, viewportW: 1, viewportH: 1, quality: 0 };
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
    remotes.bridges = world.bridges;
    npcs.bridges = world.bridges;
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
    interior?.setShadows(level < 3);
    resize();
  };

  syncWorld();
  resize();
  // 처음 화면: 첫 동네(1~10번지)를 동네 시점으로
  const n0 = neighborhoodArea(0);
  rig.jumpTo(n0.x, n0.z - 1, camera.aspect < 0.8 ? NEIGHBORHOOD_DIST : 60);
  // 걷기 전에 getLocalState 를 불러도 땅 위의 자리가 나오게 한다
  walker.place(n0.x, n0.z + 7.4, 0);

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);

  const onTap = (cx: number, cy: number) => {
    // 주민을 누르면 그것부터 알린다 (꾸미는 중에는 빼고)
    if (npcTapCb && !placer.active && npcs.shown > 0) {
      const id = npcs.pick(rig.rayFrom(cx, cy));
      if (id !== null) {
        npcTapCb(id);
        return;
      }
    }
    if (inside !== null) {
      // 집 안: 아이템을 누르면 알린다 (꾸미기 모드에서는 끌어 놓기 쪽이 먼저 받는다)
      const hit = interior && !placer.active ? pickItem(interior.space, interior.list, rig.rayFrom(cx, cy)) : null;
      if (hit) placer.onPick?.(hit.id);
      return;
    }
    if (placer.active) return;
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
    // 문 앞
    let door: number | null = null;
    let doorD = DOOR_OUT;
    if (zone >= 0) {
      const c = zoneCenter(zone);
      const lx = walker.x - c.x;
      const lz = walker.z - c.z;
      for (let i = 0; i < LOCAL_SLOTS.length; i++) {
        const lot = LOCAL_SLOTS[i];
        if (Math.abs(lot.x - lx) > 5 || Math.abs(lot.z - lz) > 5) continue;
        const houseNo = zone * ZONE_CAPACITY + i + 1;
        if (!houses.has(houseNo)) continue;
        const d = Math.hypot(lot.x + DOOR_Z * Math.sin(lot.rot) - lx, lot.z + DOOR_Z * Math.cos(lot.rot) - lz);
        if (d < (houseNo === doorHouse ? DOOR_OUT : DOOR_IN) && d < doorD) {
          doorD = d;
          door = houseNo;
        }
      }
    }
    if (door !== doorHouse) {
      doorHouse = door;
      doorCb?.(door);
    }
  };

  /** (x, z) 에서 가장 가까운 집 */
  const closestHouse = (x: number, z: number): number | null => {
    const zone = zoneAt(x, z);
    if (zone < 0) return null;
    const c = zoneCenter(zone);
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = 0; i < LOCAL_SLOTS.length; i++) {
      const houseNo = zone * ZONE_CAPACITY + i + 1;
      if (!houses.has(houseNo)) continue;
      const d = Math.hypot(LOCAL_SLOTS[i].x + c.x - x, LOCAL_SLOTS[i].z + c.z - z);
      if (d < bestD) {
        bestD = d;
        best = houseNo;
      }
    }
    return best;
  };

  /** 집 밖으로: 그 집 문 앞에 집을 등지고 선다 */
  const leaveHouse = (viaDoor: boolean) => {
    if (inside === null) return;
    const houseNo = inside;
    placer.end();
    inside = null;
    scene.add(player.mesh, remotes.group, npcs.group, placer.group);
    remotes.clear();
    remotes.flatY = null;
    npcs.clear();
    npcs.flatY = null;
    walker.room = null;
    const s = houseSlot(houseNo);
    walker.place(s.x + DOOR_STAND_Z * Math.sin(s.rot), s.z + DOOR_STAND_Z * Math.cos(s.rot), s.rot);
    walkCam.snap(walker.x, walker.groundY, walker.z, walkCam.yaw);
    walkFocus.x = walker.x;
    walkFocus.z = walker.z;
    shadowX = Infinity;
    sent.x = NaN;
    blend = 1;
    if (viaDoor) exitCb?.(houseNo);
  };

  const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
  const localState = (): LocalState => ({
    x: walker.x,
    z: walker.z,
    rotY: wrapAngle(walker.yaw),
    anim: walking ? walker.anim : 'idle',
  });
  const notifyMove = (now: number) => {
    if (!moveCb) return;
    const animChanged = walker.anim !== sent.anim;
    // 동작이 바뀌면 바로, 그 밖에는 50ms 에 한 번까지만
    if (!animChanged && now - sent.at < 50) return;
    const same =
      Math.abs(walker.x - sent.x) < 0.004 && Math.abs(walker.z - sent.z) < 0.004 && Math.abs(wrapAngle(walker.yaw - sent.rotY)) < 0.01;
    if (same && !animChanged) return;
    sent.x = walker.x;
    sent.z = walker.z;
    sent.rotY = walker.yaw;
    sent.anim = walker.anim;
    sent.at = now;
    moveCb(localState());
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
    if (inside !== null && interior) {
      // 집 안: 섬은 그리지 않고 방 하나만 그린다
      controls.update();
      controls.takeLook();
      walker.update(dt, controls.moveX, controls.moveY, ROOM_CAM_YAW, controls.takeJump());
      interior.updateCamera(camera, dt, walker.x, walker.z);
      interior.update();
      player.setPose(0, walker.x, walker.y + 0.01, walker.z, walker.yaw, PLAYER_SCALE);
      player.setAnim(0, walker.phase, walker.walk, 0, 0);
      player.setMood(0, walker.sit, walker.yawn);
      notifyMove(now);
      remoteView.focusX = walker.x;
      remoteView.focusZ = walker.z;
      remoteView.walking = true;
      remoteView.dist = WALK_DIST;
      remoteView.viewportW = viewportW;
      remoteView.viewportH = viewportH;
      remoteView.quality = quality;
      remotes.update(performance.now(), dt, remoteView);
      npcView.focusX = walker.x;
      npcView.focusZ = walker.z;
      npcView.walking = true;
      npcView.dist = WALK_DIST;
      npcView.viewportW = viewportW;
      npcView.viewportH = viewportH;
      npcs.update(dt, npcView);
      renderer.render(interior.scene, camera);
      cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
      // 문턱을 넘으면 밖으로 내보내고 알린다
      if (walker.z > ROOM_EXIT_Z && !placer.dragging) leaveHouse(true);
      return;
    }
    if (walking) {
      controls.update();
      const jump = controls.takeJump();
      if (fishing !== null) {
        // 낚시 중: 움직이지 않고 물 쪽으로 몸을 돌린 채 앉아 있는다
        walker.update(dt, 0, 0, walkCam.yaw, false);
        walker.yaw += wrapAngle(fishYaw - walker.yaw) * (1 - Math.exp(-dt * 8));
      } else walker.update(dt, controls.moveX, controls.moveY, walkCam.yaw, jump);
      walkCam.update(dt, camera, walker.x, walker.groundY, walker.air, walker.z, controls.takeLook());
      player.setPose(0, walker.x, walker.y + 0.035, walker.z, walker.yaw, PLAYER_SCALE);
      // 물고기를 낚으면 눈웃음을 짓는다
      player.setAnim(0, walker.phase, walker.walk, 0, fishing === 'caught' ? 1 : 0);
      player.setMood(0, walker.sit, fishing !== null ? 0 : walker.yawn);
      fishRig.update(dt, walker.x, walker.y + 0.035, walker.z, walker.yaw, PLAYER_SCALE);
      walkFocus.x = walker.x;
      walkFocus.z = walker.z;
      target.x = walkCam.focus.x;
      target.z = walkCam.focus.z;
      target.dist = WALK_DIST;
      checkNearHouse();
      notifyMove(now);
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
    remoteView.focusX = walking ? walker.x : target.x;
    remoteView.focusZ = walking ? walker.z : target.z;
    remoteView.walking = walking;
    remoteView.dist = target.dist;
    remoteView.viewportW = viewportW;
    remoteView.viewportH = viewportH;
    remoteView.quality = quality;
    remotes.update(performance.now(), dt, remoteView);
    npcView.focusX = remoteView.focusX;
    npcView.focusZ = remoteView.focusZ;
    npcView.walking = walking;
    npcView.dist = target.dist;
    npcView.viewportW = viewportW;
    npcView.viewportH = viewportH;
    npcs.update(dt, npcView);

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
      leaveHouse(false);
      stopFishing();
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
        // 다음 프레임에 시작 위치를 한 번 알린다
        sent.x = NaN;
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
        if (doorHouse !== null) {
          doorHouse = null;
          doorCb?.(null);
        }
      }
    },
    onNearHouse(cb) {
      nearCb = cb;
    },
    setRemotePlayers(players) {
      remotes.setPlayers(players, performance.now());
    },
    onLocalMove(cb) {
      moveCb = cb;
    },
    getLocalState: localState,
    enterHouse(houseNo, items, wallpaper, floor) {
      if (!houses.has(houseNo)) return;
      interior ??= new Interior(atmosphere.shared, geometries, drawings);
      if (inside === houseNo) {
        interior.restyle(wallpaper, floor);
        interior.setItems(items);
        if (placer.active) placer.relist(interior.list);
        interior.redraw(placer.heldId);
        return;
      }
      if (inside !== null) leaveHouse(false);
      if (!walking) api.setWalkMode(true);
      stopFishing();
      placer.end();
      interior.setShadows(quality < 3);
      interior.open(houseNo, items, wallpaper, floor);
      inside = houseNo;
      interior.scene.add(player.mesh, remotes.group, npcs.group, placer.group);
      // 밖에 있던 유저들은 방 안에 보이면 안 된다. 앱이 같은 집 안 사람만 다시 넘긴다
      remotes.clear();
      remotes.flatY = 0;
      npcs.clear();
      npcs.flatY = 0;
      walker.room = ROOM_WALK;
      walker.place(ROOM_START.x, ROOM_START.z, Math.PI);
      sent.x = NaN;
      blend = 1;
      if (nearHouse !== null) {
        nearHouse = null;
        nearCb?.(null);
      }
      if (doorHouse !== null) {
        doorHouse = null;
        doorCb?.(null);
      }
    },
    exitHouse() {
      leaveHouse(false);
    },
    setInteriorItems(items) {
      if (inside === null || !interior) return;
      interior.setItems(items);
      if (placer.active) placer.relist(interior.list);
      interior.redraw(placer.heldId);
    },
    onDoor(cb) {
      doorCb = cb;
    },
    onExitHouse(cb) {
      exitCb = cb;
    },
    setYardItemsFree(houseNo, items) {
      houses.setYardItemsFree(houseNo, items);
      const s = placer.space;
      if (placer.active && s && s.kind === 'yard' && s.houseNo === houseNo) {
        placer.relist(houses.freeList(houseNo));
        houses.redrawFree(placer.heldId);
      }
    },
    startPlacing(typeOrItemId, houseNo) {
      let space: Space | null = null;
      let list: PlacedItem[] = [];
      if (inside !== null && interior) {
        space = interior.space;
        list = interior.list;
      } else {
        const at = walking ? walker : rig.target;
        const no = houseNo ?? closestHouse(at.x, at.z);
        space = no === null ? null : houses.yardSpace(no);
        if (!space || no === null) {
          console.warn('[scene] startPlacing: 꾸밀 집을 찾지 못했어요');
          return;
        }
        list = houses.freeList(no);
        // 걷는 중이 아니면 그 마당이 크게 보이게 다가간다
        if (!walking && placer.space !== space) rig.flyTo(space.ox + 0.5 * space.sin, space.oz + 0.5 * space.cos, 24);
      }
      placer.begin(space, list, typeOrItemId ?? null);
    },
    stopPlacing() {
      placer.end();
    },
    rotatePlacing(step) {
      placer.rotate(step);
    },
    onPlace(cb) {
      placer.onPlace = cb;
    },
    onPick(cb) {
      placer.onPick = cb;
    },
    setDrawings(list) {
      if (!drawings.set(list)) return;
      houses.redrawFree();
      houses.redrawRoofArt();
      interior?.refreshDrawings();
      placer.refresh();
    },
    setRoofArt(items) {
      houses.setRoofArt(Array.isArray(items) ? items : []);
    },
    setNpcs(list) {
      npcs.set(Array.isArray(list) ? list : []);
    },
    onNpcTap(cb) {
      npcTapCb = cb;
    },
    setFishing(state) {
      if (state === null) {
        stopFishing();
        return;
      }
      if (!walking || inside !== null) return;
      if (fishing === null) {
        // 낚시터면 그 물 쪽으로, 아니면 바라보던 쪽 앞으로 던진다
        const spot = fishingSpotAt(walker.x, walker.z);
        const tx = spot ? spot.x : walker.x + Math.sin(walker.yaw) * 2.2;
        const tz = spot ? spot.z : walker.z + Math.cos(walker.yaw) * 2.2;
        fishYaw = Math.atan2(tx - walker.x, tz - walker.z);
        // 연못 물은 풀밭보다 조금 높고, 바다는 0 이다
        fishRig.begin(tx, tz, spot?.kind === 'pier' ? 0.02 : landAt(tx, tz) > 0 ? GROUND_Y + 0.075 : 0.02);
        walker.holdSit = true;
      }
      fishing = state;
      fishRig.setState(state);
    },
    setLocalPosition(x, z, rotY) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      stopFishing();
      const far = Math.hypot(x - walker.x, z - walker.z) > 8;
      walker.place(x, z, rotY !== undefined && Number.isFinite(rotY) ? rotY : walker.yaw);
      // 멀리 옮겼으면 카메라도 바로 따라간다 (가까우면 부드럽게 따라온다)
      if (walking && inside === null && far) {
        walkCam.snap(walker.x, walker.groundY, walker.z, walkCam.yaw);
        walkFocus.x = walker.x;
        walkFocus.z = walker.z;
        shadowX = Infinity;
      }
      // 다음 프레임에 새 위치를 한 번 알린다
      sent.x = NaN;
    },
    renderCatPreview(cat, size = 256, options = {}) {
      preview ??= new CatPreview(renderer, catModel, atmosphere.shared);
      return preview.render(cat, size, options, (houseNo) => hash01(houseNo, 99));
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
      remotes.dispose();
      npcs.dispose();
      fishRig.dispose();
      preview?.dispose();
      placer.dispose();
      interior?.dispose();
      geometries.dispose();
      drawings.dispose();
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
    remotes: { shown: remotes.shown, near: remotes.shownNear, tags: remotes.shownTags },
    inside,
    free: inside !== null && interior ? { shown: interior.free.shown, art: interior.free.shownArt } : { shown: houses.free.shown, art: houses.free.shownArt },
    placing: placer.state,
    roofArt: houses.shownRoofArt,
    npcs: { shown: npcs.shown, tags: npcs.shownTags },
    fishing,
  }));
  qualityOf.set(api, (level) => {
    qualityAuto = level === 'auto';
    if (level !== 'auto') applyQuality(level);
  });
  walkOf.set(api, (x, z, yaw = 0) => {
    if (walking) walker.place(x, z, yaw);
  });
  riggedOf.set(api, rig);
  const projected = new THREE.Vector3();
  projectOf.set(api, (x, y, z) => {
    const r = canvas.getBoundingClientRect();
    projected.set(x, y, z).project(camera);
    return { x: r.left + ((projected.x + 1) / 2) * r.width, y: r.top + ((1 - projected.y) / 2) * r.height };
  });
  return api;
}
