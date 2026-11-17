import * as THREE from 'three';
import type { CatLook, House, RegionId, YardItem } from '../shared/types';
import { CatFlock } from './cat/CatFlock';
import { createProceduralCatModel } from './cat/catModel';
import { CatPreview, type CatPreviewOptions } from './cat/catPreview';
import { Cave, CAVE_EXIT_Z, CAVE_START, CAVE_WALK, type CaveNode } from './cave/Cave';
import { ItemPreview } from './free/itemPreview';
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
import { Interior, ROOM_CAM_YAW, ROOM_EXIT, ROOM_START, ROOM_WALK } from './interior/Interior';
import { ROOM_HALF, ROOM_HALF_BIG } from './free/space';
import { Npcs, type SceneNpc } from './npc/Npcs';
import { CarLayer, CAR_SEAT_Y, CAR_SPEED, seatOffset } from './car/CatCar';
import { RemotePlayers } from './remote/RemotePlayers';
import { danceMotion } from './cat/dance';
import type { LocalState, RemotePlayer } from './remote/types';
import {
  collidersNear,
  fishingSpotAt,
  houseNoAt,
  homeDoor,
  HOME_SPOTS,
  houseSlot,
  landAt,
  LOCAL_SLOTS,
  caveMouths,
  lotGate,
  neighborhoodArea,
  neighborhoodAt,
  zoneAt,
  zoneCenter,
  yardHalfOf,
  setBigYardSet,
  skipCollider,
  MAILBOX_LOCAL,
  type Collider,
} from './layout';
import { ZONE_CAPACITY } from '../shared/config';
import { WalkControls } from './walk/controls';
import { WALK_DIST, WALK_FOV, WalkCamera } from './walk/walkCamera';
import { Walker } from './walk/Walker';
import { hash01 } from './util/rand';
import { GROUND_Y } from './world/constants';
import { World } from './world/World';
import { Snowfall } from './world/winter';
import { SNOW } from './core/glowLambert';

export { houseSlot, neighborhoodArea, neighborhoodAt, NEIGHBORHOOD_SIZE } from './layout';
export type { LocalState, PlayerAnim, RemotePlayer } from './remote/types';
export type { Drawing, InteriorItem, PlacedItem } from './free/types';
export { FREE_ITEM_LIST } from './free/catalog';
export { DEFAULT_PALETTE, DRAWING_SIZE, decodeDrawing, encodeDrawing } from './free/drawings';
export { ROOM_SIZE } from './free/space';
export { ROOM_STYLES } from './interior/Interior';
export { dockArea, fishingSpotAt, POND_FISH_REACH, POND_R } from './layout';
export type { FishingSpot } from './layout';
export { GROUND_Y } from './world/constants';
export type { FishingState } from './fishing/FishingRig';
export type { SceneNpc } from './npc/Npcs';
export type { CatPreviewOptions } from './cat/catPreview';
export type { CaveNode } from './cave/Cave';
export { CAVE_DEEPER } from './cave/Cave';
export { landAt, npcHomes, caveMouths, mapHills, townSquares, benchNear, TOWN_SQUARE, walkCost } from './layout';

