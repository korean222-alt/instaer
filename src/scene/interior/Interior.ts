import * as THREE from 'three';
import { createGlowLambert, GLOW_ATTRS, type GlowShared } from '../core/glowLambert';
import type { ItemGeometries } from '../free/catalog';
import type { DrawingStore } from '../free/drawings';
import { FreeItems } from '../free/FreeItems';
import { ROOM_HALF, roomSpace, WALL_HEIGHT, type Space } from '../free/space';
import type { PlacedItem } from '../free/types';
import { fillAttr, mergeParts, paint } from '../util/geo';

/**
 * 집 안: 방 하나(8x8)에 벽 두 면(뒤, 왼쪽)과 바닥. 위에서 비스듬히 내려다본다.
 * 섬과는 따로 떨어진 장면이라서 들어가 있는 동안에는 섬을 그리지 않는다(한 번에 한 집만).
 * 방 가운데가 (0, 0), 바닥 높이가 0 이다.
 */
/** 카메라가 방을 보는 방향 (0이면 정면. 조금 오른쪽에서 봐서 왼쪽 벽이 보인다) */
export const ROOM_CAM_YAW = 0.34;
const CAM_PITCH = THREE.MathUtils.degToRad(40);
export const ROOM_FOV = 38;
/** 문(앞쪽 가운데)의 절반 폭과, 문턱이 방 밖으로 나간 길이 */
export const DOOR_HALF = 0.8;
export const DOOR_STEP = 0.7;

/** 걷기에 쓰는 방 크기 (Walker.room). 방 크기가 바뀌면 (집 넓히기) 값이 바뀐다 */
export const ROOM_WALK = {
  minX: -ROOM_HALF + 0.12,
  maxX: ROOM_HALF - 0.12,
  minZ: -ROOM_HALF + 0.12,
  maxZ: ROOM_HALF - 0.1,
  y: 0,
  doorHalf: DOOR_HALF,
  doorZ: ROOM_HALF + DOOR_STEP,
};
/** 들어왔을 때 서는 자리 */
export const ROOM_START = { x: 0, z: ROOM_HALF - 1.1 };
/** 이 선을 넘어 문턱으로 나가면 "문으로 나갔다" (exitZ) */
export const ROOM_EXIT = { z: ROOM_HALF + 0.28 };
function setRoomWalk(half: number) {
  Object.assign(ROOM_WALK, { minX: -half + 0.12, maxX: half - 0.12, minZ: -half + 0.12, maxZ: half - 0.1, doorZ: half + DOOR_STEP });
  ROOM_START.z = half - 1.1;
  ROOM_EXIT.z = half + 0.28;
}

const FLOOR_STYLES = ['wood', 'tile', 'carpet'] as const;
const WALL_STYLES = ['cream', 'stripe', 'dots'] as const;
/** 벽지와 바닥에 쓸 수 있는 기본 무늬 이름 (그 밖에 '#rrggbb' 색, 'drawing:그림id' 도 된다) */
export const ROOM_STYLES = { floor: FLOOR_STYLES, wallpaper: WALL_STYLES } as const;

