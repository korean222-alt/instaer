// 씬 데모: 고양이 한 마리 + 작은 섬 하나.
// "귀여운가?"를 눈으로 확인하기 위한 화면이라 버튼 몇 개만 붙였다. (정식 화면 UI는 앱 쪽 작업)
import * as THREE from 'three';
import { FOUNDER_MAX } from '../../shared/config';
import type { CatPattern } from '../../shared/types';
import { CatBrain } from '../cat/catBrain';
import { CatFlock } from '../cat/CatFlock';
import { createProceduralCatModel } from '../cat/catModel';
import { Atmosphere } from '../core/atmosphere';
import { CameraRig } from '../core/cameraRig';
import { createGlowLambert, GLOW_ATTRS } from '../core/glowLambert';
import { createLabelSprite, fitLabel } from '../core/labels';
import { HouseField } from '../house/HouseField';
import { HOUSE_DIM } from '../house/houseGeometry';
import { mergeParts } from '../util/geo';
import { hash01, mulberry32 } from '../util/rand';
import { GROUND_Y, HOUSE_OFFSET_Z, YARD_WORLD } from '../world/constants';
import { createNoiseTexture, MapField } from '../world/mapField';
import { Fireflies, GlowPools, type Pool } from '../world/nightFx';
import * as props from '../world/props';
import { createSea } from '../world/sea';
import { buildTerrainGeometry, createTerrainMaterial } from '../world/terrain';
import { DEMO_HOUSES, DEMO_MAP, DEMO_SLOTS, DOCK, PLAZA } from './demoIsland';

const CAT_SCALE = 1.12;
const params = new URLSearchParams(location.search);

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 2, 900);
const atmosphere = new Atmosphere(scene, 2048);
atmosphere.setShadowArea(0, 1, 27);
scene.background = atmosphere.horizon;

// ── 땅과 바다 ──
const map = new MapField(DEMO_MAP);
const noise = createNoiseTexture();
const terrain = new THREE.Mesh(buildTerrainGeometry(map, 0.5), createTerrainMaterial(map, noise, atmosphere));
terrain.receiveShadow = true;
scene.add(terrain);
const sea = createSea(map, noise, atmosphere);
scene.add(sea.mesh);

// ── 집과 마당 ──
const houses = new HouseField(atmosphere.shared, DEMO_SLOTS.length);
houses.set(
  DEMO_SLOTS.map((slot, i) => {
    const h = DEMO_HOUSES[i];
    return { x: slot.x, z: slot.z, roofColor: h.roofColor, faded: h.isNpc || !h.igHandle, lit: h.isNpc ? 0.35 : 1 };
  }),
);
scene.add(houses.group);

