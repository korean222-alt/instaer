// 촬영 모드 (2026-11-17, 2차): 인스타 릴스용 영상을 폰 화면 기록으로 바로 찍게 한다.
// - 주소에 ?cinema 를 붙이면 켜진다 (설정 화면의 "촬영 모드" 버튼).
// - 진짜 게임 화면 그대로: 버튼/글자/자막을 모두 숨기고 카메라만 영화처럼 움직인다.
//   자막과 목소리는 편집 앱에서 넣는다 (사용자 2026-11-17: "실제 게임 화면에서 UI 없애고 카메라 무빙만").
// - 촬영 중에는 화질을 최고 단계로 고정한다 (자동으로 낮추지 않음, 선택하면 해상도 3배).
// - 장면(컷)을 하나씩 찍거나 전체를 이어서 찍을 수 있다. 컷 사이에는 짧게 검게 넘어간다.
// 씬은 setCinemaCamera / setNameTags / setCinemaQuality / setTimeOfDay 로만 다룬다.
import { dockArea, GROUND_Y, houseSlot, neighborhoodArea, townSquares, type CinemaCamera, type IslandScene } from '../scene';
import { FOUNDER_MAX, NEIGHBORHOOD_SIZE, REGIONS } from '../shared/config';
import type { House, RegionId } from '../shared/types';
import { loadCineVoice, playCine, playCineVoice, unlockSound, type CineSfx } from './audio/sound';
import hookVoiceUrl from './reels/hook-voice.mp3?url';
import newcomerVoiceUrl from './reels/newcomer-voice.mp3?url';
import { pushHousesToScene, state } from './state';
import { withEmptyLots } from './village';

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
  /** 이 컷 앞뒤로 검게 넘어가는 시간(초). 없으면 FADE */
  fade?: number;
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

// ── 새 주민 릴스 (2026-11-18): "오늘 새 주민이 왔어요 → 댓글에 '입주' 남기면 집 한 채" ──
// 나레이션은 ElevenLabs 로 만든 파일(src/app/reels/newcomer-voice.mp3, 목소리 Yeonhee, 이름은 말하지 않아 매일 쓸 수 있다).
// 주인공은 가장 최근에 입주한 집(/api/newcomer). 주소에 &who=닉네임 을 붙이면 그 집으로 바꾼다.
// 자막 시간은 나레이션 파일의 문장 사이 쉼(ffmpeg silencedetect)에 맞춘 값이다. 파일을 바꾸면 같이 고친다.

interface Cap {
  at: number;
  end: number;
  text: string;
}

/** 릴스 위에 뜨는 글자 카드: at~end 동안 보이고, 처음 뜰 때 효과음/동작을 한 번 한다 */
interface Overlay {
  at: number;
  end: number;
  cls: string;
  html: string;
  sfx?: CineSfx;
  /** 처음 뜰 때 할 일 (빈 집을 내 집으로 바꾸기 같은 것) */
  run?: () => void;
}

interface Reel {
  shots: Shot[];
  /** 하이라이트(별 표시)할 집 */
  heroNo: number | null;
  voice: string;
  /** 영상 시작(검은 화면 뒤 첫 컷)에서 나레이션이 시작하는 때(초) */
  voiceAt: number;
  caps: Cap[];
  overlays: Overlay[];
  /** 끝날 때 되돌릴 일 */
  cleanup?: () => void;
}

const VOICE_AT = 0.6;
/** 나레이션 파일 안에서 각 문장이 나오는 때 (초) */
const VOICE_LINES: [number, number, string][] = [
  [0.0, 2.95, '오늘 고양이섬에 새 주민이 이사 왔어요!'],
  [3.15, 6.65, '마당 있는 집 한 채랑\n귀여운 고양이 한 마리도 같이요'],
  [7.1, 10.05, '섬에는 아직\n빈 집이 많이 남아 있어요'],
  [10.43, 12.7, "댓글에 '입주'라고 남겨 주세요!"],
  [13.0, 15.1, '당신에게도 집 한 채를 드릴게요'],
];

/** 주인공 집 둘레의 위치들 (컷 카메라 계산용) */
function heroFrame(heroNo: number) {
  const hs = houseSlot(heroNo);
  const nb = neighborhoodArea(hs.neighborhood);
  return {
    hs,
    nb,
    fx: Math.sin(hs.rot),
    fz: Math.cos(hs.rot),
    heroAng: Math.atan2(hs.x - nb.x, hs.z - nb.z),
    ringR: Math.hypot(hs.x - nb.x, hs.z - nb.z),
  };
}

