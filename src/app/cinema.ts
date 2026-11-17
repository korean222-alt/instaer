// 촬영 모드 (2026-11-17): 인스타 릴스용 영상을 폰 화면 녹화로 바로 찍을 수 있게 한다.
// - 주소에 ?cinema 를 붙이면 켜진다 (설정 화면의 "촬영 모드" 버튼).
// - 화면의 버튼과 글자를 모두 숨기고, 카메라가 정해 둔 길을 부드럽게 움직인다.
// - 자막, 집 수 세기, 반짝임, 화면 효과(어둡게 시작, 가장자리 그늘, 번쩍임), 효과음까지 앱이 직접 낸다.
// 씬은 setCinemaCamera / setNameTags / setHouses 로만 다룬다.
import { debugProject, GROUND_Y, houseSlot, neighborhoodArea, type CinemaCamera, type IslandScene } from '../scene';
import { FOLLOW_HANDLE, ZONE_CAPACITY } from '../shared/config';
import type { House } from '../shared/types';
import { playCine, unlockSound } from './audio/sound';
import { pushHousesToScene, state } from './state';
import { withEmptyLots } from './village';

export const cinemaRequested = () => new URLSearchParams(location.search).has('cinema');

// ── 카메라 자세: 바라보는 곳 + 방향(yaw) + 내려다보는 각(pitch) + 거리 + 화각 ──
interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 천천히 출발해서 천천히 멈춘다 */
const smoother = (t: number) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function mix(a: Pose, b: Pose, t: number, swing = 0): Pose {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    // 가까운 쪽으로 돌고, swing 만큼 크게 돌아 들어간다 (가운데에서 가장 많이)
    yaw: a.yaw + wrap(b.yaw - a.yaw) * t + swing * Math.sin(Math.PI * t),
    pitch: lerp(a.pitch, b.pitch, t),
    // 거리는 비율로 바꿔야 멀어질 때와 가까워질 때 속도가 고르다
    dist: a.dist * Math.pow(b.dist / a.dist, t),
    fov: lerp(a.fov, b.fov, t),
  };
}