// ── 장식: 전부 한 덩어리로 합쳐서 한 번에 그린다 ──
const decorMaterial = createGlowLambert(atmosphere.shared, { instanced: false });
const pools: Pool[] = [];
const fireflySpots: Array<[number, number, number]> = [];
{
  const pieces: THREE.BufferGeometry[] = [];
  const add = (list: THREE.BufferGeometry[], x: number, z: number, rot = 0, scale = 1) =>
    pieces.push(...props.place(list, x, GROUND_Y, z, rot, scale));

  add(props.plazaTree(), PLAZA.x, PLAZA.z);

  // 등불: 길목마다
  const lanterns: Array<[number, number]> = [
    [1.4, 8.6],
    [-1.4, 12.2],
    [1.4, -2.2],
    [-7.4, 4.3],
    [7.4, 4.3],
    [4.6, -4.2],
    [-4.6, -4.2],
  ];
  for (const [x, z] of lanterns) {
    add(props.lantern(), x, z);
    pools.push({ x, y: GROUND_Y + 0.05, z, sx: 5.2, sz: 5.2 });
  }

  // 나무, 덤불, 꽃, 바위: 마당/길/광장을 피해서 흩뿌린다
  const rnd = mulberry32(2026);
  const isFree = (x: number, z: number, margin: number) => {
    if (map.landAt(x, z) < 3.2 + margin) return false;
    if (map.pathAt(x, z) > -0.5 - margin) return false;
    if (map.plazaAt(x, z) > -0.9 - margin) return false;
    for (const s of DEMO_SLOTS) {
      if (Math.abs(x - s.x) < YARD_WORLD / 2 + 0.5 + margin && Math.abs(z - s.z) < YARD_WORLD / 2 + 0.5 + margin) return false;
    }
    return true;
  };
  // 키 큰 나무는 집 앞쪽(카메라가 들어오는 길)에는 심지 않는다. 가까이 볼 때 화면을 가리기 때문
  const blocksView = (x: number, z: number) =>
    DEMO_SLOTS.some((s) => Math.abs(x - s.x) < 4.2 && z > s.z - 1 && z < s.z + 14);
  const scatter = (
    count: number,
    margin: number,
    minGap: number,
    make: (seed: number) => props.Pieces,
    scale: [number, number],
    tall = false,
  ) => {
    const placed: Array<[number, number]> = [];
    let tries = 0;
    while (placed.length < count && tries++ < 4000) {
      const x = (rnd() - 0.5) * 44;
      const z = (rnd() - 0.5) * 44 - 1;
      if (!isFree(x, z, margin)) continue;
      if (tall && blocksView(x, z)) continue;
      if (taken.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + minGap)) continue;
      placed.push([x, z]);
      taken.push([x, z, minGap]);
      add(make(Math.floor(rnd() * 1e6)), x, z, rnd() * Math.PI * 2, scale[0] + rnd() * (scale[1] - scale[0]));
    }
    return placed;
  };
  const taken: Array<[number, number, number]> = [];
  scatter(7, 0.7, 1.6, props.roundTree, [1.0, 1.35], true);
  scatter(5, 0.6, 1.4, props.coneTree, [0.95, 1.25], true);
  scatter(12, 0.1, 0.8, props.bush, [0.9, 1.3]);
  scatter(6, 0.0, 0.7, props.rock, [0.7, 1.1]);
  const flowerSpots = scatter(34, -0.2, 0.35, props.flowers, [0.9, 1.25]);
  flowerSpots.slice(0, 22).forEach(([x, z], i) => fireflySpots.push([x, GROUND_Y + 0.7 + (i % 5) * 0.28, z]));
  // 모래밭의 바위 몇 개
  for (const [x, z] of [
    [-6.2, 15.2],
    [5.4, 16.4],
    [-17.4, 6.5],
    [17.9, -6.2],
  ] as Array<[number, number]>) {
    pieces.push(...props.place(props.rock(Math.floor(rnd() * 1e6)), x, map.heightAt(x, z) - 0.04, z, rnd() * 6, 0.9));
  }

  // 항구
  const deckY = 0.5;
  pieces.push(...props.place(props.dock(DOCK.length, deckY), DOCK.x, 0, DOCK.z));

  const decor = new THREE.Mesh(mergeParts(pieces, GLOW_ATTRS), decorMaterial);
  decor.castShadow = true;
  decor.receiveShadow = true;
  scene.add(decor);
}

// 배: 물결 따라 흔들린다
const boat = new THREE.Mesh(mergeParts(props.boat(), GLOW_ATTRS), decorMaterial);
boat.castShadow = true;
boat.position.set(DOCK.x + 2.9, 0, DOCK.z + 3.7);
boat.rotation.y = 0.25;
scene.add(boat);

// ── 밤 효과 ──
for (let i = 0; i < DEMO_SLOTS.length; i++) {
  const s = DEMO_SLOTS[i];
  if (DEMO_HOUSES[i].isNpc) continue;
  pools.push({ x: s.x, y: GROUND_Y + 0.07, z: s.z + HOUSE_OFFSET_Z + HOUSE_DIM.depth / 2 + 1.1, sx: 5.4, sz: 3.6 });
}
const glowPools = new GlowPools(pools.length);
glowPools.set(pools);
scene.add(glowPools.mesh);
const fireflies = new Fireflies(fireflySpots, atmosphere.shared);
scene.add(fireflies.points);

// ── 고양이 ──
const catModel = createProceduralCatModel(atmosphere.shared);
const flock = new CatFlock(catModel, 16);
scene.add(flock.mesh);

interface DemoCat {
  slot: number;
  brain: CatBrain;
  /** 마당 가운데 (세계 좌표) */
  ox: number;
  oz: number;
  y: number;
}
const cats: DemoCat[] = [];
DEMO_SLOTS.forEach((slot, i) => {
  const house = DEMO_HOUSES[i];
  if (!house.cat) return;
  const seed = hash01(house.houseNo, 99);
  flock.setLook(i, house.cat, seed);
  // 집 앞 잔디밭 안에서만 돌아다닌다
  const brain = new CatBrain({ minX: -2.2, maxX: 2.2, minZ: 0.7, maxZ: 2.45 }, house.houseNo);
  cats.push({ slot: i, brain, ox: slot.x, oz: slot.z, y: GROUND_Y + 0.035 });
});
// 부두 끝에서 낮잠 자는 동네 고양이
{
  const i = cats.length;
  flock.setLook(i, { fur: '#34313a', pattern: 'black', eyeColor: '#f2c94c' }, 0.31);
  const brain = new CatBrain({ minX: -0.55, maxX: 0.55, minZ: 0.6, maxZ: DOCK.length - 0.7 }, 77);
  brain.x = 0.2;
  brain.z = DOCK.length - 1.1;
  brain.setSleeping(true);
  cats.push({ slot: i, brain, ox: DOCK.x, oz: DOCK.z, y: 0.5 });
}
flock.count = cats.length;
const hero = cats[0];

