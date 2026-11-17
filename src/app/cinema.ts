// 촬영 모드 (2026-11-17, 2차): 인스타 릴스용 영상을 폰 화면 기록으로 바로 찍게 한다.
// - 주소에 ?cinema 를 붙이면 켜진다 (설정 화면의 "촬영 모드" 버튼).
// - 진짜 게임 화면 그대로: 버튼/글자/자막을 모두 숨기고 카메라만 영화처럼 움직인다.
//   자막과 목소리는 편집 앱에서 넣는다 (사용자 2026-11-17: "실제 게임 화면에서 UI 없애고 카메라 무빙만").
// - 촬영 중에는 화질을 최고 단계로 고정한다 (자동으로 낮추지 않음, 선택하면 해상도 3배).
// - 장면(컷)을 하나씩 찍거나 전체를 이어서 찍을 수 있다. 컷 사이에는 짧게 검게 넘어간다.
// 씬은 setCinemaCamera / setNameTags / setCinemaQuality / setTimeOfDay 로만 다룬다.
import { dockArea, GROUND_Y, houseSlot, neighborhoodArea, townSquares, type CinemaCamera, type IslandScene } from '../scene';
import { NEIGHBORHOOD_SIZE } from '../shared/config';
import type { House } from '../shared/types';
import { unlockSound } from './audio/sound';
import { state } from './state';

export const cinemaRequested = () => new URLSearchParams(location.search).has('cinema');

/** 카메라 자세: 바라보는 곳 + 방향(yaw) + 내려다보는 각(pitch) + 거리 + 화각 */
interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
}