function pattern(kind: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const fill = (color: string, x: number, y: number, w: number, h: number) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  if (kind === 'wood') {
    // 마루: 널빤지 네 줄, 이음매를 엇갈리게
    const tones = ['#e2b98a', '#d9ad7c', '#e6c094', '#dcb283'];
    for (let i = 0; i < 4; i++) {
      fill(tones[i], 0, i * 16, 64, 16);
      fill('#c79a6c', 0, i * 16, 64, 1);
      fill('#c79a6c', (i * 23 + 9) % 64, i * 16, 1, 16);
    }
  } else if (kind === 'tile') {
    fill('#f3ece0', 0, 0, 64, 64);
    fill('#cfe6e0', 0, 0, 32, 32);
    fill('#cfe6e0', 32, 32, 32, 32);
  } else if (kind === 'carpet') {
    fill('#f2c9c0', 0, 0, 64, 64);
    for (let i = 0; i < 90; i++) fill(i % 2 ? '#f6d6ce' : '#ecbcb2', (i * 37) % 64, (i * 53) % 64, 2, 2);
  } else if (kind === 'stripe') {
    fill('#fbefdc', 0, 0, 64, 64);
    for (let x = 0; x < 64; x += 16) fill('#f6dcc0', x, 0, 8, 64);
  } else if (kind === 'dots') {
    fill('#f4ecf7', 0, 0, 64, 64);
    g.fillStyle = '#e0cfee';
    for (const [x, y] of [[16, 16], [48, 48]]) {
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
  } else fill('#fbefdc', 0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export class Interior {
  readonly scene = new THREE.Scene();
  readonly free: FreeItems;
  space: Space = roomSpace(0);
  /** 방에 놓인 아이템 (끌어 놓기가 이 배열을 직접 고친다) */
  list: PlacedItem[] = [];

  private readonly hemi = new THREE.HemisphereLight('#fff6e8', '#e8cfae', 1.5);
  private readonly lamp = new THREE.DirectionalLight('#fff0d6', 2.0);
  private readonly shellMat: THREE.MeshLambertMaterial;
  private readonly floorMat = new THREE.MeshLambertMaterial();
  private readonly wallMat = new THREE.MeshLambertMaterial();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly patterns = new Map<string, THREE.CanvasTexture>();
  private wallpaper = 'cream';
  private floor = 'wood';
  private readonly focus = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(Math.sin(ROOM_CAM_YAW) * Math.cos(CAM_PITCH), Math.sin(CAM_PITCH), Math.cos(ROOM_CAM_YAW) * Math.cos(CAM_PITCH));
  private zoom = 1;
  private half = 0;
  private readonly c = new THREE.Color();

  constructor(
    private readonly shared: GlowShared,
    geometries: ItemGeometries,
    private readonly drawings: DrawingStore,
  ) {
    this.scene.background = new THREE.Color('#2b2433');
    this.shellMat = createGlowLambert(shared, { instanced: false });

    // 빛: 방 앞 오른쪽 위에서 비춘다 (그림자가 뒤 왼쪽으로 진다)
    this.lamp.position.set(5, 11, 7);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.bias = -0.0008;
    this.lamp.shadow.normalBias = 0.03;
    const cam = this.lamp.shadow.camera;
    cam.left = cam.bottom = -9.5;
    cam.right = cam.top = 9.5;
    cam.near = 1;
    cam.far = 30;
    this.scene.add(this.hemi, this.lamp, this.lamp.target);

    this.build(ROOM_HALF);

    this.free = new FreeItems(shared, geometries, drawings);
    this.scene.add(this.free.group);
    this.applyStyle();
  }

  /** 방 뼈대(바닥, 벽, 문턱)를 그 크기로 만든다 */
  private build(half: number) {
    this.half = half;
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes.length = 0;
    const H = half;
    const ROOM_SIZE = half * 2;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      this.meshes.push(mesh);
      this.scene.add(mesh);
      return mesh;
    };
    // 바닥과 벽면 (무늬가 바뀌는 면)
    add(new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE).rotateX(-Math.PI / 2), this.floorMat);
    add(new THREE.PlaneGeometry(ROOM_SIZE, WALL_HEIGHT).translate(0, WALL_HEIGHT / 2, -H), this.wallMat);
    add(new THREE.PlaneGeometry(ROOM_SIZE, WALL_HEIGHT).rotateY(Math.PI / 2).translate(-H, WALL_HEIGHT / 2, 0), this.wallMat);

    // 나머지 뼈대: 바닥 두께, 벽 두께, 굽도리, 문턱과 발판
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => {
      const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
      paint(g, color);
      fillAttr(g, 'aMask', [0, 0]);
      return g;
    };
    const T = 0.24;
    const shell = mergeParts(
      [
        part(ROOM_SIZE + T, 0.5, ROOM_SIZE + T, -T / 2, -0.252, -T / 2, '#b98a66'),
        part(ROOM_SIZE + T, WALL_HEIGHT + 0.06, T, -T / 2, WALL_HEIGHT / 2 + 0.03, -H - T / 2 - 0.002, '#f1e2cc'),
        part(T, WALL_HEIGHT + 0.06, ROOM_SIZE, -H - T / 2 - 0.002, WALL_HEIGHT / 2 + 0.03, 0, '#ecdcc4'),
        part(ROOM_SIZE, 0.16, 0.05, 0, 0.08, -H + 0.025, '#fffdf6'),
        part(0.05, 0.16, ROOM_SIZE, -H + 0.025, 0.08, 0, '#fffdf6'),
        // 문턱 (방 앞으로 조금 나온 발판)
        part(DOOR_HALF * 2 + 0.3, 0.5, DOOR_STEP, 0, -0.252, H + DOOR_STEP / 2, '#a2734c'),
        // 발판 매트
        part(1.3, 0.03, 0.7, 0, 0.015, H - 0.5, '#8fd3e8'),
        part(1.06, 0.034, 0.46, 0, 0.017, H - 0.5, '#fff6ea'),
        // 문 기둥
        part(0.14, 1.0, 0.14, -DOOR_HALF - 0.08, 0.5, H + DOOR_STEP - 0.07, '#c99766'),
        part(0.14, 1.0, 0.14, DOOR_HALF + 0.08, 0.5, H + DOOR_STEP - 0.07, '#c99766'),
      ],
      GLOW_ATTRS,
    );
    add(shell, this.shellMat, true);

    this.applyStyle();
  }

  /** 집에 들어간다: 방을 그 집 것으로 채운다. half: 방 한 변의 절반 (기본 4, 넓힌 집 5.5) */
  open(houseNo: number, items: readonly PlacedItem[], wallpaper?: string, floor?: string, half = ROOM_HALF) {
    if (half !== this.half) this.build(half);
    setRoomWalk(half);
    this.space = roomSpace(houseNo, half);
    this.wallpaper = wallpaper || 'cream';
    this.floor = floor || 'wood';
    this.applyStyle();
    this.setItems(items);
    this.focus.set(0, 0.8, 0.4);
    this.zoom = 0.86;
  }

  /** 지금 방 한 변의 절반 */
  get roomHalf() {
    return this.half;
  }

  /** 이미 들어와 있는 집의 벽지/바닥만 바꾼다 */
  restyle(wallpaper?: string, floor?: string) {
    this.wallpaper = wallpaper || 'cream';
    this.floor = floor || 'wood';
    this.applyStyle();
  }

  setItems(items: readonly PlacedItem[]) {
    this.list = items.filter((it) => it && typeof it.id === 'string' && typeof it.type === 'string').map((it) => ({ ...it }));
    this.redraw(null);
  }

  redraw(skipId: string | null) {
    this.free.set([{ space: this.space, items: this.list }], skipId);
  }

  /** 그림 목록이 바뀌었을 때 */
  refreshDrawings() {
    this.applyStyle();
    this.free.refresh();
  }

  setShadows(on: boolean) {
    this.lamp.castShadow = on;
  }

  /** 카메라: 방 전체가 대체로 보이는 거리에서 내 고양이 쪽으로 살짝 따라간다 */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number, catX: number, catZ: number) {
    const k = 1 - Math.exp(-dt * 4);
    this.focus.x += (catX * 0.22 - this.focus.x) * k;
    this.focus.z += (catZ * 0.22 + 0.2 - this.focus.z) * k;
    this.zoom += (1 - this.zoom) * (1 - Math.exp(-dt * 3));
    const tanV = Math.tan(THREE.MathUtils.degToRad(ROOM_FOV) / 2);
    const tanH = tanV * camera.aspect;
    // 세로 화면은 가로 폭에, 가로 화면은 높이에 맞춘다
    const k2 = this.half / ROOM_HALF;
    const dist = THREE.MathUtils.clamp(Math.max((5.3 * k2) / tanH, (4.5 * k2) / tanV), 12, 52) * this.zoom;
    camera.position.copy(this.focus).addScaledVector(this.dir, dist);
    camera.lookAt(this.focus);
    if (camera.fov !== ROOM_FOV || camera.near !== 1) {
      camera.fov = ROOM_FOV;
      camera.near = 1;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  /** 밤에는 조금 어둡고 따뜻한 빛으로 */
  update() {
    const n = this.shared.uNight.value;
    this.hemi.intensity = 1.5 - 0.55 * n;
    this.lamp.intensity = 2.0 - 1.1 * n;
    this.lamp.color.set('#fff0d6').lerp(this.c.set('#ffc98a'), n);
  }

  dispose() {
    this.free.dispose();
    for (const m of this.meshes) m.geometry.dispose();
    for (const t of this.patterns.values()) t.dispose();
    this.shellMat.dispose();
    this.floorMat.dispose();
    this.wallMat.dispose();
    this.lamp.shadow.map?.dispose();
  }

  /** 벽지/바닥 값 → 재질. 기본 무늬 이름, '#rrggbb' 색, 'drawing:그림id' 중 하나 */
  private applyStyle() {
    const apply = (mat: THREE.MeshLambertMaterial, value: string, fallback: string, known: readonly string[], rx: number, ry: number, tile: number) => {
      let map: THREE.Texture | null = null;
      mat.color.set('#ffffff');
      if (/^#[0-9a-f]{6}$/i.test(value)) mat.color.set(value);
      else if (value.startsWith('drawing:')) {
        map = this.drawings.tiled(value.slice(8), fallback);
        if (map) map.repeat.set(rx, ry);
      }
      if (!map && !/^#[0-9a-f]{6}$/i.test(value)) {
        const name = known.includes(value) ? value : fallback;
        let t = this.patterns.get(name);
        if (!t) this.patterns.set(name, (t = pattern(name)));
        t.repeat.set(rx / tile, ry / tile);
        map = t;
      }
      if (mat.map !== map) {
        mat.map = map;
        mat.needsUpdate = true;
      }
    };
    const size = this.half * 2;
    apply(this.floorMat, this.floor, 'wood', FLOOR_STYLES, size, size, 2);
    apply(this.wallMat, this.wallpaper, 'cream', WALL_STYLES, size, WALL_HEIGHT, 1);
  }
}