/** 2026-11-16: 그 집 우편함의 세계 좌표 (마당 앞 오른쪽, 대문 옆) */
export function mailboxPos(houseNo: number): { x: number; z: number } {
  const s = houseSlot(houseNo);
  const c = Math.cos(s.rot);
  const n = Math.sin(s.rot);
  return { x: s.x + MAILBOX_LOCAL.x * c + MAILBOX_LOCAL.z * n, z: s.z - MAILBOX_LOCAL.x * n + MAILBOX_LOCAL.z * c };
}

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
  enterHouse(houseNo: number, interior: InteriorItem[], wallpaper?: string, floor?: string, big?: boolean): void;
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
  setRoofArt(items: Array<{ houseNo: number; drawingId: string; backId?: string | null }>): void;
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

  // ── 2026-11-15: 주민 집, 동굴, 시야, 가구 그림 ──

  /**
   * 섬 모서리의 주민 집(npcHomes 의 id) 안으로 들어간다. 방은 enterHouse 와 같다.
   * 문으로 걸어 나오면 onExitHouse 를 -(id + 1) 로 부른다.
   */
  enterNpcHome(homeId: number, interior: InteriorItem[], wallpaper?: string, floor?: string): void;
  /**
   * 동굴 안으로 (깊이 1~3). 동굴 산 입구에서 부른다. 광석 바위는 nodes 로 준다.
   * 이미 동굴 안이면 그 깊이로 옮긴다 (안쪽 입구 앞에서 시작). 나가는 길로 걸어 나오면 onExitCave.
   */
  enterCave(level: number, nodes: CaveNode[]): void;
  /** 동굴 안 광석 바위 목록을 바꾼다 (캔 것을 빼고 다시 넘긴다) */
  setCaveNodes(nodes: CaveNode[]): void;
  /** 동굴 밖(입구 앞)으로 나온다. 이때는 onExitCave 를 부르지 않는다 */
  exitCave(): void;
  onExitCave(cb: () => void): void;
  /** 동굴 안에서 (x, z) 둘레 reach 안의 가장 가까운 광석 바위 id */
  caveNodeNear(reach?: number): string | null;
  /** 걷기 시야 넓히기 0(기본) ~ 1(가장 넓게). 카메라가 조금 더 멀고 높아진다 */
  setWalkZoom(amount: number): void;
  /** 꾸미기 아이템 하나를 그림으로 찍는다 (상점, 꾸미기 줄). 배경이 투명한 PNG data URL */
  renderItemPreview(type: string, size?: number): string;

  // ── 2026-11-15: 춤, 말풍선 자리, 다른 유저 누르기, 앉기 ──

  /** 내 고양이 춤 (src/shared/social.ts 의 DANCES id). null 이면 멈춤. 걷는 동안은 멈춰 보이고 서면 다시 춘다 */
  setDance(danceId: string | null): void;
  /** 가만히 있으면 바로 앉는다 (벤치, 앉기 버튼). 걸어도 다시 서면 또 앉으니 앱이 꺼 준다 */
  setSitting(on: boolean): void;
  /**
   * 고양이 머리 위의 화면 자리 (캔버스 기준 px). id 가 null 이면 내 고양이, 아니면 다른 유저(RemotePlayer.id).
   * 걷기 모드가 아니거나 화면 밖/안 보이면 null. 말풍선, 이모티콘을 띄울 때 매 프레임 부른다
   */
  catScreenPos(id: string | null): { x: number; y: number } | null;
  /** 다른 유저 고양이를 눌렀을 때 그 id 를 알린다 (프로필) */
  onRemoteTap(cb: (id: string) => void): void;

  // ── 2026-11-16: 캔버스, 우편함, 자동차, 지도 회전 ──

  /** 그림이 붙은 아이템(캔버스, 액자, 간판, 러그)을 눌렀을 때 (꾸미기 중이 아닐 때만). 크게 보기용 */
  onArtTap(cb: (drawingId: string, type: string) => void): void;
  /** 걷기 카메라가 보는 방향 (라디안. 0 이면 카메라가 고양이 남쪽(+z)에서 북쪽을 본다). 지도 돌리기용 */
  getViewYaw(): number;
  /**
   * 고양이 자동차 (2026-11-16). 내 고양이가 자동차에 타거나(on) 내린다. 타면 빠르게 달린다.
   * passenger: 남의 차 뒷자리에 탔을 때 (조이스틱이 듣지 않고, 앱이 setLocalPosition 으로 운전자 자리를 따라가게 한다)
   */
  setRiding(mode: 'drive' | 'passenger' | null, driverId?: string): void;

  // ── 2026-11-16: 마당 넓히기, 겨울 ──

  /** 마당을 넓힌 집 번호 전체 (마당 넓히기, 300츄르). 나머지 집은 기본 마당(6m), 넓힌 집은 7.2m */
  setBigYards(houseNos: number[]): void;
  /**
   * 겨울 꾸미기 (크리스마스). 켜면: 나무에 늘 눈, 밤에는 땅/빈 집 지붕/소품 위에 눈이 쌓이고,
   * 집 처마/나무/광장에 LED 전구, 동네 큰 나무와 마을 광장 트리에 크리스마스 장식, 화면에 눈이 조금 내린다.
   */
  setWinter(on: boolean): void;

  /**
   * 화면 품질 (2026-11-17). 'auto': 보통으로 시작해 폰이 버거워하면 스스로 저사양으로 바꾼다(약한 폰은 처음부터 저사양),
   * 'normal': 저사양으로 바꾸지 않는다(자동 품질 단계는 그대로 동작), 'low': 늘 저사양.
   * 저사양: 해상도 낮춤, 그림자 끔, 30fps 고정(배터리, 발열), 눈송이/전구 빛 줄임, 반딧불 끔, 자세히 그리는 집 16채.
   */
  setGraphicsMode(mode: GraphicsMode): void;
  /** 지금 화면 품질 상태 */
  getGraphicsState(): GraphicsState;
  /** 'auto' 에서 폰이 버거워해서 저사양으로 바꿨을 때 한 번 부른다 (앱이 안내하거나 다음 실행 때 기억하라고) */
  onAutoLowSpec(cb: () => void): void;

  /**
   * 촬영 모드 (2026-11-17): 카메라를 앱이 직접 놓는다. null 이면 원래 카메라(손가락 조작)로 돌아간다.
   * 켜 있는 동안에는 손가락으로 지도를 움직이거나 집을 누를 수 없다. 걷기/집 안에서는 무시한다.
   */
  setCinemaCamera(cam: CinemaCamera | null): void;
  /** 집 이름표를 보일지 (기본 true). 촬영 모드에서 가까이 찍을 때 끈다 */
  setNameTags(on: boolean): void;
  /**
   * 촬영 화질 (2026-11-17). 'high': 최고 품질 단계로 고정(자동으로 낮추지 않음, 그림자 2048, 해상도 기기 비율 최대 2),
   * 'max': 같은데 해상도를 기기 비율 최대 3 까지 (화면 기록이 선명해지지만 폰이 더 버거워한다). 'off': 원래대로.
   */
  setCinemaQuality(mode: 'off' | 'high' | 'max'): void;

  /** 캔버스 크기가 바뀌면 부른다 */
  resize(): void;
  dispose(): void;
}