interface Shot {
  id: string;
  label: string;
  dur: number;
  night?: boolean;
  /** u: 0~1 (이 컷 안에서 얼마나 지났는지, 부드럽게 굴린 값) */
  pose: (u: number) => Pose;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 천천히 출발해서 천천히 멈춘다. 영화 카메라처럼 끝까지 아주 조금은 움직이게 직선과 섞는다 */
const glide = (t: number) => {
  const x = clamp01(t);
  const s = x * x * x * (x * (x * 6 - 15) + 10);
  return s * 0.75 + x * 0.25;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 거리는 비율로 바꿔야 멀어질 때와 가까워질 때 속도가 고르다 */
const lerpDist = (a: number, b: number, t: number) => a * Math.pow(b / a, t);

function toCamera(p: Pose, time: number): CinemaCamera {
  // 손으로 든 카메라처럼 아주 살짝 흔들린다 (거리에 비례, 아주 느리게)
  const s = p.dist * 0.0025;
  const lx = p.x + Math.sin(time * 0.53) * s + Math.sin(time * 1.31) * s * 0.35;
  const ly = p.y + Math.sin(time * 0.67 + 1.3) * s * 0.5;
  const lz = p.z + Math.cos(time * 0.47 + 0.4) * s;
  const cp = Math.cos(p.pitch);
  return {
    x: lx + Math.sin(p.yaw) * cp * p.dist,
    y: ly + Math.sin(p.pitch) * p.dist,
    z: lz + Math.cos(p.yaw) * cp * p.dist,
    lookX: lx,
    lookY: ly,
    lookZ: lz,
    fov: p.fov,
  };
}

/** 이 섬에 맞는 컷들을 만든다 (주인공 집 = 내 집, 없으면 예뻐요를 가장 많이 받은 고양이 집) */
function buildShots(): Shot[] {
  const G = GROUND_Y;
  const lived = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle);
  const mine = state.me ? lived.find((h) => h.houseNo === state.me!.houseNo) : undefined;
  const hero: House | undefined = mine ?? [...lived].sort((a, b) => (b.cat ? 1 : 0) - (a.cat ? 1 : 0) || b.likes - a.likes || a.houseNo - b.houseNo)[0];
  const heroNo = hero?.houseNo ?? 1;
  const hs = houseSlot(heroNo);
  const nb = neighborhoodArea(hs.neighborhood);
  const fx = Math.sin(hs.rot);
  const fz = Math.cos(hs.rot);

  // 옆집: 같은 동네에서 번호가 이웃한 집
  const base = Math.floor((heroNo - 1) / NEIGHBORHOOD_SIZE) * NEIGHBORHOOD_SIZE;
  const nextNo = base + (((heroNo - base) % NEIGHBORHOOD_SIZE) + 1);
  const prevNo = base + (((heroNo - base - 2 + NEIGHBORHOOD_SIZE) % NEIGHBORHOOD_SIZE) + 1);
  const a = houseSlot(prevNo);
  const b = houseSlot(nextNo);
  // 골목 컷: 동네 바깥쪽에서 안쪽(연못/광장)을 보며 옆으로 미끄러진다
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const outYaw = Math.atan2(mx - nb.x, mz - nb.z);
  const heroAng = Math.atan2(hs.x - nb.x, hs.z - nb.z);
  const ringR = Math.hypot(hs.x - nb.x, hs.z - nb.z);

  // 섬 전체: 입주한 집이 있는 곳 가운데
  let cx = 0;
  let cz = 0;
  const spread = lived.length ? lived : [{ houseNo: 1 } as House];
  for (const h of spread) {
    const s = houseSlot(h.houseNo);
    cx += s.x / spread.length;
    cz += s.z / spread.length;
  }

  const square = townSquares(state.unlockedZones).find((t) => t.zone === hs.zone) ?? townSquares(1)[0];
  const dock = dockArea();
  const dockDir = Math.sign(dock.z1 - dock.z0) || 1;

  return [
    {
      id: 'cat',
      label: '🐱 우리 집 고양이',
      dur: 6,
      // 마당 문 앞에서 낮게 다가가며 살짝 돈다
      pose: (u) => ({
        x: hs.x + fx * 0.6,
        y: G + 0.55,
        z: hs.z + fz * 0.6,
        yaw: hs.rot - 0.6 + 0.5 * u,
        pitch: lerp(0.2, 0.32, u),
        dist: lerpDist(19, 12.5, u),
        fov: 36,
      }),
    },
    {
      id: 'alley',
      label: '🏡 골목 지나가기',
      dur: 5.5,
      // 고양이 눈높이에서 집들 앞을 옆으로 미끄러진다. 집들이 둥글게 놓여 있어서 동네 가운데를 중심으로 호를 그리고,
      // 카메라는 안쪽(연못/광장 쪽)에서 집 문을 본다
      pose: (u) => {
        const th = heroAng + lerp(-0.42, 0.42, u);
        const r = ringR - 4.5;
        return {
          x: nb.x + Math.sin(th) * r,
          y: G + 1.6,
          z: nb.z + Math.cos(th) * r,
          yaw: th + Math.PI,
          pitch: 0.1,
          dist: Math.max(6, Math.min(10, ringR - 7)),
          fov: 40,
        };
      },
    },
    {
      id: 'crane',
      label: '🎈 동네 위로 올라가기',
      dur: 6,
      // 동네 가운데(연못/광장/큰 나무) 앞 땅에서 하늘로
      pose: (u) => ({
        x: nb.x,
        y: lerp(G + 1.2, G, u),
        z: nb.z,
        yaw: outYaw + 0.5 + 0.8 * u,
        pitch: lerp(0.1, 0.78, u),
        dist: lerpDist(17, 72, u),
        fov: 36,
      }),
    },
    {
      id: 'square',
      label: '🎄 마을 광장',
      dur: 6,
      pose: (u) => ({
        x: square.x,
        y: G + 1.6,
        z: square.z,
        yaw: 0.2 + 1.2 * u,
        pitch: lerp(0.26, 0.36, u),
        dist: lerpDist(30, 22, u),
        fov: 36,
      }),
    },
    {
      id: 'pier',
      label: '🎣 바닷가 부두',
      dur: 5,
      // 땅 쪽 뒤에서 부두 끝을 향해 따라간다
      pose: (u) => ({
        x: dock.x,
        y: G + 0.6,
        z: lerp(dock.z0, dock.z1, lerp(0.15, 0.75, u)),
        yaw: (dockDir > 0 ? Math.PI : 0) + lerp(0.7, 0.35, u),
        pitch: lerp(0.3, 0.22, u),
        dist: 20,
        fov: 36,
      }),
    },
    {
      id: 'night',
      label: '🌙 밤이 오는 동네',
      dur: 7,
      night: true,
      pose: (u) => ({
        x: nb.x,
        y: G,
        z: nb.z,
        yaw: outYaw + 2.1 + 0.45 * u,
        pitch: lerp(0.5, 0.42, u),
        dist: lerpDist(60, 38, u),
        fov: 36,
      }),
    },
    {
      id: 'island',
      label: '🏝️ 섬 전체',
      dur: 7,
      // 230 보다 멀면 집이 동네 색 동그라미로 합쳐진다. 그 안에서 멈춘다
      pose: (u) => ({
        x: lerp(nb.x, cx, u),
        y: G,
        z: lerp(nb.z, cz, u),
        yaw: outYaw + 2.55 + 0.5 * u,
        pitch: lerp(0.5, 0.9, u),
        dist: lerpDist(45, 215, u),
        fov: 38,
      }),
    },
  ];
}

const FADE = 0.45;

export function startCinema(scene: IslandScene) {
  document.body.classList.add('cinema-mode');
  scene.highlightHouse(null);
  scene.highlightRegion(null);
  const shots = buildShots();

  const root = document.createElement('div');
  root.id = 'cinema';
  root.innerHTML = `
    <div class="cine-black"></div>
    <div class="cine-panel">
      <h2>🎬 촬영 모드</h2>
      <p class="cine-lead">진짜 게임 화면에 카메라만 움직여요. 폰의 <b>화면 기록</b>을 켜고 고르세요.</p>
      <button class="cine-go cine-all">▶ 전체 이어서 찍기 <small>약 ${Math.round(shots.reduce((s, x) => s + x.dur, 0))}초</small></button>
      <div class="cine-shots">
        ${shots.map((s, i) => `<button class="cine-shot" data-i="${i}">${s.label}</button>`).join('')}
      </div>
      <label class="cine-opt"><input type="checkbox" data-o="tags" checked /> 집 이름표 보이기</label>
      <label class="cine-opt"><input type="checkbox" data-o="max" checked /> 아주 선명하게 <small>(끊기면 끄세요)</small></label>
      <div class="cine-btns">
        <a class="cine-exit" href="./">나가기</a>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const panel = $('.cine-panel');
  const black = $('.cine-black');

  let playlist: Shot[] = [];
  let t0 = 0;
  let playing = false;
  let shotIndex = -1;
  let idleAt = performance.now();

  const setBlack = (v: number) => {
    black.style.opacity = String(clamp01(v));
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (!playing) {
      // 기다리는 동안: 섬 전체 컷을 아주 천천히 돌려 둔다 (패널 뒤로 보인다)
      const idle = shots[shots.length - 1];
      scene.setCinemaCamera(toCamera(idle.pose(0.35 + Math.sin((now - idleAt) / 9000) * 0.1), now / 1000));
      return;
    }
    // 검은 화면으로 시작 (녹화 앞부분을 잘라 내기 쉽게)
    let t = (now - t0) / 1000;
    if (t < 0) {
      setBlack(1);
      return;
    }
    let i = 0;
    while (i < playlist.length && t >= playlist[i].dur) {
      t -= playlist[i].dur;
      i++;
    }
    if (i >= playlist.length) {
      // 끝: 검게 두었다가 패널을 다시 보인다
      setBlack(1);
      if (t > 0.9) stop();
      return;
    }
    const shot = playlist[i];
    if (i !== shotIndex) {
      shotIndex = i;
      // 밤 컷이 시작되면 해가 진다 (1.4초 동안). 낮 컷은 낮으로 (컷 사이 검은 동안 바뀐다)
      scene.setTimeOfDay(shot.night || (i > 0 && playlist[i - 1].night && shot.id === 'island') ? 'night' : 'day');
    }
    scene.setCinemaCamera(toCamera(shot.pose(glide(t / shot.dur)), now / 1000));
    // 컷 사이: 앞뒤로 살짝 검게
    const fadeIn = clamp01(t / FADE);
    const fadeOut = clamp01((shot.dur - t) / FADE);
    setBlack(1 - Math.min(fadeIn, fadeOut));
  };

  const play = (list: Shot[]) => {
    void unlockSound();
    const max = ($('[data-o="max"]') as HTMLInputElement).checked;
    scene.setCinemaQuality(max ? 'max' : 'high');
    scene.setNameTags(($('[data-o="tags"]') as HTMLInputElement).checked);
    scene.setTimeOfDay(list[0].night ? 'night' : 'day');
    playlist = list;
    shotIndex = -1;
    panel.hidden = true;
    setBlack(1);
    // 검은 화면 1.5초 (해 지는 중이던 하늘이 돌아오고, 고화질 그림자가 준비될 시간)
    t0 = performance.now() + 1500;
    playing = true;
  };

  const stop = () => {
    playing = false;
    idleAt = performance.now();
    panel.hidden = false;
    setBlack(0);
    scene.setTimeOfDay('day');
  };

  $('.cine-all').addEventListener('click', () => play(shots));
  root.querySelectorAll<HTMLButtonElement>('.cine-shot').forEach((btn) => {
    btn.addEventListener('click', () => play([shots[Number(btn.dataset.i)]]));
  });

  scene.setNameTags(true);
  requestAnimationFrame(frame);
}