function buildNewcomerReel(heroNo: number, name: string, region: string): Reel {
  const G = GROUND_Y;
  const { hs, nb, fx, fz, heroAng, ringR } = heroFrame(heroNo);
  const doorX = hs.x + fx * 0.6;
  const doorZ = hs.z + fz * 0.6;
  const shots: Shot[] = [
    {
      id: 'arrive',
      label: '새 주민 집으로 내려가기',
      dur: 7.6,
      fade: 0.3,
      // 동네 높이 위에서 새 주민 집 마당 앞까지 한 번에 내려온다 (첫 문장 동안 동네, 둘째 문장에 집과 고양이)
      pose: (u) => {
        const k = clamp01(u * 1.4);
        return {
          x: lerp(nb.x, doorX, k),
          y: G + lerp(0, 0.55, u),
          z: lerp(nb.z, doorZ, k),
          yaw: hs.rot + lerp(1.3, -0.25, u),
          pitch: lerp(1.0, 0.24, u),
          dist: lerpDist(140, 12, u),
          fov: 38,
        };
      },
    },
    {
      id: 'empty',
      label: '빈 집 골목',
      dur: 3.3,
      fade: 0.25,
      // 새 주민 집 옆으로 이어지는 집들(아직 빈 집) 앞을 고양이 눈높이로 지나간다
      pose: (u) => {
        const th = heroAng + lerp(0.45, 1.15, u);
        const r = ringR - 4.5;
        return {
          x: nb.x + Math.sin(th) * r,
          y: G + 1.6,
          z: nb.z + Math.cos(th) * r,
          yaw: th + Math.PI,
          pitch: 0.12,
          dist: Math.max(6, Math.min(10, ringR - 7)),
          fov: 40,
        };
      },
    },
    {
      id: 'cta',
      label: '댓글에 입주',
      dur: 7.6,
      fade: 0.25,
      // 새 주민 집에서 동네 위로 천천히 올라간다 (마지막 카드가 떠 있는 동안)
      pose: (u) => ({
        x: lerp(doorX, (hs.x + nb.x) / 2, u),
        y: G + 0.5,
        z: lerp(doorZ, (hs.z + nb.z) / 2, u),
        yaw: hs.rot + lerp(-0.35, 0.55, u),
        pitch: lerp(0.3, 0.85, u),
        dist: lerpDist(14, 78, u),
        fov: 38,
      }),
    },
  ];
  const area = regionLabel(region);
  return {
    shots,
    heroNo,
    voice: newcomerVoiceUrl,
    voiceAt: VOICE_AT,
    caps: VOICE_LINES.map(([a, b, text]) => ({ at: VOICE_AT + a, end: VOICE_AT + b + 0.25, text })),
    overlays: [
      {
        at: VOICE_AT + 3.0,
        end: 7.6 - 0.3,
        cls: 'cine-card',
        html: `<small>오늘의 새 주민</small><b>${esc(name)}</b>${area ? `<em>${esc(area)}</em>` : ''}`,
        sfx: 'chime',
      },
      { at: VOICE_AT + 10.4, end: 99, cls: 'cine-cta', html: `댓글에 <b>'입주'</b> 남기면<br />집 한 채 드려요 🏡`, sfx: 'pop' },
    ],
  };
}

interface Newcomer {
  houseNo: number;
  handle: string;
  region: string;
}

/** 릴스 주인공: &who=닉네임 > 가장 최근 입주 (서버) > 섬에서 고른 집 */
async function findNewcomer(): Promise<Newcomer | null> {
  const lived = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle);
  const who = new URLSearchParams(location.search).get('who')?.trim().replace(/^@/, '');
  if (who) {
    const h = lived.find((x) => x.igHandle === who);
    if (h) return { houseNo: h.houseNo, handle: h.igHandle!, region: h.region };
  }
  try {
    const res = await fetch('/api/newcomer', { cache: 'no-store' });
    const data = (await res.json()) as { house: Newcomer | null };
    if (data.house) return data.house;
  } catch {
    /* 서버가 안 되면 아래 */
  }
  const h = lived.sort((a, b) => b.houseNo - a.houseNo)[0];
  return h ? { houseNo: h.houseNo, handle: h.igHandle!, region: h.region } : null;
}

