// 촬영 모드 (2026-11-17, 2차): 인스타 릴스용 영상을 폰 화면 기록으로 바로 찍게 한다.
// - 주소에 ?cinema 를 붙이면 켜진다 (설정 화면의 "촬영 모드" 버튼).
// - 진짜 게임 화면 그대로: 버튼/글자/자막을 모두 숨기고 카메라만 영화처럼 움직인다.
//   자막과 목소리는 편집 앱에서 넣는다 (사용자 2026-11-17: "실제 게임 화면에서 UI 없애고 카메라 무빙만").
// - 촬영 중에는 화질을 최고 단계로 고정한다 (자동으로 낮추지 않음, 선택하면 해상도 3배).
// - 장면(컷)을 하나씩 찍거나 전체를 이어서 찍을 수 있다. 컷 사이에는 짧게 검게 넘어간다.
// 씬은 setCinemaCamera / setNameTags / setCinemaQuality / setTimeOfDay 로만 다룬다.
import { dockArea, GROUND_Y, houseSlot, neighborhoodArea, townSquares, TOWN_SQUARE, type CinemaCamera, type IslandScene } from '../scene';
import { FOUNDER_MAX, NEIGHBORHOOD_SIZE, REGIONS } from '../shared/config';
import type { House, RegionId, RemotePlayer } from '../shared/types';
import { loadCineVoice, playCine, playCineVoice, unlockSound, type CineSfx } from './audio/sound';
import hookVoiceUrl from './reels/hook-voice.mp3?url';
import newcomerVoiceUrl from './reels/newcomer-voice.mp3?url';
import seriesVoiceUrl from './reels/series-voice.mp3?url';
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
  /** 효과음 높이 0~1 (없으면 팝은 0.6) */
  pitch?: number;
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
  /** 매 프레임 (t: 첫 컷부터 지난 시간). 말풍선처럼 따라다니는 것 */
  tick?: (t: number) => void;
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

// ── 연재 릴스 "팔로워 1명 = 집 1채, Day N" (2026-11-19) ──
// 조회수 2200, 팔로우 30 → 매일 이어 보는 연재. 어제 섬(최근 24시간 새 집을 빼고) → 숫자가 올라가며 새 집이 하나씩 선다 →
// 새 이웃 집 최대 5곳을 2초씩 가까이 (이름 카드) → 마을 광장에 고양이들이 모여 수다 (말풍선, 2차) → 창립 주민 남은 자리 →
// 해 지는 섬 "내일은 몇 채?" → 밤 동네 "댓글에 입주, 다음 편에 당신 집".
// 나레이션 src/app/reels/series-voice.mp3 (ElevenLabs Yeonhee, eleven_v4, 36.7초). 숫자와 이름은 말하지 않아 매일 그대로 쓴다.
// 문장 시간은 ffmpeg silencedetect 로 잰 값이다. 파일을 바꾸면 SERIES_LINES 도 고친다 (컷 경계도 이 시간에서 나온다).
// 영상 길이는 나레이션 길이에 맞춰 늘어난다(startReel 의 fitVoice): 목소리가 끝나기 전에 영상이 끝나지 않는다.
const SERIES_VOICE_AT = 0.3;
const SERIES_LINES: [number, number, string][] = [
  [0.0, 3.69, '팔로워 한 명이 늘 때마다\n이 섬에 집이 한 채씩 생겨요!'], // 0
  [4.04, 6.42, '어제보다 집이 이만큼이나 늘었어요'], // 1
  [6.81, 9.21, '새로 온 이웃들,\n한 집씩 구경해 볼까요?'], // 2
  [9.74, 12.98, '다들 마당 있는 집에\n고양이 한 마리씩 데리고 왔어요'], // 3
  [13.39, 16.33, '고양이 무늬랑 털 색도\n다 직접 골랐대요'], // 4
  [16.86, 18.74, '그리고 여기는 마을 광장!'], // 5
  [19.16, 22.34, '이웃 고양이들이 모여서\n수다도 떨고, 같이 놀아요'], // 6
  [22.82, 24.96, '처음 100명은 창립 주민이 돼요'], // 7
  [25.33, 27.27, '이제 자리가 얼마 안 남았어요!'], // 8
  [27.64, 29.66, '내일은 섬이 얼마나 커질까요?'], // 9
  [30.04, 31.97, '팔로우하고 같이 지켜봐 주세요'], // 10
  [32.43, 34.48, "댓글에 '입주'라고 남기면"], // 11
  [34.65, 36.51, '다음 편엔 당신 집이 나와요!'], // 12
];
/** 광장 수다 (말풍선). 하루 지나도 어색하지 않은 말만 */
const SQUARE_TALK = ['안녕! 새로 왔어 🐾', '어디 살아?', '나 바닷가 쪽!', '우리 옆집이다 😻', '낚시 같이 갈래?', '츄르 사러 가자', '트리 예쁘다 🎄', '내일 또 놀자!'];
/** 연재 1일째 (한국 시간 2026-11-17). 주소에 &day=N 이면 그 숫자 */
const SERIES_START_KST = Date.UTC(2026, 10, 17);
export function seriesDay(): number {
  const q = Number(new URLSearchParams(location.search).get('day'));
  if (Number.isInteger(q) && q > 0) return q;
  return Math.max(1, Math.floor((Date.now() + 9 * 3600_000 - SERIES_START_KST) / 86400_000) + 1);
}