// ── 이름표 ──
const labels: THREE.Sprite[] = [];
DEMO_SLOTS.forEach((slot, i) => {
  const h = DEMO_HOUSES[i];
  const text = h.igHandle ? `@${h.igHandle}` : '빈 집';
  const sprite = createLabelSprite(text, { founder: !!h.igHandle && h.houseNo <= FOUNDER_MAX, muted: !h.igHandle });
  sprite.position.set(slot.x, GROUND_Y + HOUSE_DIM.labelY, slot.z + HOUSE_OFFSET_Z);
  labels.push(sprite);
  scene.add(sprite);
});

// ── 카메라 ──
const rig = new CameraRig(camera, canvas, {
  groundY: GROUND_Y,
  minDist: 10,
  maxDist: 150,
  bounds: { minX: -17, maxX: 17, minZ: -15, maxZ: 19 },
});
const overview = { x: 0, z: 2.6 };
const overviewDist = () => {
  // 섬 전체가 화면에 들어오는 거리 (세로 화면이면 폭 기준)
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const byWidth = 22.5 / Math.tan(hfov / 2);
  const byHeight = 19.5 / Math.tan(vfov / 2);
  return Math.max(byWidth, byHeight);
};

function resize() {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  rig.setLimits({ maxDist: overviewDist() * 1.12 });
  fireflies.resize(h * renderer.getPixelRatio(), camera.fov);
  viewportH = h;
}
let viewportH = innerHeight;
resize();
addEventListener('resize', resize);
// 세로 화면에서는 섬 전체를 넣으면 너무 작아지므로, 처음에는 마을 가운데를 조금 당겨서 보여준다
const portrait = () => camera.aspect < 0.8;
const startDist = () => overviewDist() * (portrait() ? 0.62 : 1);
const followDist = () => (portrait() ? 13 : 11);
rig.jumpTo(overview.x, portrait() ? -1.4 : overview.z, startDist());

// ── 탭: 고양이를 누르면 좋아한다, 집을 누르면 그 집으로 간다 ──
const toast = document.getElementById('toast');
let toastTimer = 0;
function say(text: string) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1800);
}
const catPos = new THREE.Vector3();
rig.onTap((cx, cy) => {
  const ray = rig.rayFrom(cx, cy);
  let best: DemoCat | null = null;
  let bestD = 0.62;
  for (const c of cats) {
    catPos.set(c.ox + c.brain.x, c.y + 0.45, c.oz + c.brain.z);
    const d = ray.distanceToPoint(catPos);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best) {
    best.brain.pet();
    say('냐옹 ♥');
    return;
  }
  const g = rig.groundPoint(cx, cy);
  if (!g) return;
  for (let i = 0; i < DEMO_SLOTS.length; i++) {
    const s = DEMO_SLOTS[i];
    if (Math.abs(g.x - s.x) < YARD_WORLD / 2 + 0.4 && Math.abs(g.z - (s.z - 0.6)) < YARD_WORLD / 2 + 1.2) {
      rig.flyTo(s.x, s.z + 0.4, 26);
      const h = DEMO_HOUSES[i];
      say(h.igHandle ? `${h.houseNo}번지 · @${h.igHandle}` : `${h.houseNo}번지 · 빈 집`);
      return;
    }
  }
});