/** 촬영 모드 카메라: 카메라 자리(x, y, z)와 바라보는 곳(lookX, lookY, lookZ), 화각(도) */
export interface CinemaCamera {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov?: number;
}

export type GraphicsMode = 'auto' | 'normal' | 'low';
export interface GraphicsState {
  mode: GraphicsMode;
  /** 지금 저사양으로 그리는지 */
  low: boolean;
  /** 처음 볼 때 약한 폰으로 보였는지 (메모리, 코어 수, 그래픽 칩 이름) */
  weakDevice: boolean;
  /** 자동 품질 단계 (0=최고, 4=최저) */
  quality: number;
}
export interface IslandSceneOptions {
  /** 처음 화면 품질 (기본 'auto') */
  graphics?: GraphicsMode;
  /** 'auto' 일 때 지난번에 저사양으로 바뀌었으면 true: 처음부터 저사양 */
  rememberLow?: boolean;
}

/** 약한 폰인지 짐작 (메모리 3GB 이하, 코어 4개 이하, 오래된 그래픽 칩) */
function guessWeakDevice(gl: WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 3) return true;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4) return true;
  if (!gl) return false;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    // Adreno 3xx~5xx, Mali-4xx/T/G31~G57, PowerVR, 소프트웨어 렌더링
    if (/adreno[^0-9]*[345]\d\d\b/.test(name)) return true;
    if (/mali-(4\d\d|t\d+|g(31|51|52|57|71|72))\b/.test(name)) return true;
    if (/powervr|swiftshader|llvmpipe|software/.test(name)) return true;
  } catch {
    // 이름을 못 읽으면 보통 폰으로 본다
  }
  return false;
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