interface SeriesData {
  total: number;
  recent: { houseNo: number; handle: string; region: string }[];
}

async function fetchSeries(): Promise<SeriesData> {
  try {
    const res = await fetch('/api/series', { cache: 'no-store' });
    if (res.ok) return (await res.json()) as SeriesData;
  } catch {
    /* 아래 */
  }
  // 서버가 안 되면: 섬에 보이는 집만 세고, 번호가 큰 집을 새 집으로 본다
  const lived = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle).sort((a, b) => b.houseNo - a.houseNo);
  return { total: lived.length, recent: lived.slice(0, 5).map((h) => ({ houseNo: h.houseNo, handle: h.igHandle!, region: h.region })) };
}

function buildSeriesReel(data: SeriesData, day: number): Reel {
  const G = GROUND_Y;
  const A = SERIES_VOICE_AT;
  const L = (i: number) => A + SERIES_LINES[i][0];
  // 서버 목록과 지금 섬에 있는 집이 맞는 것만 (이사했거나 막 바뀐 집 빼기)
  const recent = data.recent.filter((r) => state.houses.has(r.houseNo));
  const total = Math.max(data.total, recent.length);
  const before = total - recent.length;
  const newSet = new Set(recent.map((r) => r.houseNo));
  const lived = [...state.houses.values()];
  const residents = lived.filter((h) => !h.isNpc && h.igHandle);
  /** 새 집 중 앞의 k 채만 세운 섬 (오래된 새 집부터 선다) */
  const grown = [...recent].reverse();
  const islandWith = (k: number) => {
    const show = new Set(grown.slice(0, k).map((r) => r.houseNo));
    return withEmptyLots(
      lived.filter((h) => !newSet.has(h.houseNo) || show.has(h.houseNo)),
      state.unlockedZones,
    );
  };

  // 섬 전체 가운데 (입주한 집들 가운데), 새 집들 가운데와 퍼진 정도
  const center = (nos: number[]) => {
    if (!nos.length) nos = [1];
    let x = 0;
    let z = 0;
    for (const n of nos) {
      const s = houseSlot(n);
      x += s.x;
      z += s.z;
    }
    x /= nos.length;
    z /= nos.length;
    let r = 0;
    for (const n of nos) {
      const s = houseSlot(n);
      r = Math.max(r, Math.hypot(s.x - x, s.z - z));
    }
    return { x, z, r };
  };
  const all = center(residents.map((h) => h.houseNo));
  const fresh = recent.length ? center(recent.map((r) => r.houseNo)) : all;
  const growDist = Math.min(150, Math.max(42, fresh.r * 2.4 + 18));

  // 가까이 볼 새 이웃: 가장 최근 5집 (없으면 섬에서 아무 집). 집마다 2초쯤 (사용자 2026-11-19: "너무 짧아서 잘 못 봤어")
  const stars = (recent.length ? recent : residents.map((h) => ({ houseNo: h.houseNo, handle: h.igHandle!, region: h.region }))).slice(0, 5);

  // 마을 광장 (가장 가까운 광장 = 첫 구역)
  const sq = townSquares(1)[0] ?? { x: TOWN_SQUARE.x, z: TOWN_SQUARE.z };
  const gx = sq.x;
  const gz = sq.z + 5.2; // 광장 트리 앞 (트리가 뒤로 보이게 조금 떨어져서)

  const t1 = L(1) - 0.2; // 섬 → 자라는 컷
  const t2 = L(2) - 0.2; // 새 이웃 가까이
  const t3 = L(5) - 0.25; // 마을 광장
  const t4 = L(7) - 0.25; // 창립 주민 (광장 위로 올라가기)
  const t5 = L(9) - 0.2; // 내일은? (해 짐)
  const t6 = L(11) - 0.2; // 댓글에 입주 (밤)
  const tEnd = A + 36.6 + 2.5;

  const shots: Shot[] = [
    {
      id: 'series-island',
      label: '어제의 섬',
      dur: t1,
      fade: 0.04,
      pose: (u) => ({ x: all.x, y: G, z: all.z, yaw: 2.2 + 0.35 * u, pitch: lerp(0.95, 0.85, u), dist: lerpDist(Math.max(120, all.r * 3.2 + 40), Math.max(95, all.r * 2.8 + 30), u), fov: 38 }),
    },
    {
      id: 'series-grow',
      label: '집이 늘어나요',
      dur: t2 - t1,
      fade: 0.15,
      pose: (u) => ({ x: fresh.x, y: G, z: fresh.z, yaw: 2.55 + 0.4 * u, pitch: lerp(0.9, 0.78, u), dist: lerpDist(growDist * 1.15, growDist, u), fov: 38 }),
    },
  ];
  const each = (t3 - t2) / Math.max(1, stars.length);
  stars.forEach((s, i) => {
    const hs = houseSlot(s.houseNo);
    const dx = hs.x + Math.sin(hs.rot) * 0.6;
    const dz = hs.z + Math.cos(hs.rot) * 0.6;
    const side = i % 2 ? -1 : 1;
    shots.push({
      id: `series-nb${i}`,
      label: `새 이웃 ${s.handle}`,
      dur: each,
      fade: 0.14,
      // 바라보는 곳을 지붕 위로 올려 집과 이름표가 위쪽 이름 카드 아래에 오게 한다. 천천히 옆으로 돌며 마당과 고양이를 보여 준다
      pose: (u) => ({ x: dx, y: G + 2.6, z: dz, yaw: hs.rot + side * lerp(0.5, 0.05, u), pitch: lerp(0.38, 0.3, u), dist: lerpDist(17, 12.5, u), fov: 40 }),
    });
  });
  shots.push(
    {
      id: 'series-square',
      label: '광장 수다',
      dur: t4 - t3,
      fade: 0.2,
      // 광장 트리 앞에 모인 고양이들을 조금 위에서 천천히 돌아본다. 바라보는 곳을 카메라 쪽으로 당겨 무리가 화면 가운데 위에 오게 (아래 자막을 피해서)
      pose: (u) => {
        const yaw = lerp(-0.5, 0.3, u);
        return { x: gx + Math.sin(yaw) * 1.0, y: G + 0.4, z: gz + Math.cos(yaw) * 1.0, yaw, pitch: lerp(0.5, 0.42, u), dist: lerpDist(13.5, 11.5, u), fov: 40 };
      },
    },
    {
      id: 'series-founder',
      label: '창립 주민',
      dur: t5 - t4,
      fade: 0.15,
      // 광장에서 동네 위로 올라간다
      pose: (u) => ({ x: lerp(gx, fresh.x, u), y: G + 0.5, z: lerp(gz, fresh.z, u), yaw: lerp(0.35, 1.2, u), pitch: lerp(0.45, 0.9, u), dist: lerpDist(14, Math.max(70, growDist), u), fov: 38 }),
    },
    {
      id: 'series-tomorrow',
      label: '내일은 몇 채?',
      dur: t6 - t5,
      fade: 0.2,
      night: true,
      // 해가 지는 동안 섬 전체로 멀어진다 (아직 빈 집 자리가 많이 보이게)
      pose: (u) => ({ x: lerp(fresh.x, all.x, u), y: G, z: lerp(fresh.z, all.z, u), yaw: 3.0 + 0.4 * u, pitch: lerp(0.75, 0.9, u), dist: lerpDist(70, Math.min(215, Math.max(130, all.r * 3 + 60)), u), fov: 38 }),
    },
    {
      id: 'series-cta',
      label: '댓글에 입주',
      dur: tEnd - t6,
      fade: 0.2,
      night: true,
      pose: (u) => ({ x: fresh.x, y: G, z: fresh.z, yaw: 3.5 + 0.35 * u, pitch: lerp(0.62, 0.5, u), dist: lerpDist(growDist * 0.95, growDist * 0.75, u), fov: 38 }),
    },
  );

  const left = Math.max(0, FOUNDER_MAX - total);
  const n = recent.length;
  // 어제의 섬: 최근 24시간 새 집을 잠깐 빈 집으로 둔다 (검은 화면 동안 바꿔 둔다. 끝나면 cleanup 이 되돌린다)
  state.scene.setHouses(islandWith(0));

  // 광장에 모인 고양이들: 진짜 주민 고양이(새 이웃 먼저)를 가짜 접속자로 세운다. 영상 안에서만
  const crowdSrc = [...recent.map((r) => state.houses.get(r.houseNo)!), ...residents.filter((h) => !newSet.has(h.houseNo))].filter(Boolean).slice(0, 8);
  const ACTS: Array<Pick<RemotePlayer, 'anim' | 'dance'>> = [
    { anim: 'idle' },
    { anim: 'sit' },
    { anim: 'idle', dance: 'wiggle' },
    { anim: 'idle' },
    { anim: 'sit' },
    { anim: 'idle', dance: 'sway' },
    { anim: 'idle' },
    { anim: 'idle', dance: 'hop' },
  ];
  const crowd: RemotePlayer[] = crowdSrc.map((h, i) => {
    const k = crowdSrc.length;
    const a = (i / k) * Math.PI * 2 + 0.3;
    const r = 1.25 + (i % 2) * 0.45;
    const x = gx + Math.sin(a) * r;
    const z = gz + Math.cos(a) * r;
    // 뒤쪽 고양이는 가운데(=카메라 쪽)를, 앞쪽 고양이는 옆 친구를 본다 (등만 보이지 않게 옆모습)
    const toC = Math.atan2(gx - x, gz - z) + Math.PI; // 씬의 rotY 는 이 방향이 반대다 (촬영 화면으로 확인)
    const rotY = z > gz ? toC + (x > gx ? -1.25 : 1.25) : toC;
    return { id: `cine-sq${i}`, houseNo: h.houseNo, handle: h.igHandle!, x, z, rotY, cat: h.cat, ...ACTS[i % ACTS.length] };
  });
  // 말풍선: 광장 컷 동안 고양이들이 돌아가며 한마디씩 (머리 위를 따라다닌다)
  const talks = crowd.length
    ? SQUARE_TALK.slice(0, 7).map((text, i) => ({ id: crowd[(i * 3) % crowd.length].id, text, at: t3 + 1.2 + i * 0.65, end: t3 + 1.2 + i * 0.65 + 2.2 }))
    : [];
  let bubs: HTMLElement[] = [];
  const tick = (t: number) => {
    const on = t >= t3 - 0.3 && t < t4;
    if (!on) {
      if (bubs.length) {
        bubs.forEach((b) => b.remove());
        bubs = [];
      }
      return;
    }
    if (!bubs.length) {
      const layer = document.querySelector('#cinema .cine-ovl');
      bubs = talks.map((tk) => {
        const el = document.createElement('div');
        el.className = 'cine-bub';
        el.textContent = tk.text;
        el.hidden = true;
        layer?.appendChild(el);
        return el;
      });
    }
    talks.forEach((tk, i) => {
      const el = bubs[i];
      const show = t >= tk.at && t < tk.end;
      const pos = show ? state.scene.remoteScreenPos(tk.id) : null;
      if (!pos) {
        if (!el.hidden) el.hidden = true;
        return;
      }
      if (el.hidden) {
        el.hidden = false;
        playCine('pop', 0.35 + (i % 4) * 0.15);
      }
      const half = Math.min(el.offsetWidth / 2 + 6, innerWidth / 2);
      const bx = Math.min(innerWidth - half, Math.max(half, pos.x));
      el.style.transform = `translate(${bx}px, ${pos.y - 26}px) translate(-50%, -100%)`;
    });
  };

  const setCount = (v: number) => {
    document.querySelectorAll('#cinema .cine-num').forEach((el) => (el.textContent = String(v)));
  };
  const overlays: Overlay[] = [
    // 처음부터 끝까지: 왼쪽 위 "Day N · 🏠 집 수"
    {
      at: 0,
      end: 99,
      cls: 'cine-day',
      html: `<b>Day ${day}</b><span>🏠 <i class="cine-num">${before}</i>채</span>`,
      // 광장 고양이들은 처음부터 세워 둔다 (나타나는 시간이 있어서 광장 컷에 바로 보이게)
      run: () => state.scene.setRemotePlayers(crowd),
    },
    {
      at: 0,
      end: t1 - 0.05,
      cls: 'cine-hook cine-series-hook',
      html: `팔로워 <b>1명</b> = 집 <b>1채</b><small>팔로워가 늘면 섬이 자라요</small>`,
    },
    {
      at: t1 + 0.1,
      end: t2 - 0.1,
      cls: 'cine-count',
      html: `<small>어제 ${before}채 → 오늘</small><b class="cine-num">${before}</b><em>${n ? `+${n}채 🎉` : '오늘도 기다리는 중'}</em>`,
      sfx: 'riser',
    },
  ];
  // 새 집이 하나씩 선다 (뽁 소리가 점점 높게). 많으면 시간 안에 촘촘하게
  const g0 = t1 + 0.45;
  const g1 = t2 - 0.45;
  grown.forEach((_, i) => {
    overlays.push({
      at: n === 1 ? g0 + 0.6 : g0 + ((g1 - g0) * i) / Math.max(1, n - 1),
      end: 99,
      cls: 'cine-none',
      html: '',
      sfx: i === n - 1 ? 'chime' : 'pop',
      pitch: Math.min(1, i / Math.max(1, n - 1)),
      run: () => {
        state.scene.setHouses(islandWith(i + 1));
        setCount(before + i + 1);
      },
    });
  });
  stars.forEach((s, i) => {
    const area = regionLabel(s.region);
    overlays.push({
      at: t2 + each * i + 0.15,
      end: t2 + each * (i + 1) - 0.12,
      cls: 'cine-card',
      html: `<small>${recent.length ? '새 이웃' : '이웃'} ${i + 1}/${stars.length}</small><b>${esc(s.handle)}</b>${area ? `<em>${esc(area)}</em>` : ''}`,
      sfx: 'sparkle',
    });
  });
  if (recent.length > stars.length) {
    const rest = recent.slice(stars.length, stars.length + 12);
    const more = recent.length - stars.length - rest.length;
    overlays.push({
      at: t2 + each * (stars.length - 1) + 0.2,
      end: t3 - 0.12,
      cls: 'cine-names',
      html: `<em>그리고 새 이웃들</em>${rest.map((r) => `<span>${esc(r.handle)}</span>`).join('')}${more > 0 ? `<span>+${more}</span>` : ''}`,
    });
  }
  overlays.push(
    {
      // 말풍선이 잘 보이게 컷 앞부분에만
      at: t3 + 0.1,
      end: t3 + 2.1,
      cls: 'cine-card cine-square',
      html: `<small>모두 모여요</small><b>마을 광장 💬</b>`,
      sfx: 'chime',
    },
    {
      at: t4 + 0.2,
      end: t5 - 0.1,
      cls: 'cine-founder',
      html: `<i>★</i><b>창립 주민</b><span>처음 ${FOUNDER_MAX}명만</span><em>남은 자리 ${left}</em>`,
      sfx: 'pop',
    },
    {
      at: t5 + 0.4,
      end: t6 - 0.1,
      cls: 'cine-hook cine-series-hook',
      html: `내일은 <b>몇 채</b>가<br />될까요? 👀<small>팔로우하고 Day ${day + 1} 보기</small>`,
      sfx: 'chime',
    },
    {
      at: t6 + 0.2,
      end: 99,
      cls: 'cine-cta',
      html: `<span>댓글에</span> <b>'입주'</b><em>다음 편엔 당신 집이 나와요 🏡</em>`,
      sfx: 'pop',
    },
  );
  return {
    shots,
    heroNo: null,
    voice: seriesVoiceUrl,
    voiceAt: A,
    caps: SERIES_LINES.map(([a, b, text]) => ({ at: A + a, end: A + b + 0.25, text })),
    overlays,
    tick,
    cleanup: () => {
      bubs.forEach((b) => b.remove());
      bubs = [];
      state.scene.setRemotePlayers([]);
      pushHousesToScene(true);
    },
  };
}