const regionLabel = (id: string) => REGIONS.find((r) => r.id === id)?.label ?? '';
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ── 첫 1초 릴스 "이 빈 집, 댓글 하나면 당신 거" (2026-11-18) ──
// 조회수 200 → 처음 1초에 붙잡기: 검은 화면 없이 빈 집 + 큰 글자로 바로 시작, 빈 집이 내 집(고양이, 마당, 이름표)으로 바뀌는 장면,
// 창립 주민(처음 100명, ★) 남은 자리, "옆집 살 친구한테 보내고 댓글에 입주" (인스타는 DM 보내기를 크게 친다).
// 약 14초, 끝에서 다시 빈 집으로 돌아가 반복 재생이 자연스럽다. 나레이션 src/app/reels/hook-voice.mp3 (Yeonhee, eleven_v4).
// 단어 시간은 ElevenLabs 받아쓰기(scribe)로 잰 값이다. 파일을 바꾸면 아래 시간도 고친다.
const HOOK_VOICE_AT = 0.15;

/** 바꿔 보일 빈 집: 가장 최근 입주한 집과 같은 동네, 사는 집 바로 옆 빈 집 (친구랑 옆집) */
function pickEmptyNextDoor(heroNo: number | null): number {
  const lived = new Set([...state.houses.values()].filter((h) => !h.isNpc && h.igHandle).map((h) => h.houseNo));
  const base = heroNo ? Math.floor((heroNo - 1) / NEIGHBORHOOD_SIZE) * NEIGHBORHOOD_SIZE : 0;
  const inNb = (n: number) => base + (((n - base - 1 + NEIGHBORHOOD_SIZE) % NEIGHBORHOOD_SIZE) + 1);
  if (heroNo) {
    for (const d of [1, -1, 2, -2, 3, -3, 4, -4, 5]) {
      const n = inNb(heroNo + d);
      if (!lived.has(n)) return n;
    }
  }
  for (let n = 1; n <= 1000; n++) if (!lived.has(n)) return n;
  return 1;
}

function buildHookReel(heroNo: number | null): Reel {
  const G = GROUND_Y;
  const target = pickEmptyNextDoor(heroNo);
  const { hs, nb } = heroFrame(target);
  const fx = Math.sin(hs.rot);
  const fz = Math.cos(hs.rot);
  const doorX = hs.x + fx * 0.6;
  const doorZ = hs.z + fz * 0.6;
  const lived = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle).length;
  const left = Math.max(0, FOUNDER_MAX - lived);
  const A = HOOK_VOICE_AT;
  const shotA = 6.15;
  // 빈 집 → 내 집: 이 영상 안에서만 보이는 가짜 집 (진짜 데이터는 안 바뀐다. 끝나면 되돌린다)
  const mine: House = {
    houseNo: target,
    igHandle: '여기 네 이름',
    roofColor: '#ffb04d',
    region: '' as RegionId,
    cat: { pattern: 'cheese', fur: '#f4a24a', eyeColor: '#5fbf6a' },
    likes: 0,
    isNpc: false,
    verified: false,
  };
  const shots: Shot[] = [
    {
      id: 'hook-house',
      label: '빈 집 → 내 집',
      dur: shotA,
      fade: 0.04,
      // 첫 프레임부터 빈 집이 화면 가운데. 천천히 다가가며 살짝 돈다
      // 바라보는 곳을 지붕 위쪽으로 올려 집이 화면 가운데 아래에 오게 한다 (위쪽 글자 카드, 바뀐 뒤 이름표가 보이게)
      pose: (u) => ({
        x: doorX,
        y: G + 2.2,
        z: doorZ,
        yaw: hs.rot + lerp(0.38, -0.2, u),
        pitch: lerp(0.34, 0.26, u),
        dist: lerpDist(19, 14, u),
        fov: 40,
      }),
    },
    {
      id: 'hook-up',
      label: '동네 위로',
      dur: 14.2 - shotA,
      fade: 0.04,
      // 내 집에서 동네 위로: 이웃들 이름표와 빈 집들이 보이게
      pose: (u) => ({
        x: lerp(doorX, nb.x, u),
        y: G + 0.5,
        z: lerp(doorZ, nb.z, u),
        yaw: hs.rot + lerp(-0.2, 0.75, u),
        pitch: lerp(0.38, 0.9, u),
        dist: lerpDist(15, 70, u),
        fov: 38,
      }),
    },
  ];
  return {
    shots,
    heroNo: target,
    voice: hookVoiceUrl,
    voiceAt: A,
    caps: [],
    overlays: [
      { at: 0, end: A + 3.6, cls: 'cine-hook', html: `이 빈 집,<br /><b>댓글 하나면</b><br />당신 거예요` },
      {
        at: A + 3.7,
        end: A + 4.2,
        cls: 'cine-flash',
        html: '',
        sfx: 'sparkle',
        run: () => state.scene.setHouses(withMine(mine)),
      },
      { at: A + 3.75, end: shotA - 0.05, cls: 'cine-chips', html: `<span>🐱 내 고양이</span><span>🏡 마당</span><span>🏷️ 내 이름표</span>`, sfx: 'chime' },
      {
        at: A + 6.05,
        end: A + 9.05,
        cls: 'cine-founder',
        html: `<i>★</i><b>창립 주민</b><span>처음 ${FOUNDER_MAX}명만</span><em>남은 자리 ${left}</em>`,
        sfx: 'pop',
      },
      { at: A + 9.15, end: 99, cls: 'cine-cta', html: `<i>옆집 살 친구한테 보내고 ✈️</i><span>댓글에</span> <b>'입주'</b>`, sfx: 'pop' },
    ],
    cleanup: () => pushHousesToScene(true),
  };
}