export function createIslandScene(canvas: HTMLCanvasElement, options: IslandSceneOptions = {}): IslandScene {
  let graphicsMode: GraphicsMode = options.graphics === 'low' || options.graphics === 'normal' ? options.graphics : 'auto';
  // 계단 현상 지우기(antialias)는 만들 때만 정할 수 있다. 저사양으로 시작하면 끈다 (기기 비율 2 이상이면 거의 티가 안 난다)
  const preWeak = guessWeakDevice(null);
  const startLow = graphicsMode === 'low' || (graphicsMode === 'auto' && (preWeak || !!options.rememberLow));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !startLow, powerPreference: startLow ? 'default' : 'high-performance' });
  const weakDevice = preWeak || guessWeakDevice(renderer.getContext());
  /** 'auto' 에서 저사양으로 바뀌었는지 */
  let autoLow = graphicsMode === 'auto' && (weakDevice || !!options.rememberLow);
  let cineQuality: 'off' | 'high' | 'max' = 'off';
  // 촬영 화질을 켜 두면 저사양을 잠깐 끈다
  const lowOn = () => cineQuality === 'off' && (graphicsMode === 'low' || (graphicsMode === 'auto' && autoLow));
  let autoLowCb: (() => void) | null = null;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // 그림자 지도는 필요할 때만 다시 그린다 (아래 frame 에서 정한다). 그림자 그리기는 장면을 한 번 더 그리는 것과 같다
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 2, 4000);
  let cinema: CinemaCamera | null = null;
  const atmosphere = new Atmosphere(scene, 2048);
  scene.background = atmosphere.horizon;

  const world = new World(atmosphere);
  // 겨울 (2026-11-16): 내리는 눈. 쌓인 눈은 재질이 그린다 (SNOW.uWinter)
  const snowfall = new Snowfall(900);
  snowfall.points.visible = false;
  scene.add(snowfall.points);
  let winterOn = false;
  const setWinterOn = (on: boolean) => {
    winterOn = on;
    SNOW.uWinter.value = on ? 1 : 0;
    world.setWinter(on);
    if (!on) snowfall.points.visible = false;
  };
  const catModel = createProceduralCatModel(atmosphere.shared);
  const geometries = new ItemGeometries();
  const drawings = new DrawingStore();
  const houses = new HouseLayer(atmosphere.shared, catModel, geometries, drawings);
  const mark = new HighlightMark();
  // 내가 조작하는 고양이 (걷기 모드에서만 보인다)
  const player = new CatFlock(catModel, 1, 'high');
  player.mesh.visible = false;
  // 다른 유저의 고양이
  /** (x, z) 에 앉아 yaw 쪽을 보는 고양이가 찌를 던질 물 위의 자리. 낚시터면 그 물, 아니면 바라보는 쪽 2.2 앞 */
  const fishTarget = (x: number, z: number, yaw: number) => {
    const spot = fishingSpotAt(x, z);
    const tx = spot ? spot.x : x + Math.sin(yaw) * 2.2;
    const tz = spot ? spot.z : z + Math.cos(yaw) * 2.2;
    // 연못 물은 풀밭보다 조금 높고, 바다는 0 이다
    const y = spot?.kind === 'pier' ? 0.02 : landAt(tx, tz) > 0 ? GROUND_Y + 0.075 : 0.02;
    return { x: tx, y, z: tz };
  };
  const remotes = new RemotePlayers(catModel, { shared: atmosphere.shared, target: fishTarget });
  // 주민(NPC) 고양이, 낚시 소품, 고양이 그림 찍기
  const npcs = new Npcs(catModel, atmosphere.shared);
  const fishRig = new FishingRig(atmosphere.shared);
  let fishing: FishingState | null = null;
  let fishYaw = 0;
  /** 낚시를 시작하면 이 시간(초) 동안 카메라를 고양이 뒤로 돌려 물 쪽을 보게 한다 */
  let fishCamTurn = 0;
  let npcTapCb: ((id: string) => void) | null = null;
  let artTapCb: ((drawingId: string, type: string) => void) | null = null;
  // 고양이 자동차 (2026-11-16)
  let riding: 'drive' | 'passenger' | null = null;
  let rideDriver: string | null = null;
  const myCar = new CarLayer(atmosphere.shared, 1);
  remotes.localCar = () => (riding === 'drive' && walking && inside === null && !inCave ? { x: walker.x, z: walker.z, yaw: walker.yaw, y: walker.groundY } : null);
  let remoteTapCb: ((id: string) => void) | null = null;
  let dance: string | null = null;
  let danceT = 0;
  const projV = new THREE.Vector3();
  /** 세계 → 캔버스 px (카메라 뒤나 화면 밖이면 null) */
  const project = (x: number, y: number, z: number) => {
    projV.set(x, y, z).project(camera);
    if (projV.z > 1 || projV.z < -1 || Math.abs(projV.x) > 1.1 || Math.abs(projV.y) > 1.1) return null;
    return { x: (projV.x + 1) * 0.5 * viewportW, y: (1 - projV.y) * 0.5 * viewportH };
  };
  /** 내 고양이 그리기 (춤 포함). yOff: 땅에서 띄우는 값 */
  const drawPlayer = (dt: number, yOff: number, happy = 0, allowDance = true) => {
    const ride = riding !== null && walking && inside === null && !inCave;
    const dm = !ride && allowDance && dance && walker.walk < 0.15 && walker.air <= 0 ? danceMotion(dance, (danceT += dt)) : null;
    if (!dm) danceT = 0;
    myCar.begin();
    if (ride) {
      // 차에 타면 자리에 앉아서 간다 (운전이면 차도 같이 그린다. 뒷자리면 운전자 차가 그려 준다)
      if (riding === 'drive') myCar.push(walker.x, walker.y + yOff - 0.035, walker.z, walker.yaw, 1, walker.speed > 0.5 ? Math.abs(Math.sin(walker.phase * 0.5)) * 0.03 : 0);
      const off = riding === 'drive' ? seatOffset(walker.yaw, false) : { dx: 0, dz: 0 };
      player.setPose(0, walker.x + off.dx, walker.y + yOff + CAR_SEAT_Y, walker.z + off.dz, walker.yaw, PLAYER_SCALE);
      player.setAnim(0, walker.phase, 0, 0, happy);
    } else {
      player.setPose(0, walker.x, walker.y + yOff + (dm?.dy ?? 0), walker.z, walker.yaw + (dm?.dyaw ?? 0), PLAYER_SCALE * (dm?.scale ?? 1));
      player.setAnim(0, dm && dm.walk ? dm.phase : walker.phase, dm && dm.walk ? dm.walk : walker.walk, 0, dm ? dm.happy : happy);
    }
    myCar.end();
    return dm;
  };
  let preview: CatPreview | null = null;
  // 꾸미기(끌어 놓기)와 집 안. 집 안은 처음 들어갈 때 만든다
  const placer = new Placer(canvas, camera, geometries, drawings, atmosphere.shared);
  let interior: Interior | null = null;
  let inside: number | null = null;
  let doorCb: ((houseNo: number | null) => void) | null = null;
  let exitCb: ((houseNo: number) => void) | null = null;
  let doorHouse: number | null = null;
  const roomBlockers: Array<{ x: number; z: number; r: number }> = [];
  // 동굴 (처음 들어갈 때 만든다)
  let cave: Cave | null = null;
  let inCave = false;
  let caveExitCb: (() => void) | null = null;
  /** 동굴에서 나오면 설 자리 (들어간 입구 앞) */
  const caveReturn = { x: 0, z: 0, yaw: 0 };
  let itemPreview: ItemPreview | null = null;
  scene.add(world.group, houses.group, mark.group, player.mesh, remotes.group, npcs.group, fishRig.group, placer.group, myCar.mesh);
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
    if (inCave && cave) cave.blockers(out);
    else if (inside !== null && interior) blockersOf(interior.space, interior.list, roomBlockers, 0, out);
    else houses.blockersNear(x, z, out);
  };
  // 주민이 설 수 있는 자리: 밖이면 땅 위이고 집/나무/가구에 안 걸리는 곳, 집 안이면 방 안이고 가구에 안 걸리는 곳
  const npcNear: Collider[] = [];
  const npcBlock: Array<{ x: number; z: number; r: number }> = [];
  npcs.canStand = (x, z) => {
    const pad = 0.42;
    npcBlock.length = 0;
    if (inCave && cave) return cave.canStand(x, z, pad);
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
        if (skipCollider(col, zone, (no) => houses.has(no))) continue;
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
  /** 1.5초 동안 50ms 넘게 걸린 프레임 수 (평균 fps 는 괜찮아도 뚝뚝 끊기는 것을 잡는다) */
  let longFrames = 0;
  /** 최저 단계에서도 버거운 구간이 이어진 횟수 ('auto' 가 저사양으로 바꾸는 기준) */
  let strainWindows = 0;
  let shadowTick = 0;
  let lastDraw = 0;
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
    renderer.setPixelRatio(Math.max(0.6, Math.min(window.devicePixelRatio || 1, cineQuality === 'max' ? 3 : 2) * QUALITY_SCALE[quality]));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    world.resize(h * pr, camera.fov);
    world.setDetail(pr, lowOn());
    snowfall.resize(h * pr, camera.fov);
    snowfall.setMaxSize(7 * Math.min(1, pr / 2) * (lowOn() ? 0.8 : 1));
    controls.layout();
  };

  /** 저사양이면 단계 3(그림자 끔, 해상도 0.56) 아래로는 올리지 않는다 */
  const LOW_FLOOR = 3;
  const applyQuality = (level: number, force = false) => {
    level = Math.max(lowOn() ? LOW_FLOOR : 0, Math.min(QUALITY_SCALE.length - 1, level));
    if (level === quality && !force) return;
    quality = level;
    const low = lowOn();
    atmosphere.sun.castShadow = level < 3;
    // 그림자 지도 크기: 단계 2부터 1024 (그림자 그리는 비용과 메모리가 1/4)
    const mapSize = level >= 2 ? 1024 : 2048;
    if (atmosphere.sun.shadow.mapSize.x !== mapSize) {
      atmosphere.sun.shadow.mapSize.set(mapSize, mapSize);
      atmosphere.sun.shadow.map?.dispose();
      atmosphere.sun.shadow.map = null;
    }
    renderer.shadowMap.needsUpdate = true;
    houses.setNearLimit(low || level >= 4 ? 16 : level >= 2 ? 24 : 64);
    interior?.setShadows(level < 3);
    snowfall.setDensity(low ? 0.3 : level >= 3 ? 0.4 : level >= 1 ? 0.7 : 1);
    resize();
  };
  const refreshGraphics = () => {
    goodWindows = 0;
    strainWindows = 0;
    applyQuality(lowOn() ? Math.max(quality, LOW_FLOOR) : quality, true);
  };

  syncWorld();
  resize();
  if (lowOn()) applyQuality(LOW_FLOOR, true);
  // 처음 화면: 첫 동네(1~10번지)를 동네 시점으로
  const n0 = neighborhoodArea(0);
  rig.jumpTo(n0.x, n0.z - 1, camera.aspect < 0.8 ? NEIGHBORHOOD_DIST : 60);
  // 걷기 전에 getLocalState 를 불러도 땅 위의 자리가 나오게 한다
  walker.place(n0.x, n0.z + 7.4, 0);

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);

  const onTap = (cx: number, cy: number) => {
    // 다른 유저 고양이를 누르면 프로필 (꾸미는 중에는 빼고)
    if (remoteTapCb && walking && !placer.active && remotes.shown > 0) {
      const rect = canvas.getBoundingClientRect();
      const id = remotes.pickScreen(cx - rect.left, cy - rect.top, project);
      if (id !== null) {
        remoteTapCb(id);
        return;
      }
    }
    // 주민을 누르면 그것부터 알린다 (꾸미는 중에는 빼고)
    if (npcTapCb && !placer.active && npcs.shown > 0) {
      const id = npcs.pick(rig.rayFrom(cx, cy));
      if (id !== null) {
        npcTapCb(id);
        return;
      }
    }
    if (inCave) return;
    if (inside !== null) {
      // 집 안: 아이템을 누르면 알린다 (꾸미기 모드에서는 끌어 놓기 쪽이 먼저 받는다)
      const hit = interior && !placer.active ? pickItem(interior.space, interior.list, rig.rayFrom(cx, cy)) : null;
      if (hit?.drawingId && artTapCb) artTapCb(hit.drawingId, hit.type);
      else if (hit) placer.onPick?.(hit.id);
      return;
    }
    if (placer.active) return;
    const ray = rig.rayFrom(cx, cy);
    if (artTapCb) {
      const art = houses.pickArt(ray);
      if (art?.drawingId) {
        artTapCb(art.drawingId, art.type);
        return;
      }
    }
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
        const yh = yardHalfOf(houseNo);
        const d = Math.hypot(lot.x + yh * Math.sin(lot.rot) - lx, lot.z + yh * Math.cos(lot.rot) - lz);
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
    if (houseNo < 0) {
      // 주민 집: 그 집 문 앞에 선다
      const id = -houseNo - 1;
      const h = HOME_SPOTS[id % HOME_SPOTS.length];
      const c = zoneCenter(Math.floor(id / HOME_SPOTS.length));
      const d = homeDoor(h, 2.9);
      walker.place(c.x + d.x, c.z + d.z, h.rot);
    } else {
      const s = houseSlot(houseNo);
      walker.place(s.x + DOOR_STAND_Z * Math.sin(s.rot), s.z + DOOR_STAND_Z * Math.cos(s.rot), s.rot);
    }
    walkCam.snap(walker.x, walker.groundY, walker.z, walkCam.yaw);
    walkFocus.x = walker.x;
    walkFocus.z = walker.z;
    shadowX = Infinity;
    sent.x = NaN;
    blend = 1;
    if (viaDoor) exitCb?.(houseNo);
  };

  /** 동굴 밖으로: 입구 앞에 동굴을 등지고 선다 */
  const leaveCave = (viaExit: boolean) => {
    if (!inCave) return;
    inCave = false;
    scene.add(player.mesh, remotes.group, npcs.group, placer.group);
    remotes.clear();
    remotes.flatY = null;
    npcs.clear();
    npcs.flatY = null;
    walker.room = null;
    walker.place(caveReturn.x, caveReturn.z, caveReturn.yaw);
    walkCam.snap(walker.x, walker.groundY, walker.z, walkCam.yaw);
    walkFocus.x = walker.x;
    walkFocus.z = walker.z;
    shadowX = Infinity;
    sent.x = NaN;
    blend = 1;
    if (viaExit) caveExitCb?.();
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
  const cineLook = new THREE.Vector3();

  const frame = (now: number) => {
    if (disposed || contextLost) return;
    raf = requestAnimationFrame(frame);
    // 저사양: 30fps 로 고정한다. 들쭉날쭉한 40~60fps 보다 고른 30fps 가 덜 끊겨 보이고, 폰이 덜 뜨거워져서
    // 발열로 느려지는 일도 줄어든다 (화면 주사율이 60이면 한 번 건너 한 번 그린다)
    const low = lowOn();
    if (low && now - lastDraw < 1000 / 30 - 3) return;
    lastDraw = now;
    // 첫 프레임은 시간이 거꾸로 잡힐 수 있어서 0 아래로 내려가지 않게 한다
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.05, rawDt);
    last = now;
    const t0 = performance.now();
    // 그림자 지도: 최고 단계는 매 프레임, 그 밖에는 두 번에 한 번 (집과 나무는 가만히 있고 고양이만 움직인다)
    renderer.shadowMap.needsUpdate = quality === 0 || (++shadowTick & 1) === 0;

    // 자동 품질: 1.5초씩 평균 fps 와 끊긴 프레임 수를 보고 단계를 정한다 (탭이 가려졌다 돌아온 직후는 빼고)
    if (rawDt > 0 && rawDt < 0.5) {
      fpsFrames++;
      fpsTime += rawDt;
      if (rawDt > 0.05) longFrames++;
      if (fpsTime >= 1.5) {
        const fps = fpsFrames / fpsTime;
        // 10% 넘는 프레임이 50ms 를 넘으면 평균이 괜찮아도 끊겨 보인다 (아이폰 저전력 모드는 30fps 로 묶여서 평균만 보면 못 잡는다)
        const janky = longFrames >= Math.max(3, fpsFrames * 0.1);
        fpsFrames = 0;
        fpsTime = 0;
        longFrames = 0;
        // 저사양은 30fps 가 목표라서 기준을 낮춘다
        const slow = fps < (low ? 22 : 27) || janky;
        if (qualityAuto && graphicsMode === 'auto' && !autoLow) {
          // 최저 단계에서도 버거운 것이 3번(약 4.5초) 이어지면 저사양으로 바꾼다
          if (slow && quality >= QUALITY_SCALE.length - 1) {
            if (++strainWindows >= 3) {
              autoLow = true;
              refreshGraphics();
              autoLowCb?.();
            }
          } else if (!slow) strainWindows = 0;
        }
        if (qualityAuto) {
          if (slow) {
            goodWindows = 0;
            lastDrop = now;
            applyQuality(quality + 1);
          } else if (!low && fps > 54 && quality > 0 && now - lastDrop > 20000) {
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
    if (inCave && cave) {
      // 동굴 안: 섬은 그리지 않는다
      controls.update();
      controls.takeLook();
      walker.update(dt, controls.moveX, controls.moveY, 0, controls.takeJump());
      cave.updateCamera(camera, dt, walker.x, walker.z);
      cave.update(dt);
      const dmc = drawPlayer(dt, 0.01);
      player.setMood(0, dmc ? 0 : walker.sit, walker.yawn);
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
      renderer.render(cave.scene, camera);
      cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
      if (walker.z > CAVE_EXIT_Z) leaveCave(true);
      return;
    }
    if (inside !== null && interior) {
      // 집 안: 섬은 그리지 않고 방 하나만 그린다
      controls.update();
      controls.takeLook();
      // 꾸미는 동안에는 조이스틱이 숨고 고양이도 가만히 있는다 (2026-11-16)
      const jumpIn = controls.takeJump();
      walker.update(dt, placer.active ? 0 : controls.moveX, placer.active ? 0 : controls.moveY, ROOM_CAM_YAW, !placer.active && jumpIn);
      interior.updateCamera(camera, dt, walker.x, walker.z);
      interior.update();
      const dmi = drawPlayer(dt, 0.01);
      player.setMood(0, dmi ? 0 : walker.sit, walker.yawn);
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
      if (walker.z > ROOM_EXIT.z && !placer.dragging) leaveHouse(true);
      return;
    }
    if (walking) {
      controls.update();
      const jump = controls.takeJump();
      if (fishing !== null) {
        // 낚시 중: 움직이지 않고 물 쪽으로 몸을 돌린 채 앉아 있는다
        walker.update(dt, 0, 0, walkCam.yaw, false);
        walker.yaw += wrapAngle(fishYaw - walker.yaw) * (1 - Math.exp(-dt * 8));
        if (fishCamTurn > 0) {
          fishCamTurn -= dt;
          walkCam.yaw += wrapAngle(fishYaw + Math.PI - walkCam.yaw) * (1 - Math.exp(-dt * 4));
        }
      } else if (riding === 'passenger') {
        // 남의 차 뒷자리: 운전자 차를 따라간다 (조이스틱은 듣지 않는다)
        const d = rideDriver ? remotes.posOf(rideDriver) : null;
        walker.update(dt, 0, 0, walkCam.yaw, false);
        if (d) {
          const off = seatOffset(d.yaw, true);
          walker.x = d.x + off.dx;
          walker.z = d.z + off.dz;
          walker.yaw = d.yaw;
          walker.groundY = d.y;
          walker.y = d.y;
        }
      } else if (placer.active) walker.update(dt, 0, 0, walkCam.yaw, false);
      else walker.update(dt, controls.moveX, controls.moveY, walkCam.yaw, jump);
      walkCam.update(dt, camera, walker.x, walker.groundY, walker.air, walker.z, controls.takeLook());
      // 물고기를 낚으면 눈웃음을 짓는다
      const dmw = drawPlayer(dt, 0.035, fishing === 'caught' ? 1 : 0, fishing === null);
      player.setMood(0, riding ? 1 : dmw ? 0 : walker.sit, fishing !== null || riding ? 0 : walker.yawn);
      fishRig.update(dt, walker.x, walker.y + 0.035, walker.z, walker.yaw, PLAYER_SCALE);
      walkFocus.x = walker.x;
      walkFocus.z = walker.z;
      target.x = walkCam.focus.x;
      target.z = walkCam.focus.z;
      target.dist = WALK_DIST;
      checkNearHouse();
      notifyMove(now);
    } else if (cinema) {
      // 촬영 모드: 앱이 준 자리에 그대로 둔다 (부드러운 움직임은 앱이 매 프레임 계산한다)
      camera.position.set(cinema.x, cinema.y, cinema.z);
      camera.lookAt(cinema.lookX, cinema.lookY, cinema.lookZ);
      const d = camera.position.distanceTo(cineLook.set(cinema.lookX, cinema.lookY, cinema.lookZ));
      const near = THREE.MathUtils.clamp(d * 0.06, 0.25, 12);
      if (Math.abs(near - camera.near) > 0.01) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      target.x = cinema.lookX;
      target.z = cinema.lookZ;
      target.dist = d;
    } else {
      rig.update(dt);
      const t = rig.target;
      target.x = t.x;
      target.z = t.z;
      target.dist = t.dist;
    }
    // 시점이 바뀌는 동안에는 이전 카메라 자리에서 새 자리로 부드럽게 옮긴다
    const fovGoal = walking ? WALK_FOV + walkCam.zoom * 8 : cinema ? (cinema.fov ?? VIEW_FOV) : VIEW_FOV;
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
    if (winterOn) snowfall.update(dt, camera, target, atmosphere.shared.uNight.value);
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

  /** 방 하나(집 안) 열기. houseNo 가 음수면 주민 집 -(id+1) */
  const openRoom = (houseNo: number, items: InteriorItem[], wallpaper?: string, floor?: string, big = false) => {
      if (inCave) leaveCave(false);
      interior ??= new Interior(atmosphere.shared, geometries, drawings);
      if (inside === houseNo && interior.roomHalf !== (big ? ROOM_HALF_BIG : ROOM_HALF)) {
        // 집을 넓혔으면 방을 새 크기로 다시 연다 (같은 집이라도)
        const keep = { x: walker.x, z: walker.z };
        interior.open(houseNo, items, wallpaper, floor, big ? ROOM_HALF_BIG : ROOM_HALF);
        walker.room = ROOM_WALK;
        walker.place(keep.x, keep.z, walker.yaw);
        if (placer.active) placer.relist(interior.list);
        return;
      }
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
      interior.open(houseNo, items, wallpaper, floor, big ? ROOM_HALF_BIG : ROOM_HALF);
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
    };

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
      leaveCave(false);
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
        myCar.begin();
        myCar.end();
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
    enterHouse(houseNo, items, wallpaper, floor, big) {
      if (!houses.has(houseNo)) return;
      openRoom(houseNo, items, wallpaper, floor, !!big);
    },
    enterNpcHome(homeId, items, wallpaper, floor) {
      if (!Number.isInteger(homeId) || homeId < 0) return;
      openRoom(-homeId - 1, items, wallpaper, floor);
    },
    enterCave(level, nodes) {
      cave ??= new Cave();
      if (inside !== null) leaveHouse(false);
      if (!walking) api.setWalkMode(true);
      stopFishing();
      placer.end();
      if (!inCave) {
        // 나올 때 설 자리: 가장 가까운 동굴 입구 앞
        const zone = Math.max(0, zoneAt(walker.x, walker.z));
        const m = caveMouths(zone + 1)[zone];
        caveReturn.x = m.x + Math.sin(m.rot) * 1.4;
        caveReturn.z = m.z + Math.cos(m.rot) * 1.4;
        caveReturn.yaw = m.rot;
        cave.scene.add(player.mesh, remotes.group, npcs.group);
        remotes.clear();
        remotes.flatY = 0;
        npcs.clear();
        npcs.flatY = 0;
      }
      inCave = true;
      cave.open(level, Array.isArray(nodes) ? nodes : []);
      walker.room = CAVE_WALK;
      walker.place(CAVE_START.x, CAVE_START.z, Math.PI);
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
    setCaveNodes(nodes) {
      if (inCave && cave) cave.setNodes(Array.isArray(nodes) ? nodes : []);
    },
    exitCave() {
      leaveCave(false);
    },
    onExitCave(cb) {
      caveExitCb = cb;
    },
    caveNodeNear(reach = 1.1) {
      return inCave && cave ? cave.nodeNear(walker.x, walker.z, reach) : null;
    },
    setWalkZoom(amount) {
      walkCam.zoom = Math.max(0, Math.min(1, Number(amount) || 0));
    },
    renderItemPreview(type, size = 128) {
      itemPreview ??= new ItemPreview(renderer, geometries, atmosphere.shared);
      return itemPreview.render(type, size);
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
    onArtTap(cb) {
      artTapCb = cb;
    },
    getViewYaw: () => (walking ? walkCam.yaw : 0),
    setRiding(mode, driverId) {
      riding = mode === 'drive' || mode === 'passenger' ? mode : null;
      rideDriver = riding === 'passenger' ? (driverId ?? null) : null;
      walker.speedMul = riding === 'drive' ? CAR_SPEED : 1;
      if (!riding) {
        myCar.begin();
        myCar.end();
      }
    },
    setRoofArt(items) {
      houses.setRoofArt(Array.isArray(items) ? items : []);
    },
    setBigYards(list) {
      if (setBigYardSet(Array.isArray(list) ? list : [])) houses.bigYardsChanged();
    },
    setWinter(on) {
      setWinterOn(!!on);
    },
    setCinemaCamera(cam) {
      const was = cinema !== null;
      cinema = cam ? { ...cam } : null;
      if (cinema && !was) {
        blend = 1;
        rig.enabled = false;
      } else if (!cinema && was) {
        if (!walking) {
          rig.enabled = true;
          startBlend();
          rig.jumpTo(target.x, target.z, camera.aspect < 0.8 ? NEIGHBORHOOD_DIST : 60);
        }
      }
    },
    setNameTags(on) {
      houses.setNameTags(on);
    },
    setCinemaQuality(mode) {
      if (mode === cineQuality) return;
      cineQuality = mode;
      if (mode === 'off') {
        qualityAuto = true;
        refreshGraphics();
      } else {
        // 저사양 바닥(LOW_FLOOR)을 피하려고 잠깐 'normal' 처럼 다룬다
        qualityAuto = false;
        applyQuality(0, true);
      }
    },
    setGraphicsMode(mode) {
      const next: GraphicsMode = mode === 'low' || mode === 'normal' ? mode : 'auto';
      if (next === graphicsMode) return;
      const wasLow = lowOn();
      graphicsMode = next;
      // 자동으로 돌아오면 약한 폰 짐작부터 다시 (지난번 기억은 앱이 정한다)
      if (next === 'auto') autoLow = weakDevice;
      if (wasLow && !lowOn()) {
        // 저사양을 풀면 한 단계씩 다시 올라갈 수 있게 단계 1부터
        quality = Math.min(quality, 1);
        lastDrop = performance.now() - 20000;
      }
      refreshGraphics();
    },
    getGraphicsState() {
      return { mode: graphicsMode, low: lowOn(), weakDevice, quality };
    },
    onAutoLowSpec(cb) {
      autoLowCb = cb;
    },
    setNpcs(list) {
      npcs.set(Array.isArray(list) ? list : []);
    },
    setDance(id) {
      if (dance !== id) danceT = 0;
      dance = id;
    },
    setSitting(on) {
      walker.holdSit = on;
    },
    catScreenPos(id) {
      if (!walking) return null;
      if (id === null) return project(walker.x, walker.y + PLAYER_SCALE * 1.05 + 0.1, walker.z);
      const v = remotes.headOf(id, new THREE.Vector3());
      return v ? project(v.x, v.y + 0.05, v.z) : null;
    },
    onRemoteTap(cb) {
      remoteTapCb = cb;
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
        const tg = fishTarget(walker.x, walker.z, walker.yaw);
        fishYaw = Math.atan2(tg.x - walker.x, tg.z - walker.z);
        fishRig.begin(tg.x, tg.z, tg.y);
        walker.holdSit = true;
        // 카메라를 고양이 뒤로 돌려서 찌가 화면에 보이게 한다 (그 뒤에는 손가락으로 다시 돌릴 수 있다)
        fishCamTurn = 1.2;
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
      snowfall.dispose();
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