function toCamera(p: Pose, shake: number, time: number): CinemaCamera {
  // 손으로 든 카메라처럼 아주 살짝 흔들린다 (거리에 비례)
  const s = p.dist * 0.0035 * shake;
  const lx = p.x + Math.sin(time * 0.71) * s + Math.sin(time * 1.93) * s * 0.4;
  const ly = p.y + Math.sin(time * 0.83 + 1.3) * s * 0.6;
  const lz = p.z + Math.cos(time * 0.61 + 0.4) * s;
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

// ── 시간표 (초) ──
const T = {
  heroEnd: 5.2, // 첫 집 가까이
  riseEnd: 8.8, // 위로 올라가며 섬 전체로
  growStart: 9.3, // 집이 하나씩 생기기 시작
  growEnd: 15.4,
  overviewEnd: 17.6,
  swoopEnd: 22.0, // 동네로 휙 내려간다
  endCard: 24.6,
};

interface Opts {
  tags: boolean;
  night: boolean;
}

export function startCinema(scene: IslandScene) {
  document.body.classList.add('cinema-mode');
  const root = document.createElement('div');
  root.id = 'cinema';
  root.innerHTML = `
    <div class="cine-vignette"></div>
    <div class="cine-sparks"></div>
    <div class="cine-counter" hidden>
      <div class="cine-count"><b>1</b><span>채</span></div>
      <div class="cine-bar"><i></i></div>
      <div class="cine-bar-label"><span class="cine-from">1</span><span class="cine-goal"></span></div>
    </div>
    <div class="cine-caption"></div>
    <div class="cine-end" hidden>
      <div class="cine-end-title">고양이섬</div>
      <div class="cine-end-sub">팔로우하면 내 고양이와 집 한 채</div>
      <div class="cine-end-handle"></div>
    </div>
    <div class="cine-flash"></div>
    <div class="cine-black"></div>
    <div class="cine-panel">
      <h2>🎬 촬영 모드</h2>
      <ol>
        <li>폰의 <b>화면 기록</b>을 먼저 켜 주세요</li>
        <li>아래 <b>시작</b>을 누르면 화면이 깨끗해지고 약 25초짜리 장면이 나와요</li>
        <li>앞뒤 검은 부분만 잘라서 올리면 끝!</li>
      </ol>
      <label class="cine-opt"><input type="checkbox" data-o="tags" checked /> 집 이름표(인스타 아이디) 보이기</label>
      <label class="cine-opt"><input type="checkbox" data-o="night" /> 밤 장면으로 찍기</label>
      <p class="cine-note">소리도 같이 녹화돼요. 아이폰은 무음 스위치를 꺼 주세요.</p>
      <div class="cine-btns">
        <button class="cine-go">시작</button>
        <a class="cine-exit" href="./">나가기</a>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const panel = $('.cine-panel');
  const black = $('.cine-black');
  const flash = $('.cine-flash');
  const caption = $('.cine-caption');
  const counter = $('.cine-counter');
  const countNum = $('.cine-count b');
  const bar = $('.cine-bar i');
  const goalLabel = $('.cine-goal');
  const endCard = $('.cine-end');
  const sparks = $('.cine-sparks');
  $('.cine-end-handle').textContent = FOLLOW_HANDLE ? `@${FOLLOW_HANDLE}` : '';

  // 대기 화면: 섬 위를 천천히 돈다 (패널 뒤로 보인다)
  let running = false;
  let raf = 0;
  let t0 = 0;
  scene.setNameTags(false);

  // ── 등장인물: 첫 집(주인공)과 나머지 집 ──
  const lived = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle);
  const withCat = lived.filter((h) => h.cat);
  const mine = state.me && lived.find((h) => h.houseNo === state.me!.houseNo && h.cat);
  const hero: House | undefined = mine ?? [...withCat].sort((a, b) => b.likes - a.likes || a.houseNo - b.houseNo)[0] ?? lived[0];
  const order = lived.filter((h) => h !== hero).sort((a, b) => a.houseNo - b.houseNo);
  if (hero) order.unshift(hero);
  const total = order.length;
  const goal = Math.max(ZONE_CAPACITY, Math.ceil(Math.max(1, total) / ZONE_CAPACITY) * ZONE_CAPACITY);
  goalLabel.textContent = `${goal.toLocaleString()} · 다음 섬`;

  const heroNo = hero?.houseNo ?? 1;
  const hs = houseSlot(heroNo);
  const nb = neighborhoodArea(hs.neighborhood);
  const G = GROUND_Y;

  // 섬 전체(집이 있는 곳)를 한 화면에 담는 거리
  // 입주한 집이 있는 곳만 (없으면 1번 동네 둘레)
  const spread = lived.length ? lived.map((h) => h.houseNo) : [1, 10];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const no of spread) {
    const s = houseSlot(no);
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const overviewDist = () => {
    const aspect = innerWidth / Math.max(1, innerHeight);
    const fov = 40;
    const v = Math.tan(((fov / 2) * Math.PI) / 180);
    const halfX = (maxX - minX) / 2 + 8;
    const halfZ = (maxZ - minZ) / 2 + 8;
    const d = Math.max(halfX / (v * aspect), (halfZ * Math.sin(0.95)) / v);
    // 230 보다 멀면 집이 동네 색 동그라미로 합쳐져서 하나씩 생기는 모습이 안 보인다
    return Math.min(212, Math.max(90, d));
  };

  // 주인공 집 앞에서 보는 방향 (마당 문 쪽)
  const front = hs.rot;
  // 마지막에 동네를 보는 방향: 섬 가운데에서 동네 쪽으로 바라보게
  const endYaw = Math.atan2(nb.x - cx, nb.z - cz) || front;

  const heroPose = (t: number): Pose => ({
    x: hs.x,
    y: G + 0.6,
    z: hs.z,
    yaw: front - 0.7 + 0.5 * smoother(t / T.heroEnd),
    pitch: lerp(0.42, 0.5, t / T.heroEnd),
    dist: lerp(22, 18, smoother(t / T.heroEnd)),
    fov: 38,
  });
  const overviewPose = (t: number): Pose => ({
    x: cx,
    y: G,
    z: cz,
    yaw: front - 0.2 + (t - T.riseEnd) * 0.022,
    pitch: 0.95,
    dist: overviewDist() * (1 - (t - T.riseEnd) * 0.008),
    fov: 40,
  });
  const neighborhoodPose = (t: number): Pose => ({
    x: nb.x,
    y: G,
    z: nb.z,
    yaw: endYaw + (t - T.swoopEnd) * 0.05,
    pitch: 0.6,
    dist: Math.max(46, Math.max(nb.rx, nb.rz) * 2.3),
    fov: 36,
  });

  const poseAt = (t: number): Pose => {
    if (t < T.heroEnd) return heroPose(t);
    if (t < T.riseEnd) return mix(heroPose(t), overviewPose(t), smoother((t - T.heroEnd) / (T.riseEnd - T.heroEnd)), 0.5);
    if (t < T.overviewEnd) return overviewPose(t);
    if (t < T.swoopEnd) return mix(overviewPose(t), neighborhoodPose(t), smoother((t - T.overviewEnd) / (T.swoopEnd - T.overviewEnd)), -1.1);
    return neighborhoodPose(t);
  };

  // ── 집이 하나씩 생긴다 ──
  let shown = -1;
  let lastPush = 0;
  const showHouses = (n: number) => {
    if (n === shown) return;
    const prev = Math.max(0, shown);
    shown = n;
    scene.setHouses(withEmptyLots(order.slice(0, n), state.unlockedZones));
    const added = order.slice(prev, n);
    // 반짝임은 한 번에 몇 개만 (너무 많으면 폰이 버거워한다)
    added.slice(-4).forEach((h) => spark(h.houseNo));
  };

  const spark = (houseNo: number) => {
    if (sparks.childElementCount > 14) return;
    const s = houseSlot(houseNo);
    const p = debugProject(scene, s.x, G + 2.2, s.z);
    if (!p || p.x < -20 || p.y < -20 || p.x > innerWidth + 20 || p.y > innerHeight + 20) return;
    const el = document.createElement('i');
    el.className = 'cine-spark';
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    sparks.appendChild(el);
    setTimeout(() => el.remove(), 900);
  };

  // ── 자막 ──
  interface Cue {
    at: number;
    dur: number;
    html: string;
    sfx?: Parameters<typeof playCine>[0];
  }
  const em = (s: string) => `<em>${s}</em>`;
  const cues = (o: Opts): Cue[] => [
    { at: 0.8, dur: 2.0, html: `팔로우 ${em('한 번')}이면` },
    { at: 2.95, dur: 2.2, html: `내 ${em('고양이')}랑 ${em('집')}이 생겨요` },
    { at: T.growStart + 0.2, dur: 2.6, html: '하나, 둘…' },
    { at: T.growStart + 3.0, dur: 2.6, html: `이웃이 ${em('계속')} 늘어나요` },
    { at: T.growEnd + 0.15, dur: 2.4, html: `지금 ${em(`${total.toLocaleString()}마리`)}가 함께 살아요` },
    ...(o.tags ? [{ at: T.overviewEnd + 1.4, dur: 2.6, html: `집마다 ${em('인스타 아이디')} 이름표` }] : []),
    { at: T.swoopEnd + 0.1, dur: 2.2, html: `다음 집은 ${em('당신')} 차례` },
  ];
  let cueList: Cue[] = [];
  let cueOn = -1;
  const setCaption = (i: number) => {
    if (i === cueOn) return;
    cueOn = i;
    caption.classList.remove('on');
    if (i < 0) return;
    // 다시 넣어야 애니메이션이 처음부터 돈다
    void caption.offsetWidth;
    caption.innerHTML = cueList[i].html;
    caption.classList.add('on');
  };

  // ── 소리 신호 (한 번씩) ──
  const fired = new Set<string>();
  const once = (key: string, at: number, t: number, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };

  let lastPop = 0;
  let countShown = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!running) {
      // 대기 화면: 동네 위를 천천히 돈다
      scene.setCinemaCamera(toCamera(neighborhoodPose(T.swoopEnd + now / 1000), 1, now / 1000));
      return;
    }
    const t = (now - t0) / 1000;
    scene.setCinemaCamera(toCamera(poseAt(Math.max(0, t)), 1, t));

    // 화면 효과
    black.style.opacity = String(t < 0 ? 1 : 1 - smoother(t / 0.9));
    once('in', 0.05, t, () => playCine('whooshDown'));
    once('rise', T.heroEnd - 0.3, t, () => playCine('whoosh'));
    once('tagsOff', T.heroEnd + 0.6, t, () => scene.setNameTags(false));
    once('counter', T.riseEnd - 0.4, t, () => {
      counter.hidden = false;
      counter.classList.add('on');
    });
    once('swoop', T.overviewEnd - 0.2, t, () => playCine('whooshDown'));
    once('tagsOn', T.overviewEnd + 1.2, t, () => scene.setNameTags(opts.tags));
    once('counterOff', T.overviewEnd + 0.4, t, () => counter.classList.remove('on'));
    once('riser', T.endCard - 2.4, t, () => playCine('riser'));
    once('end', T.endCard, t, () => {
      endCard.hidden = false;
      endCard.classList.add('on');
      playCine('chime');
    });
    once('done', T.endCard + 5, t, () => {
      ended = true;
    });

    // 집 생기기: 처음엔 느리게, 갈수록 빠르게
    if (total > 0) {
      const g = clamp01((t - T.growStart) / (T.growEnd - T.growStart));
      const n = t < T.growStart ? 1 : Math.max(1, Math.round(1 + (total - 1) * g * g * g));
      // 집 다시 그리기는 1초에 8번까지만
      if (n !== shown && (now - lastPush > 125 || n === total)) {
        lastPush = now;
        showHouses(n);
      }
      if (t >= T.riseEnd - 0.4) {
        // 숫자는 매 프레임 올라가고, "뽁" 소리는 1초에 14번까지만
        const shownCount = Math.max(1, Math.round(1 + (total - 1) * g * g * g));
        if (shownCount !== countShown) {
          countShown = shownCount;
          countNum.textContent = shownCount.toLocaleString();
          bar.style.transform = `scaleX(${Math.min(1, shownCount / goal)})`;
          if (t >= T.growStart && now - lastPop > 70) {
            lastPop = now;
            playCine('pop', shownCount / Math.max(1, total));
            countNum.parentElement!.classList.remove('bump');
            void countNum.offsetWidth;
            countNum.parentElement!.classList.add('bump');
          }
        }
      }
      once('full', T.growEnd + 0.1, t, () => {
        playCine('boom');
        playCine('sparkle');
        flash.classList.remove('on');
        void flash.offsetWidth;
        flash.classList.add('on');
      });
    }

    // 자막
    let idx = -1;
    cueList.forEach((c, i) => {
      if (t >= c.at && t < c.at + c.dur) idx = i;
    });
    setCaption(idx);
  };

  let opts: Opts = { tags: true, night: false };
  let ended = false;

  const begin = () => {
    opts = {
      tags: ($('[data-o="tags"]') as HTMLInputElement).checked,
      night: ($('[data-o="night"]') as HTMLInputElement).checked,
    };
    scene.setTimeOfDay(opts.night ? 'night' : 'day');
    cueList = cues(opts);
    fired.clear();
    shown = -1;
    countShown = 0;
    ended = false;
    panel.hidden = true;
    endCard.hidden = true;
    endCard.classList.remove('on');
    counter.hidden = true;
    counter.classList.remove('on');
    countNum.textContent = '1';
    bar.style.transform = `scaleX(${1 / goal})`;
    black.style.opacity = '1';
    scene.setNameTags(opts.tags);
    showHouses(Math.min(1, total));
    // 검은 화면 1.2초 뒤에 시작 (녹화 앞부분을 잘라 내기 쉽게)
    t0 = performance.now() + 1200;
    running = true;
  };

  $('.cine-go').addEventListener('click', () => {
    void unlockSound();
    begin();
  });
  // 끝난 뒤 화면을 누르면 다시 준비 화면
  root.addEventListener('click', (e) => {
    if (!running || !ended || (e.target as HTMLElement).closest('.cine-panel')) return;
    running = false;
    panel.hidden = false;
    endCard.hidden = true;
    caption.classList.remove('on');
    black.style.opacity = '0';
    pushHousesToScene(true);
  });

  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    scene.setCinemaCamera(null);
    scene.setNameTags(true);
    root.remove();
    document.body.classList.remove('cinema-mode');
  };
}