// ── 데모 버튼 ──
const PATTERNS: Array<{ pattern: CatPattern; fur: string; eyeColor: string; name: string }> = [
  { pattern: 'cheese', fur: '#f4a650', eyeColor: '#7ac36a', name: '치즈' },
  { pattern: 'calico', fur: '#f0a04b', eyeColor: '#e0a13a', name: '삼색이' },
  { pattern: 'tuxedo', fur: '#35323a', eyeColor: '#8fd16a', name: '턱시도' },
  { pattern: 'white', fur: '#fffaf2', eyeColor: '#6fb7e8', name: '흰둥이' },
  { pattern: 'gray', fur: '#a9adb8', eyeColor: '#f0b44a', name: '회색이' },
  { pattern: 'black', fur: '#34313a', eyeColor: '#f2c94c', name: '까망이' },
];
let patternIndex = 0;
let following = false;
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement | null;
const setFollow = (on: boolean) => {
  following = on;
  btn('btn-cat')?.classList.toggle('on', on);
  const b = btn('btn-cat');
  if (b) b.textContent = on ? '섬 전체 보기' : '고양이 가까이';
  if (on) say('우리 집 고양이');
  if (!on) rig.flyTo(overview.x, overview.z, overviewDist());
};
btn('btn-time')?.addEventListener('click', () => {
  const next = atmosphere.mode === 'day' ? 'night' : 'day';
  atmosphere.setMode(next);
  const b = btn('btn-time');
  if (b) b.textContent = next === 'day' ? '밤으로' : '낮으로';
});
btn('btn-cat')?.addEventListener('click', () => setFollow(!following));
btn('btn-fur')?.addEventListener('click', () => {
  patternIndex = (patternIndex + 1) % PATTERNS.length;
  const p = PATTERNS[patternIndex];
  flock.setLook(hero.slot, p, hash01(1 + patternIndex * 31, 99));
  hero.brain.pet();
  say(p.name);
});
canvas.addEventListener('pointerdown', () => {
  if (following) {
    following = false;
    btn('btn-cat')?.classList.remove('on');
    const b = btn('btn-cat');
    if (b) b.textContent = '고양이 가까이';
  }
});

// 주소에 값을 붙여서 처음 화면을 정할 수 있다 (확인용): ?time=night&view=cat&fur=2&sleep=1
if (params.get('time') === 'night') {
  atmosphere.setMode('night', true);
  const b = btn('btn-time');
  if (b) b.textContent = '낮으로';
}
if (params.get('fur')) {
  patternIndex = Number(params.get('fur')) % PATTERNS.length;
  flock.setLook(hero.slot, PATTERNS[patternIndex], hash01(1 + patternIndex * 31, 99));
}
if (params.get('sleep')) hero.brain.setSleeping(true);
if (params.get('view') === 'cat') {
  following = true;
  rig.jumpTo(hero.ox + hero.brain.x, hero.oz + hero.brain.z, Number(params.get('dist') ?? followDist()));
} else if (params.get('view') === 'house') {
  rig.jumpTo(DEMO_SLOTS[0].x, DEMO_SLOTS[0].z + 0.4, Number(params.get('dist') ?? 26));
}

// ── 매 프레임 ──
const fpsEl = document.getElementById('fps');
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  atmosphere.update(dt);
  const t = atmosphere.shared.uTime.value;

  for (const c of cats) {
    c.brain.update(dt);
    const b = c.brain;
    flock.setPose(c.slot, c.ox + b.x, c.y + b.hop, c.oz + b.z, b.yaw, CAT_SCALE);
    flock.setAnim(c.slot, b.phase, b.walk, b.sleep, b.happy);
  }

  if (following) rig.flyTo(hero.ox + hero.brain.x, hero.oz + hero.brain.z + 0.2, followDist());
  rig.update(dt);
  sea.uniforms.uFocus.value.set(rig.target.x, rig.target.z);

  boat.position.y = Math.sin(t * 1.1) * 0.05 - 0.02;
  boat.rotation.z = Math.sin(t * 0.9) * 0.045;
  boat.rotation.x = Math.sin(t * 0.7 + 1) * 0.03;

  glowPools.update(atmosphere.shared.uNight.value);
  // 이름표: 멀리서는 조금 작게, 아주 가까이서는 숨긴다(고양이 얼굴을 가리지 않게)
  const z = rig.zoomT;
  const labelScale = THREE.MathUtils.lerp(1.0, portrait() ? 0.56 : 0.72, z);
  for (const s of labels) {
    fitLabel(s, camera, viewportH, labelScale);
    s.material.opacity = THREE.MathUtils.smoothstep(z, 0.08, 0.2);
  }

  renderer.render(scene, camera);

  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    if (fpsEl) fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps`;
    fpsAcc = 0;
    fpsN = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 확인용: 콘솔에서 그리기 횟수와 삼각형 수를 볼 수 있다
(window as unknown as { __sceneInfo: () => unknown }).__sceneInfo = () => ({ ...renderer.info.render });