/** 지금 섬의 집들 + 가짜 내 집 (빈 집 자리) */
function withMine(mine: House): House[] {
  const list = new Map([...state.houses.values()].map((h) => [h.houseNo, h]));
  list.set(mine.houseNo, mine);
  return withEmptyLots([...list.values()], state.unlockedZones);
}

const FADE = 0.45;

/** 나레이션이 끝나기 전에 영상이 끝나지 않게 마지막 컷을 늘린다 (목소리 끝 + 1.6초는 마지막 화면을 보여 준다) */
function fitVoice(r: Reel, voiceSec: number) {
  const need = r.voiceAt + voiceSec + 1.6;
  const have = r.shots.reduce((s, x) => s + x.dur, 0);
  if (have < need) {
    const lastShot = r.shots[r.shots.length - 1];
    r.shots[r.shots.length - 1] = { ...lastShot, dur: lastShot.dur + (need - have) };
  }
}

export function startCinema(scene: IslandScene) {
  document.body.classList.add('cinema-mode');
  scene.highlightHouse(null);
  scene.highlightRegion(null);
  const shots = buildShots();
  // 릴스 나레이션은 미리 받아 두고, 새 주민은 서버에 묻는다
  const voices = new Map([seriesVoiceUrl, hookVoiceUrl, newcomerVoiceUrl].map((u) => [u, loadCineVoice(u)]));
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
      <button class="cine-go cine-series">📅 연재 릴스 <small>집이 늘어나는 섬 + 광장 수다, 약 39초</small></button>
      <label class="cine-opt cine-day-row">연재 <b>Day</b> <input class="cine-day-in" type="number" min="1" inputmode="numeric" value="${seriesDay()}" /> <small>(날짜로 자동, 고칠 수 있어요)</small></label>
      <button class="cine-go cine-hookreel cine-go-sub2">🔥 첫 1초 릴스 <small>빈 집 → 내 집, 약 14초</small></button>
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
    reel.tick?.(t);
    reel.overlays.forEach((o, i) => {
      const on = t >= o.at && t < o.end;
      const el = ovlEls[i];
      if (el.hidden === on) el.hidden = !on;
      if (on && !fired[i]) {
        fired[i] = true;
        if (o.sfx) playCine(o.sfx, o.pitch ?? (o.sfx === 'pop' ? 0.6 : 0));
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
      if (voice) fitVoice(r, voice.duration);
      play(r.shots, r, voice);
    });
  };
  reelBtn.addEventListener('click', () => {
    if (!newcomer) return;
    const n = newcomer;
    startReel(reelBtn, () => buildNewcomerReel(n.houseNo, n.handle, n.region));
  });
  const seriesBtn = $<HTMLButtonElement>('.cine-series');
  const dayIn = $<HTMLInputElement>('.cine-day-in');
  seriesBtn.addEventListener('click', () => {
    void unlockSound();
    seriesBtn.disabled = true;
    const day = Math.max(1, Math.floor(Number(dayIn.value)) || seriesDay());
    void fetchSeries().then((data) => {
      seriesBtn.disabled = false;
      startReel(seriesBtn, () => buildSeriesReel(data, day));
    });
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