/** 지금 섬의 집들 + 가짜 내 집 (빈 집 자리) */
function withMine(mine: House): House[] {
  const list = new Map([...state.houses.values()].map((h) => [h.houseNo, h]));
  list.set(mine.houseNo, mine);
  return withEmptyLots([...list.values()], state.unlockedZones);
}

const FADE = 0.45;

export function startCinema(scene: IslandScene) {
  document.body.classList.add('cinema-mode');
  scene.highlightHouse(null);
  scene.highlightRegion(null);
  const shots = buildShots();
  // 릴스 나레이션은 미리 받아 두고, 새 주민은 서버에 묻는다
  const voices = new Map([hookVoiceUrl, newcomerVoiceUrl].map((u) => [u, loadCineVoice(u)]));
  let newcomer: Newcomer | null = null;

  const root = document.createElement('div');
  root.id = 'cinema';
  root.innerHTML = `
    <div class="cine-ovl"></div>
    <div class="cine-cap" hidden><span></span></div>
    <div class="cine-black"></div>
    <div class="cine-panel">
      <h2>🎬 촬영 모드</h2>
      <p class="cine-lead">진짜 게임 화면에 카메라만 움직여요. 폰의 <b>화면 기록</b>을 켜고 고르세요.</p>
      <button class="cine-go cine-hookreel">🔥 첫 1초 릴스 <small>빈 집 → 내 집, 약 14초</small></button>
      <button class="cine-go cine-reel cine-go-sub2" disabled>📣 새 주민 릴스 <small class="cine-reel-who">찾는 중…</small></button>
      <p class="cine-reel-note">나레이션 목소리가 함께 나와요. 소리를 켜고 찍으세요.</p>
      <button class="cine-go cine-all cine-go-sub">▶ 섬 구경 이어서 찍기 <small>약 ${Math.round(shots.reduce((s, x) => s + x.dur, 0))}초</small></button>
      <div class="cine-shots">
        ${shots.map((s, i) => `<button class="cine-shot" data-i="${i}">${s.label}</button>`).join('')}
      </div>
      <label class="cine-opt"><input type="checkbox" data-o="caps" checked /> 자막 넣기 <small>(새 주민 릴스)</small></label>
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
  const ovl = $('.cine-ovl');
  let ovlEls: HTMLElement[] = [];
  let fired: boolean[] = [];
  const cap = $('.cine-cap');
  const capText = cap.querySelector('span') as HTMLSpanElement;
  const reelBtn = $<HTMLButtonElement>('.cine-reel');

  let playlist: Shot[] = [];
  let t0 = 0;
  let playing = false;
  let shotIndex = -1;
  let idleAt = performance.now();
  let reel: Reel | null = null;
  let showCaps = true;
  let stopVoice: (() => void) | null = null;
  let lastCap = '';

  void findNewcomer().then((n) => {
    newcomer = n;
    const who = reelBtn.querySelector('.cine-reel-who') as HTMLElement;
    who.textContent = n ? `주인공 ${n.handle}` : '입주한 집이 없어요';
    reelBtn.disabled = !n;
  });

  const setBlack = (v: number) => {
    black.style.opacity = String(clamp01(v));
  };

  /** 릴스 글자들: t 는 첫 컷부터 지난 시간(초) */
  const drawReelText = (t: number) => {
    if (!reel) return;
    reel.overlays.forEach((o, i) => {
      const on = t >= o.at && t < o.end;
      const el = ovlEls[i];
      if (el.hidden === on) el.hidden = !on;
      if (on && !fired[i]) {
        fired[i] = true;
        if (o.sfx) playCine(o.sfx, o.sfx === 'pop' ? 0.6 : 0);
        o.run?.();
      }
    });
    const line = showCaps ? (reel.caps.find((c) => t >= c.at && t < c.end)?.text ?? '') : '';
    if (line !== lastCap) {
      lastCap = line;
      capText.textContent = line;
      cap.hidden = !line;
    }
  };

  const hideReelText = () => {
    ovl.innerHTML = '';
    ovlEls = [];
    fired = [];
    cap.hidden = true;
    lastCap = '';
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
    drawReelText(t);
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
    const fade = shot.fade ?? FADE;
    const fadeIn = clamp01(t / fade);
    const fadeOut = clamp01((shot.dur - t) / fade);
    setBlack(1 - Math.min(fadeIn, fadeOut));
  };

  const play = (list: Shot[], withReel: Reel | null = null, voice: AudioBuffer | null = null) => {
    void unlockSound();
    const max = ($('[data-o="max"]') as HTMLInputElement).checked;
    scene.setCinemaQuality(max ? 'max' : 'high');
    scene.setNameTags(($('[data-o="tags"]') as HTMLInputElement).checked);
    scene.setTimeOfDay(list[0].night ? 'night' : 'day');
    showCaps = ($('[data-o="caps"]') as HTMLInputElement).checked;
    playlist = list;
    reel = withReel;
    hideReelText();
    if (withReel) {
      ovlEls = withReel.overlays.map((o) => {
        const el = document.createElement('div');
        el.className = o.cls;
        el.innerHTML = o.html;
        el.hidden = true;
        ovl.appendChild(el);
        return el;
      });
      fired = withReel.overlays.map(() => false);
    }
    scene.highlightHouse(withReel ? withReel.heroNo : null);
    shotIndex = -1;
    panel.hidden = true;
    setBlack(1);
    // 검은 화면 1.5초 (해 지는 중이던 하늘이 돌아오고, 고화질 그림자가 준비될 시간. 편집할 때 잘라 낸다)
    t0 = performance.now() + 1500;
    if (withReel && voice) stopVoice = playCineVoice(voice, 1.5 + withReel.voiceAt);
    playing = true;
  };

  const stop = () => {
    playing = false;
    stopVoice?.();
    stopVoice = null;
    reel?.cleanup?.();
    reel = null;
    hideReelText();
    scene.highlightHouse(null);
    idleAt = performance.now();
    panel.hidden = false;
    setBlack(0);
    scene.setTimeOfDay('day');
  };

  const startReel = (btn: HTMLButtonElement, make: () => Reel) => {
    // 소리는 누른 순간에 켜야 한다 (아이폰). 나레이션 파일은 대개 이미 받아 둔 상태다
    void unlockSound();
    btn.disabled = true;
    const r = make();
    void (voices.get(r.voice) ?? loadCineVoice(r.voice)).then((voice) => {
      btn.disabled = false;
      play(r.shots, r, voice);
    });
  };
  reelBtn.addEventListener('click', () => {
    if (!newcomer) return;
    const n = newcomer;
    startReel(reelBtn, () => buildNewcomerReel(n.houseNo, n.handle, n.region));
  });
  const hookBtn = $<HTMLButtonElement>('.cine-hookreel');
  hookBtn.addEventListener('click', () => startReel(hookBtn, () => buildHookReel(newcomer?.houseNo ?? null)));
  $('.cine-all').addEventListener('click', () => play(shots));
  root.querySelectorAll<HTMLButtonElement>('.cine-shot').forEach((btn) => {
    btn.addEventListener('click', () => play([shots[Number(btn.dataset.i)]]));
  });

  scene.setNameTags(true);
  requestAnimationFrame(frame);
}
