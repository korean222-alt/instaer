// 촬영 모드 (2026-11-17, 2차): 인스타 릴스용 영상을 폰 화면 기록으로 바로 찍게 한다.
// - 주소에 ?cinema 를 붙이면 켜진다 (설정 화면의 "촬영 모드" 버튼).
// - 진짜 게임 화면 그대로: 버튼/글자/자막을 모두 숨기고 카메라만 영화처럼 움직인다.
//   자막과 목소리는 편집 앱에서 넣는다 (사용자 2026-11-17: "실제 게임 화면에서 UI 없애고 카메라 무빙만").
// - 촬영 중에는 화질을 최고 단계로 고정한다 (자동으로 낮추지 않음, 선택하면 해상도 3배).
// - 장면(컷)을 하나씩 찍거나 전체를 이어서 찍을 수 있다. 컷 사이에는 짧게 검게 넘어간다.
// 씬은 setCinemaCamera / setNameTags / setCinemaQuality / setTimeOfDay 로만 다룬다.
import { dockArea, GROUND_Y, houseSlot, neighborhoodArea, townSquares, TOWN_SQUARE, type CaveNode, type CinemaCamera, type IslandScene, type SceneBug } from '../scene';
import { FOUNDER_MAX, NEIGHBORHOOD_SIZE, REGIONS } from '../shared/config';
import type { House, InteriorItem, PlacedItem, RegionId, RemotePlayer } from '../shared/types';
import { toSceneNpc, townNpcs } from './play/npcs';
import { pinDrawings, setArtCenter, surfaceDrawing } from './art';
import { loadCineVoice, playCine, playCineVoice, startRecordAudio, stopRecordAudio, unlockSound, type CineSfx } from './audio/sound';
import decorVoiceUrl from './reels/decor-voice.mp3?url';
import hookVoiceUrl from './reels/hook-voice.mp3?url';
import newcomerVoiceUrl from './reels/newcomer-voice.mp3?url';
import seriesVoiceUrl from './reels/series-voice.mp3?url';
import playVoiceUrl from './reels/play-voice.mp3?url';
import winterVoiceUrl from './reels/winter-voice.mp3?url';
import { canRecord, startRecording, videoFileName, type Recording } from './reelRecorder';
import { pushHousesToScene, state, toNextIsland, totalHouses } from './state';
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
  /** 이 컷이 시작될 때 한 번 (집 안에 들어가기 같은 것) */
  enter?: () => void;
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
    // 뒤쪽 고양이는 가운데(=카메라 쪽)를 보고, 앞쪽 고양이는 카메라 쪽으로 몸을 틀어 옆 친구를 본다 (등만 보이지 않게).
    // rotY = atan2(dx, dz) 가 (dx, dz) 쪽을 보는 방향이다. 카메라는 +z 쪽에 있다
    const toC = Math.atan2(gx - x, gz - z);
    const rotY = z > gz ? (x > gx ? -0.7 : 0.7) : toC;
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

// ── 꾸미기 릴스 "내 집, 내 맘대로" (2026-11-20) ──
// 사용자: "이번에는 고양이도 보여주는데 집 꾸미기 위주로. 지붕을 직접 그릴 수도 있고 집 안도 잘 꾸민 사람들 보여주고".
// 지붕 그림 집 → 이웃들 지붕 그림 (최대 3) → 잘 꾸민 마당 (최대 2) → 잘 꾸민 집 안 (최대 3, 씬이 방 안에서도 촬영 카메라를 쓴다)
// → 그 집 고양이 가까이 (방 안) → 동네 위로 "댓글에 입주".
// 데이터 GET /api/showcase. 나레이션 src/app/reels/decor-voice.mp3 (ElevenLabs Yeonhee, eleven_v4, 28.0초, 이름은 말하지 않는다).
// 문장 시간은 silencedetect 로 잰 값이다. 파일을 바꾸면 DECOR_LINES 도 고친다 (컷 경계도 여기서 나온다).
const DECOR_VOICE_AT = 0.3;
const DECOR_LINES: [number, number, string][] = [
  [0.0, 3.36, '고양이섬에서는\n내 집을 내 맘대로 꾸밀 수 있어요!'], // 0
  [3.78, 6.42, '지붕에는 직접 그린 그림을\n올릴 수 있어요'], // 1
  [6.94, 9.42, '이웃들이 그린 지붕,\n같이 구경해 볼까요?'], // 2
  [10.11, 13.19, '마당에는 캣타워랑 해먹,\n화분을 놓고요'], // 3
  [13.63, 17.54, '집 안은 벽지랑 바닥,\n가구까지 전부 마음대로!'], // 4
  [18.05, 20.53, '섬에서 제일 예쁘게 꾸민 집들이에요'], // 5
  [20.99, 23.27, '고양이도 꾸민 집에서\n기다리고 있어요'], // 6
  [23.73, 25.7, "댓글에 '입주'라고 남기면,"], // 7
  [25.88, 27.61, '당신만의 집을 꾸밀 수 있어요!'], // 8
];

interface ShowcaseHouse {
  houseNo: number;
  handle: string;
  region: string;
}
interface ShowcaseRoom extends ShowcaseHouse {
  rank: string;
  room: InteriorItem[];
  wallpaper: string;
  floor: string;
  big: boolean;
}
interface ShowcaseData {
  roofs: (ShowcaseHouse & { roofArt: string | null; roofArtBack: string | null })[];
  rooms: ShowcaseRoom[];
  yards: ShowcaseHouse[];
}

async function fetchShowcase(): Promise<ShowcaseData> {
  try {
    const res = await fetch('/api/showcase', { cache: 'no-store' });
    if (res.ok) return (await res.json()) as ShowcaseData;
  } catch {
    /* 아래 */
  }
  // 서버가 안 되면: 섬에 있는 지붕 그림과 마당만 (집 안은 못 본다)
  const of = (no: number): ShowcaseHouse | null => {
    const h = state.houses.get(no);
    return h && h.igHandle && !h.isNpc ? { houseNo: no, handle: h.igHandle, region: h.region } : null;
  };
  const roofNos = [...new Set([...state.roofArt.keys(), ...state.roofArtBack.keys()])];
  return {
    roofs: roofNos
      .map((no) => of(no))
      .filter((h): h is ShowcaseHouse => !!h)
      .slice(0, 5)
      .map((h) => ({ ...h, roofArt: state.roofArt.get(h.houseNo) ?? null, roofArtBack: state.roofArtBack.get(h.houseNo) ?? null })),
    rooms: [],
    yards: [...state.yards.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([no]) => of(no))
      .filter((h): h is ShowcaseHouse => !!h)
      .slice(0, 3),
  };
}

function buildDecorReel(data: ShowcaseData): Reel {
  const G = GROUND_Y;
  const A = DECOR_VOICE_AT;
  const L = (i: number) => A + DECOR_LINES[i][0];
  const here = (h: ShowcaseHouse) => state.houses.has(h.houseNo);
  const roofs = data.roofs.filter(here).slice(0, 3);
  const rooms = data.rooms.filter(here).slice(0, 3);
  const yardSrc = data.yards.filter(here);
  // 마당은 지붕/집 안에서 안 나온 집을 먼저
  const shown = new Set([...roofs, ...rooms].map((h) => h.houseNo));
  const yards = [...yardSrc.filter((h) => !shown.has(h.houseNo)), ...yardSrc.filter((h) => shown.has(h.houseNo))].slice(0, 2);
  // 주인공(첫 화면): 지붕 그림 1등, 없으면 집 안 1등, 없으면 마당 1등, 없으면 가장 최근 집
  const anyHouse = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle).sort((a, b) => b.houseNo - a.houseNo)[0];
  const heroNo = roofs[0]?.houseNo ?? rooms[0]?.houseNo ?? yards[0]?.houseNo ?? anyHouse?.houseNo ?? 1;
  // 고양이 컷과 마지막 컷은 집 안 1등 집 (없으면 주인공)
  const catHouse = rooms[0] ?? null;
  const endNo = catHouse?.houseNo ?? heroNo;

  // 지붕 그림을 화면에 넘길 수 있게 (서버 목록에만 있으면 넣어 둔다)
  for (const r of data.roofs) {
    if (r.roofArt) state.roofArt.set(r.houseNo, r.roofArt);
    if (r.roofArtBack) state.roofArtBack.set(r.houseNo, r.roofArtBack);
  }
  // 집 안 그림(가구, 벽지, 바닥)은 미리 받아 둔다 (검은 화면 동안)
  pinDrawings(rooms.flatMap((r) => [...r.room.map((i) => i.drawingId), surfaceDrawing(r.wallpaper), surfaceDrawing(r.floor)]));
  const heroSlot = houseSlot(heroNo);
  setArtCenter(heroSlot.x, heroSlot.z);

  const t1 = L(1) - 0.2; // 지붕 그림들
  const t2 = L(3) - 0.2; // 마당
  const t3 = L(4) - 0.2; // 집 안
  const t4 = L(6) - 0.2; // 고양이
  const t5 = L(7) - 0.2; // 댓글에 입주
  const tEnd = A + 27.61 + 2.2;

  /** 지붕이 잘 보이는 자리: 집 가운데 위를 조금 높이서 앞쪽 비스듬히 */
  const roofPose = (no: number, u: number, side: number): Pose => {
    const hs = houseSlot(no);
    return { x: hs.x, y: G + 2.3, z: hs.z, yaw: hs.rot + side * lerp(0.55, 0.15, u), pitch: lerp(0.62, 0.5, u), dist: lerpDist(15, 11.5, u), fov: 40 };
  };
  /** 마당이 잘 보이는 자리: 집 앞 마당 가운데를 위에서 천천히 돌며 */
  const yardPose = (no: number, u: number, side: number): Pose => {
    const hs = houseSlot(no);
    const fx = Math.sin(hs.rot);
    const fz = Math.cos(hs.rot);
    return { x: hs.x + fx * 1.6, y: G + 0.9, z: hs.z + fz * 1.6, yaw: hs.rot + side * lerp(0.7, 0.2, u), pitch: lerp(0.72, 0.6, u), dist: lerpDist(14, 11, u), fov: 40 };
  };
  /** 방 안 (방 가운데가 원점, 벽은 뒤쪽과 왼쪽. 0 ~ 1.35 사이 방향에서만 본다) */
  const roomPose = (r: ShowcaseRoom, u: number, i: number): Pose => {
    const k = r.big ? 5.5 / 4 : 1;
    const from = i % 2 ? 1.05 : 0.15;
    const to = i % 2 ? 0.45 : 0.8;
    return { x: lerp(-0.3, 0.3, u) * k, y: 0.7, z: lerp(0.2, -0.2, u) * k, yaw: lerp(from, to, u), pitch: lerp(0.72, 0.6, u), dist: lerpDist(18, 14.5, u) * k, fov: 40 };
  };

  // 방 안에 들어가기 / 나오기 (씬: 걷기 모드로 그 집 고양이를 내 고양이 자리에 세우고 방을 연다)
  let insideNo: number | null = null;
  const enterRoom = (r: ShowcaseRoom, cat?: { x: number; z: number; yaw: number }) => {
    const sc = state.scene;
    if (insideNo !== r.houseNo) {
      sc.setWalkMode(true, r.houseNo);
      sc.enterHouse(r.houseNo, r.room, r.wallpaper, r.floor, r.big);
      insideNo = r.houseNo;
    }
    const half = r.big ? 5.5 : 4;
    const spot = cat ?? { x: half * 0.15, z: half - 1.3, yaw: 0.45 };
    sc.setLocalPosition(spot.x, spot.z, spot.yaw);
    sc.setSitting(!!cat);
  };
  const leaveRoom = () => {
    if (insideNo === null) return;
    insideNo = null;
    state.scene.setSitting(false);
    state.scene.setWalkMode(false);
  };

  const shots: Shot[] = [];
  const overlays: Overlay[] = [];
  shots.push({
    id: 'decor-hook',
    label: '지붕 그림 집',
    dur: t1,
    fade: 0.04,
    // 동네 위에서 첫 집 지붕까지 한 번에 내려온다
    pose: (u) => {
      const p = roofPose(heroNo, 1, 1);
      return { ...p, yaw: p.yaw + lerp(0.9, 0, u), pitch: lerp(1.0, p.pitch, u), dist: lerpDist(60, 13, u) };
    },
  });
  overlays.push({ at: 0, end: t1 - 0.08, cls: 'cine-hook cine-series-hook', html: `내 집,<br /><b>내 맘대로</b> 🎨<small>지붕 그림부터 가구까지</small>` });

  // 지붕 그림 (첫 집은 이미 봤으니 그다음 집부터, 모자라면 첫 집도 다시)
  const roofList = roofs.length > 1 ? [...roofs.slice(1), roofs[0]].slice(0, 3) : roofs;
  if (roofList.length) {
    const each = (t2 - t1) / roofList.length;
    roofList.forEach((r, i) => {
      const side = i % 2 ? -1 : 1;
      shots.push({
        id: `decor-roof${i}`,
        label: `지붕 ${r.handle}`,
        dur: each,
        fade: 0.14,
        enter: () => {
          const s = houseSlot(r.houseNo);
          setArtCenter(s.x, s.z);
        },
        pose: (u) => roofPose(r.houseNo, u, side),
      });
      overlays.push({
        at: t1 + each * i + 0.15,
        end: t1 + each * (i + 1) - 0.12,
        cls: 'cine-card',
        html: `<small>직접 그린 지붕 🎨 ${i + 1}/${roofList.length}</small><b>${esc(r.handle)}</b>`,
        sfx: 'sparkle',
      });
    });
  } else {
    shots.push({ id: 'decor-roof', label: '지붕', dur: t2 - t1, fade: 0.14, pose: (u) => roofPose(heroNo, u, -1) });
  }

  // 마당 (없으면 주인공 집 마당)
  const yardList = yards.length ? yards : [{ houseNo: heroNo, handle: '', region: '' }];
  {
    const each = (t3 - t2) / yardList.length;
    yardList.forEach((y, i) => {
      const side = i % 2 ? 1 : -1;
      shots.push({
        id: `decor-yard${i}`,
        label: `마당 ${y.handle}`,
        dur: each,
        fade: 0.14,
        enter: () => {
          const s = houseSlot(y.houseNo);
          setArtCenter(s.x, s.z);
        },
        pose: (u) => yardPose(y.houseNo, u, side),
      });
      if (y.handle)
        overlays.push({
          at: t2 + each * i + 0.15,
          end: t2 + each * (i + 1) - 0.12,
          cls: 'cine-card',
          html: `<small>마당 꾸미기 🌿</small><b>${esc(y.handle)}</b>`,
          sfx: 'sparkle',
        });
    });
  }

  // 집 안 (없으면 마당을 하나 더 길게: 주인공 집 마당을 돌아본다)
  if (rooms.length) {
    const each = (t4 - t3) / rooms.length;
    rooms.forEach((r, i) => {
      shots.push({
        id: `decor-room${i}`,
        label: `집 안 ${r.handle}`,
        dur: each,
        fade: 0.14,
        enter: () => enterRoom(r),
        pose: (u) => roomPose(r, u, i),
      });
      overlays.push({
        at: t3 + each * i + 0.15,
        end: t3 + each * (i + 1) - 0.12,
        cls: 'cine-card',
        html: `<small>🛋️ ${esc(r.rank)}</small><b>${esc(r.handle)}</b><em>집 안 구경</em>`,
        sfx: 'sparkle',
      });
    });
    overlays.push({ at: L(4) + 0.4, end: t4 - 0.15, cls: 'cine-chips cine-decor-chips', html: `<span>🧱 벽지</span><span>🪵 바닥</span><span>🛋️ 가구</span>` });
  } else {
    shots.push({ id: 'decor-yard-more', label: '마당 더', dur: t4 - t3, fade: 0.14, pose: (u) => yardPose(heroNo, u, 1) });
  }

  // 고양이 가까이: 집 안 1등 집 방 가운데에 앉은 고양이 (없으면 마당 앞 고양이 눈높이)
  if (catHouse) {
    const half = catHouse.big ? 5.5 : 4;
    const cat = { x: 0.2, z: half - 1.4, yaw: 0.4 };
    shots.push({
      id: 'decor-cat',
      label: '고양이',
      dur: t5 - t4,
      fade: 0.14,
      enter: () => enterRoom(catHouse, cat),
      pose: (u) => ({ x: cat.x, y: 0.55, z: cat.z, yaw: lerp(0.15, 0.75, u), pitch: lerp(0.32, 0.26, u), dist: lerpDist(5, 3.6, u), fov: 40 }),
    });
    overlays.push({ at: t4 + 0.15, end: t5 - 0.12, cls: 'cine-card', html: `<small>이 집 고양이 🐾</small><b>${esc(catHouse.handle)}</b>`, sfx: 'chime' });
  } else {
    const hs = houseSlot(heroNo);
    shots.push({
      id: 'decor-cat',
      label: '고양이',
      dur: t5 - t4,
      fade: 0.14,
      pose: (u) => ({ x: hs.x + Math.sin(hs.rot) * 2, y: G + 0.6, z: hs.z + Math.cos(hs.rot) * 2, yaw: hs.rot + lerp(0.4, -0.2, u), pitch: 0.3, dist: lerpDist(8, 6, u), fov: 40 }),
    });
  }

  // 끝: 그 집에서 동네 위로 (방에서 나온다)
  {
    const hs = houseSlot(endNo);
    const nb = neighborhoodArea(hs.neighborhood);
    shots.push({
      id: 'decor-cta',
      label: '댓글에 입주',
      dur: tEnd - t5,
      fade: 0.2,
      enter: leaveRoom,
      pose: (u) => ({
        x: lerp(hs.x, nb.x, u),
        y: G + 1.5,
        z: lerp(hs.z, nb.z, u),
        yaw: hs.rot + lerp(-0.3, 0.6, u),
        pitch: lerp(0.5, 0.85, u),
        dist: lerpDist(14, 70, u),
        fov: 38,
      }),
    });
  }
  overlays.push({ at: t5 + 0.2, end: 99, cls: 'cine-cta', html: `<span>댓글에</span> <b>'입주'</b><em>당신 집도 꾸며 보세요 🏡</em>`, sfx: 'pop' });

  return {
    shots,
    heroNo: null,
    voice: decorVoiceUrl,
    voiceAt: A,
    caps: DECOR_LINES.map(([a, b, text]) => ({ at: A + a, end: A + b + 0.25, text })),
    overlays,
    cleanup: () => {
      leaveRoom();
      pinDrawings([]);
    },
  };
}

// ── 겨울밤 릴스 "추운 밤엔 고양이섬" (2026-11-21) ──
// 사용자: "겨울밤 해줘, 사람들 많이 입주했던데 사이트 접속하면 몇 채 남았는지 뜨잖아".
// 눈 오는 밤 동네 위 → 불 켜진 골목 → 코타츠 위로 폴짝 올라가 조는 고양이 (예시 방, 영상 안에서만) → 광장 트리 앞 고양이들 →
// 입주 수가 올라가고 "다음 섬까지 남은 집" (HUD 의 "다음 섬까지 N마리"와 같은 계산) → "댓글에 입주".
// 나레이션 src/app/reels/winter-voice.mp3 (ElevenLabs Yeonhee, eleven_v4, 25.1초, 숫자/이름은 말하지 않아 겨울 내내 쓴다).
// 문장 시간은 silencedetect 로 잰 값이다. 파일을 바꾸면 WINTER_LINES 도 고친다 (컷 경계도 여기서 나온다).
const WINTER_VOICE_AT = 0.3;
const WINTER_LINES: [number, number, string][] = [
  [0.1, 4.55, '추운 겨울밤,\n고양이섬에는 눈이 소복소복 쌓여요'], // 0
  [5.24, 7.91, '집집마다 반짝반짝 불이 켜지고요'], // 1
  [8.43, 12.26, '고양이는 따뜻한 코타츠 위에서\n꾸벅꾸벅 졸아요'], // 2
  [12.84, 15.69, '광장 트리 앞에는\n이웃 고양이들이 모였어요!'], // 3
  [16.01, 18.13, '벌써 이만큼이나 입주했어요'], // 4
  [18.5, 20.67, '이 섬 빈 집이 얼마 안 남았어요!'], // 5
  [21.03, 24.87, "댓글에 '입주'라고 남기면,\n따뜻한 집 한 채를 드릴게요"], // 6
];

/** 코타츠 방 (예시 방, 영상 안에서만). 벽은 뒤쪽(z=-4)과 왼쪽(x=-4), 카메라는 앞 오른쪽에서 본다 */
const WINTER_ROOM: InteriorItem[] = [
  { id: 'cine-kotatsu', type: 'kotatsu', x: 0.3, z: 0.3, rotY: 0 },
  { id: 'cine-tree', type: 'xmas_tree', x: -3.0, z: -3.0, rotY: 0.6 },
  { id: 'cine-sofa', type: 'sofa', x: -3.1, z: -0.4, rotY: Math.PI / 2 },
  { id: 'cine-lamp', type: 'floor_lamp', x: -3.3, z: 1.3, rotY: 0 },
  { id: 'cine-shelf', type: 'bookshelf', x: -0.9, z: -3.4, rotY: 0 },
  { id: 'cine-record', type: 'record_player', x: 0.8, z: -3.4, rotY: 0 },
  { id: 'cine-tower', type: 'cat_tower', x: 3.0, z: -3.0, rotY: -0.5 },
  { id: 'cine-plant', type: 'plant', x: 2.0, z: -3.5, rotY: 0 },
  { id: 'cine-window', type: 'window', x: 2.2, z: -4, rotY: 0 },
];

/** 겨울밤 썸네일 방: 코타츠를 카메라 쪽으로 돌리고, 트리와 밤 창문이 고양이 뒤로 오게 */
const WINTER_THUMB_ROOM: InteriorItem[] = [
  { id: 'cine-kotatsu', type: 'kotatsu', x: 0.3, z: 0.3, rotY: 0.72 },
  { id: 'cine-tree', type: 'xmas_tree', x: -2.4, z: -1.5, rotY: 0.6 },
  { id: 'cine-window', type: 'window', x: 0.2, z: -4, rotY: 0 },
  { id: 'cine-lamp', type: 'floor_lamp', x: -3.3, z: 0.6, rotY: 0 },
  { id: 'cine-sofa', type: 'sofa', x: -1.6, z: -3.3, rotY: 0 },
  { id: 'cine-plant', type: 'plant', x: 1.4, z: -3.5, rotY: 0 },
  { id: 'cine-record', type: 'record_player', x: 2.4, z: -3.4, rotY: 0 },
];

/** 코타츠 방에 쓸 가짜 집 (가장 최근 입주 집 옆 빈 집을 영상/사진 안에서만 치즈 고양이 집으로) */
function winterRoomHouse(newestNo: number | null): House {
  const residents = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle);
  const heroNo = newestNo ?? residents.sort((a, b) => b.houseNo - a.houseNo)[0]?.houseNo ?? 1;
  return {
    houseNo: pickEmptyNextDoor(heroNo),
    igHandle: '',
    roofColor: '#ffb04d',
    region: '' as RegionId,
    cat: { pattern: 'cheese', fur: '#f4a24a', eyeColor: '#5fbf6a' },
    likes: 0,
    isNpc: false,
    verified: false,
  };
}

function buildWinterReel(newestNo: number | null): Reel {
  const G = GROUND_Y;
  const A = WINTER_VOICE_AT;
  const L = (i: number) => A + WINTER_LINES[i][0];
  const residents = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle);
  const heroNo = newestNo ?? residents.sort((a, b) => b.houseNo - a.houseNo)[0]?.houseNo ?? 1;
  const { hs, nb } = heroFrame(heroNo);
  const doorX = hs.x + Math.sin(hs.rot) * 0.6;
  const doorZ = hs.z + Math.cos(hs.rot) * 0.6;
  // 코타츠 방은 빈 집 하나를 영상 안에서만 치즈 고양이 집으로 바꿔 쓴다 (진짜 주민 집 안은 건드리지 않는다)
  const roomNo = pickEmptyNextDoor(heroNo);
  const fake: House = {
    houseNo: roomNo,
    igHandle: '',
    roofColor: '#ffb04d',
    region: '' as RegionId,
    cat: { pattern: 'cheese', fur: '#f4a24a', eyeColor: '#5fbf6a' },
    likes: 0,
    isNpc: false,
    verified: false,
  };
  const total = totalHouses();
  const left = toNextIsland();

  const t1 = L(1) - 0.2; // 불 켜진 골목
  const t2 = L(2) - 0.25; // 코타츠
  const t3 = L(3) - 0.25; // 광장
  const t4 = L(4) - 0.2; // 입주 수, 남은 집
  const t6 = L(6) - 0.2; // 댓글에 입주
  const tEnd = A + 24.87 + 2.2;

  const sq = townSquares(1)[0] ?? { x: TOWN_SQUARE.x, z: TOWN_SQUARE.z };
  const gx = sq.x;
  const gz = sq.z + 5.2;

  let inside = false;
  const enterRoom = () => {
    const sc = state.scene;
    sc.setHouses(withMine(fake));
    sc.setWalkMode(true, roomNo);
    sc.enterHouse(roomNo, WINTER_ROOM, 'stripe', 'carpet', false);
    // 코타츠 앞에서 코타츠 쪽(-z)을 보고 선다. 조금 뒤 폴짝 올라간다
    sc.setLocalPosition(0.3, 1.55, Math.PI);
    inside = true;
  };
  const leaveRoom = () => {
    if (!inside) return;
    inside = false;
    state.scene.sitOnSeat(null);
    state.scene.setWalkMode(false);
    pushHousesToScene(true);
    // 걷기 모드를 껐다 켜면 가짜 접속자가 지워지므로 광장 고양이들을 다시 세운다
    state.scene.setRemotePlayers(crowd);
  };

  const shots: Shot[] = [
    {
      id: 'winter-hook',
      label: '눈 오는 밤',
      dur: t1,
      fade: 0.04,
      night: true,
      // 눈 내리는 동네 위에서 천천히 내려온다
      pose: (u) => ({ x: nb.x, y: G, z: nb.z, yaw: hs.rot + lerp(1.0, 0.55, u), pitch: lerp(0.95, 0.62, u), dist: lerpDist(85, 40, u), fov: 38 }),
    },
    {
      id: 'winter-lights',
      label: '불 켜진 골목',
      dur: t2 - t1,
      fade: 0.15,
      night: true,
      // 집 앞 골목을 낮게 지나간다 (LED, 창문 불빛)
      pose: (u) => ({ x: doorX, y: G + 1.6, z: doorZ, yaw: hs.rot + lerp(0.75, -0.35, u), pitch: lerp(0.3, 0.24, u), dist: lerpDist(17, 12, u), fov: 40 }),
    },
    {
      id: 'winter-kotatsu',
      label: '코타츠 고양이',
      dur: t3 - t2,
      fade: 0.15,
      night: true,
      enter: enterRoom,
      // 코타츠 위 고양이 가까이에서 시작해 트리가 보이게 방 쪽으로 물러난다
      pose: (u) => ({ x: lerp(0.05, -0.4, u), y: lerp(0.2, 0.55, u), z: lerp(0.5, 0.0, u), yaw: lerp(0.25, 0.7, u), pitch: lerp(0.34, 0.5, u), dist: lerpDist(4.2, 11, u), fov: 40 }),
    },
    {
      id: 'winter-square',
      label: '광장 트리',
      dur: t4 - t3,
      fade: 0.18,
      night: true,
      enter: leaveRoom,
      pose: (u) => {
        const yaw = lerp(-0.2, 0.35, u);
        return { x: gx + Math.sin(yaw) * 1.0, y: G + 0.6, z: gz + Math.cos(yaw) * 1.0, yaw, pitch: lerp(0.42, 0.36, u), dist: lerpDist(14, 11.5, u), fov: 40 };
      },
    },
    {
      id: 'winter-count',
      label: '남은 집',
      dur: t6 - t4,
      fade: 0.15,
      night: true,
      // 광장에서 동네 위로 올라가며 불 켜진 집들과 빈 집들을 보여 준다
      pose: (u) => ({ x: lerp(gx, nb.x, u), y: G + 0.5, z: lerp(gz, nb.z, u), yaw: lerp(0.3, 1.1, u), pitch: lerp(0.45, 0.85, u), dist: lerpDist(14, 75, u), fov: 38 }),
    },
    {
      id: 'winter-cta',
      label: '댓글에 입주',
      dur: tEnd - t6,
      fade: 0.2,
      night: true,
      pose: (u) => ({ x: lerp(nb.x, doorX, u), y: G + 1, z: lerp(nb.z, doorZ, u), yaw: hs.rot + lerp(1.1, 0.4, u), pitch: lerp(0.8, 0.55, u), dist: lerpDist(70, 30, u), fov: 38 }),
    },
  ];

  // 광장 트리 앞 고양이들 (진짜 주민 고양이, 가짜 접속자로 영상 안에서만)
  const crowdSrc = residents.slice(0, 7);
  const ACTS: Array<Pick<RemotePlayer, 'anim' | 'dance'>> = [{ anim: 'sit' }, { anim: 'idle', dance: 'sway' }, { anim: 'idle' }, { anim: 'sit' }, { anim: 'idle', dance: 'hop' }, { anim: 'idle' }, { anim: 'sit' }];
  const crowd: RemotePlayer[] = crowdSrc.map((h, i) => {
    const a = (i / crowdSrc.length) * Math.PI * 2 + 0.3;
    const r = 1.25 + (i % 2) * 0.45;
    const x = gx + Math.sin(a) * r;
    const z = gz + Math.cos(a) * r;
    const rotY = z > gz ? (x > gx ? -0.7 : 0.7) : Math.atan2(gx - x, gz - z);
    return { id: `cine-wn${i}`, houseNo: h.houseNo, handle: h.igHandle!, x, z, rotY, cat: h.cat, ...ACTS[i % ACTS.length] };
  });

  // 입주 수가 0 에서 올라간다 (1.4초)
  const c0 = t4 + 0.25;
  const tick = (t: number) => {
    if (t < c0 || t > L(5)) return;
    const k = clamp01((t - c0) / 1.4);
    const v = Math.round(total * (1 - Math.pow(1 - k, 3)));
    document.querySelectorAll('#cinema .cine-num').forEach((el) => {
      if (el.textContent !== String(v)) el.textContent = String(v);
    });
  };

  const overlays: Overlay[] = [
    {
      at: 0,
      end: t1 - 0.08,
      cls: 'cine-hook cine-series-hook',
      html: `추운 겨울밤엔<br /><b>고양이섬</b> ❄️<small>눈 오는 밤의 작은 마을</small>`,
      // 광장 고양이들은 처음부터 세워 둔다 (나타나는 시간이 있어서)
      run: () => state.scene.setRemotePlayers(crowd),
    },
    // 방에 들어오고 조금 뒤 코타츠 위로 폴짝
    { at: t2 + 0.55, end: t2 + 1.2, cls: 'cine-none', html: '', sfx: 'pop', pitch: 0.7, run: () => state.scene.sitOnSeat('cine-kotatsu') },
    { at: t2 + 1.3, end: t3 - 0.15, cls: 'cine-chips cine-decor-chips', html: `<span>🍊 코타츠</span><span>🎄 트리</span><span>💤 꾸벅꾸벅</span>` },
    { at: t3 + 0.1, end: t3 + 2.2, cls: 'cine-card cine-square', html: `<small>메리 크리스마스</small><b>마을 광장 🎄</b>`, sfx: 'chime' },
    {
      at: t4 + 0.15,
      end: L(5) - 0.1,
      cls: 'cine-count',
      html: `<small>고양이섬 주민</small><b class="cine-num">0</b><em>마리 입주 🎉</em>`,
      sfx: 'riser',
    },
    {
      at: L(5) - 0.05,
      end: t6 - 0.1,
      cls: 'cine-founder cine-left',
      html: `<i>🏠</i><b>남은 빈 집</b><em>${left}채</em><span>다 차면 다음 섬이 열려요</span>`,
      sfx: 'pop',
    },
    { at: t6 + 0.2, end: 99, cls: 'cine-cta', html: `<span>댓글에</span> <b>'입주'</b><em>따뜻한 집 한 채 드려요 🏡</em>`, sfx: 'pop' },
  ];

  return {
    shots,
    heroNo: null,
    voice: winterVoiceUrl,
    voiceAt: A,
    caps: WINTER_LINES.map(([a, b, text]) => ({ at: A + a, end: A + b + 0.25, text })),
    overlays,
    tick,
    cleanup: () => {
      leaveRoom();
      state.scene.setRemotePlayers([]);
      pushHousesToScene(true);
    },
  };
}

// ── 노는 하루 릴스 "고양이섬에선 하루 종일 뭐 해?" (2026-11-24) ──
// 사용자가 고른 주제: 섬에서 노는 하루. 부두 낚시 → 풀숲 곤충 → 동굴 보석 → 잡화점에 팔아 츄르 → 츄르로 가구 사서 마당 꾸미기 → 댓글에 입주.
// 주인공은 겨울밤 릴스와 같은 가짜 집(가장 최근 입주 집 옆 빈 집을 영상 안에서만 치즈 고양이 집으로). 낚시/곤충/동굴은 진짜 씬 그대로
// 걷기 모드로 찍는다 (씬 setCinemaCamera 가 걷기/동굴에서도 듣게 했다). 잡은 것과 츄르 숫자는 영상 안에서만 (지갑은 건드리지 않는다).
// 나레이션 src/app/reels/play-voice.mp3 (ElevenLabs Yeonhee, eleven_v4, 21.6초, 숫자/이름 안 말함). 문장 시간은 silencedetect 로 잰 값.
const PLAY_VOICE_AT = 0.3;
const PLAY_LINES: [number, number, string][] = [
  [0.0, 2.6, '고양이섬에선 하루 종일 뭐 하냐면요?'], // 0
  [2.72, 4.96, '아침엔 부두에서 낚시를 하고요'], // 1
  [5.17, 6.39, '앗, 큰 거 잡았다!'], // 2
  [6.87, 9.09, '풀숲에서 반짝이는 나비도 잡아요'], // 3
  [9.53, 11.63, '동굴에 들어가면 보석이 숨어 있고요!'], // 4
  [12.08, 14.45, '잡은 걸 가게에 팔면 츄르가 생겨요'], // 5
  [14.88, 17.26, '츄르로 가구를 사서 우리 집을 꾸며요'], // 6
  [17.7, 21.36, "댓글에 '입주'라고 남기면,\n오늘부터 같이 놀 수 있어요!"], // 7
];

/** 마당에 하나씩 놓이는 가구 (마당 좌표, 앞이 +z, 집 몸체는 z -3~0) */
const PLAY_YARD: PlacedItem[] = [
  { id: 'cine-y-hammock', type: 'hammock', x: -1.7, z: 1.3, rotY: 0.3 },
  { id: 'cine-y-tower', type: 'cat_tower', x: 2.2, z: 0.6, rotY: -0.5 },
  { id: 'cine-y-lantern', type: 'lantern', x: -2.5, z: 2.6, rotY: 0 },
  { id: 'cine-y-plant', type: 'plant', x: 2.5, z: 2.5, rotY: 0 },
  { id: 'cine-y-cushion', type: 'cushion', x: 0.6, z: 1.6, rotY: 0 },
];

function buildPlayReel(newestNo: number | null): Reel {
  const G = GROUND_Y;
  const A = PLAY_VOICE_AT;
  const L = (i: number) => A + PLAY_LINES[i][0];
  const fake = winterRoomHouse(newestNo);
  const homeNo = fake.houseNo;
  const hs = houseSlot(homeNo);
  const nb = neighborhoodArea(hs.neighborhood);
  const fx = Math.sin(hs.rot);
  const fz = Math.cos(hs.rot);
  // 대문 앞 (씬 setWalkMode 가 세우는 자리와 같다)
  const gate = { x: hs.x + fx * (3.6 + 1.3), z: hs.z + fz * (3.6 + 1.3) };

  // 부두 끝: 바다 쪽을 보고 앉아 낚시
  const dock = dockArea();
  const dDir = Math.sign(dock.z1 - dock.z0) || 1;
  const fishX = dock.x;
  const fishZ = dock.z1 - dDir * 0.8;
  const fishYaw = dDir > 0 ? 0 : Math.PI;
  // 곤충: 집 앞 길에서 조금 더 나간 풀밭
  const bugX = gate.x + fx * 2.2;
  const bugZ = gate.z + fz * 2.2;
  // 잡화점 가판대 (1구역 광장)
  const sq = townSquares(1)[0];
  const st = sq.stalls.find((s) => s.kind === 'shop') ?? sq.stalls[0];
  const sfx = Math.sin(st.rot);
  const sfz = Math.cos(st.rot);
  const shopCat = { x: st.x + sfx * 3.0, z: st.z + sfz * 3.0 };
  const shopMid = { x: st.x + sfx * 2.2, z: st.z + sfz * 2.2 };
  const shopNpcs = townNpcs(state.unlockedZones)
    .filter((n) => Math.hypot(n.x - sq.x, n.z - sq.z) < sq.r + 4)
    .map(toSceneNpc);

  const t1 = L(1) - 0.2; // 낚시
  const t3 = L(3) - 0.25; // 곤충
  const t4 = L(4) - 0.25; // 동굴
  const t5 = L(5) - 0.25; // 팔기
  const t6 = L(6) - 0.25; // 꾸미기
  const t7 = L(7) - 0.2; // 댓글에 입주
  const tEnd = A + 21.36 + 2.0;

  const sc = () => state.scene;
  let inCave = false;
  const leaveCave = () => {
    if (!inCave) return;
    inCave = false;
    sc().exitCave();
  };

  const BUGS_HERE: SceneBug[] = [
    { id: 'cine-bug-tiger', kind: 'fly', x: bugX + fx * 1.0, z: bugZ + fz * 1.0, color: '#ffbf3a', size: 2.2 },
    { id: 'cine-bug-blue', kind: 'fly', x: bugX - fz * 2.2 + fx * 1.6, z: bugZ + fx * 2.2 + fz * 1.6, color: '#4aa8ff', size: 1.9 },
    { id: 'cine-bug-yellow', kind: 'fly', x: bugX + fz * 2.0 + fx * 0.8, z: bugZ - fx * 2.0 + fz * 0.8, color: '#ffd84a', size: 1.6 },
    { id: 'cine-bug-lady', kind: 'ground', x: bugX + fz * 0.9 + fx * 0.5, z: bugZ - fx * 0.9 + fz * 0.5, color: '#e8463c', size: 1.1 },
  ];
  const CAVE_HERE: CaveNode[] = [
    { id: 'cine-ore-amethyst', x: 0.2, z: -0.9, color: '#b07ce8', size: 1.35 },
    { id: 'cine-ore-gold', x: -2.4, z: -2.0, color: '#ffcf3f', size: 1.1 },
    { id: 'cine-ore-iron', x: 2.6, z: -1.6, color: '#a8adbb', size: 1.0 },
    { id: 'cine-ore-copper', x: -1.2, z: -4.6, color: '#d9884e', size: 0.9 },
    { id: 'cine-ore-amethyst2', x: 2.0, z: -5.2, color: '#b07ce8', size: 1.0 },
    { id: 'cine-ore-diamond', x: -3.6, z: -5.6, color: '#8fe3ff', size: 1.2 },
  ];

  const shots: Shot[] = [
    {
      id: 'play-hook',
      label: '노는 하루',
      dur: t1,
      fade: 0.04,
      enter: () => {
        sc().setHouses(withMine(fake));
        sc().setWalkMode(true, homeNo);
      },
      // 동네 위에서 천천히 내려온다
      pose: (u) => ({ x: nb.x, y: G, z: nb.z, yaw: hs.rot + lerp(0.9, 0.5, u), pitch: lerp(0.9, 0.62, u), dist: lerpDist(80, 42, u), fov: 38 }),
    },
    {
      id: 'play-fish',
      label: '부두 낚시',
      dur: t3 - t1,
      fade: 0.15,
      enter: () => {
        sc().setLocalPosition(fishX, fishZ, fishYaw);
        sc().setFishing('cast');
      },
      // 고양이 옆 뒤에서, 고양이와 찌가 같이 보이게
      pose: (u) => {
        const yaw = fishYaw + Math.PI + lerp(1.05, 0.75, u);
        return { x: fishX, y: G + 0.5, z: fishZ + dDir * 1.1, yaw, pitch: lerp(0.3, 0.24, u), dist: lerpDist(8.5, 6.2, u), fov: 40 };
      },
    },
    {
      id: 'play-bug',
      label: '곤충 채집',
      dur: t4 - t3,
      fade: 0.15,
      enter: () => {
        sc().setFishing(null);
        sc().setLocalPosition(bugX, bugZ, hs.rot);
        sc().setBugs(BUGS_HERE);
      },
      pose: (u) => {
        const yaw = hs.rot + lerp(-0.9, -0.5, u);
        return { x: bugX + fx * 0.9, y: G + 0.75, z: bugZ + fz * 0.9, yaw, pitch: lerp(0.24, 0.18, u), dist: lerpDist(6.2, 4.6, u), fov: 40 };
      },
    },
    {
      id: 'play-cave',
      label: '동굴 보석',
      dur: t5 - t4,
      fade: 0.15,
      enter: () => {
        sc().setDance(null);
        sc().setBugs([]);
        sc().enterCave(2, CAVE_HERE);
        inCave = true;
        // 자수정 바위 앞에서 바위 쪽(-z)을 본다
        sc().setLocalPosition(0.2, 0.4, Math.PI);
      },
      // 동굴 좌표 (가운데가 원점, 앞 +z 가 나가는 길)
      pose: (u) => ({ x: 0.2, y: lerp(0.5, 0.35, u), z: lerp(-0.1, -0.3, u), yaw: lerp(0.55, 0.3, u), pitch: lerp(0.5, 0.4, u), dist: lerpDist(8, 5.2, u), fov: 42 }),
    },
    {
      id: 'play-sell',
      label: '잡화점 팔기',
      dur: t6 - t5,
      fade: 0.15,
      enter: () => {
        sc().setDance(null);
        leaveCave();
        sc().setLocalPosition(shopCat.x, shopCat.z, st.rot + Math.PI);
        sc().setNpcs(shopNpcs);
      },
      pose: (u) => {
        // 광장 쪽(가판대 앞)에서 고양이 등 너머로 가판대와 주인을 본다 (가판대 뒤는 나무가 막는다)
        const yaw = st.rot + lerp(0.6, 0.3, u);
        return { x: shopMid.x, y: G + 0.7, z: shopMid.z, yaw, pitch: lerp(0.32, 0.26, u), dist: lerpDist(8, 6.2, u), fov: 40 };
      },
    },
    {
      id: 'play-decor',
      label: '마당 꾸미기',
      dur: t7 - t6,
      fade: 0.15,
      enter: () => {
        sc().setNpcs([]);
        sc().setLocalPosition(gate.x, gate.z, hs.rot + Math.PI);
      },
      // 대문 앞에서 마당과 집을 본다
      pose: (u) => ({ x: hs.x + fx * 0.8, y: G + 0.7, z: hs.z + fz * 0.8, yaw: hs.rot + lerp(0.55, 0.2, u), pitch: lerp(0.42, 0.34, u), dist: lerpDist(15, 11.5, u), fov: 40 }),
    },
    {
      id: 'play-cta',
      label: '댓글에 입주',
      dur: tEnd - t7,
      fade: 0.2,
      enter: () => sc().setDance('hop'),
      // 꾸민 집에서 동네 위로 올라간다
      pose: (u) => ({ x: lerp(hs.x, nb.x, u), y: G + 0.8, z: lerp(hs.z, nb.z, u), yaw: hs.rot + lerp(0.2, 0.9, u), pitch: lerp(0.38, 0.8, u), dist: lerpDist(12, 60, u), fov: 38 }),
    },
  ];

  // 낚시 단계: 던지고 → 기다리고 → 입질 → 감기 → 잡았다
  const fishStage = (s: 'wait' | 'bite' | 'reel' | 'caught') => () => sc().setFishing(s);
  const yardUpTo = (n: number) => () => sc().setYardItemsFree(homeNo, PLAY_YARD.slice(0, n));
  const BAG = [
    { icon: '🐟', label: '참돔', price: 40 },
    { icon: '🦋', label: '호랑나비', price: 28 },
    { icon: '💎', label: '자수정', price: 32 },
  ];
  const earned = BAG.reduce((s, b) => s + b.price, 0);

  // 츄르 숫자가 0 에서 올라간다 (1.2초)
  const c0 = t5 + 1.2;
  const tick = (t: number) => {
    if (t < c0 || t > t6) return;
    const k = clamp01((t - c0) / 1.2);
    const v = Math.round(earned * (1 - Math.pow(1 - k, 3)));
    document.querySelectorAll('#cinema .cine-num').forEach((el) => {
      if (el.textContent !== `+${v}`) el.textContent = `+${v}`;
    });
  };

  const overlays: Overlay[] = [
    {
      at: 0,
      end: t1 - 0.08,
      cls: 'cine-hook cine-series-hook',
      html: `고양이섬에선<br /><b>하루 종일</b> 뭐 해? 🐾<small>오늘의 고양이 하루</small>`,
    },
    // 낚시
    { at: t1 + 0.7, end: t1 + 0.8, cls: 'cine-none', html: '', run: fishStage('wait') },
    { at: L(2) - 0.5, end: L(2) - 0.4, cls: 'cine-none', html: '', sfx: 'tick', run: fishStage('bite') },
    { at: L(2) - 0.05, end: L(2), cls: 'cine-none', html: '', run: fishStage('reel') },
    { at: L(2) + 0.6, end: t3 - 0.1, cls: 'cine-card', html: `<small>✨ 희귀 물고기</small><b>🐟 참돔 52cm!</b>`, sfx: 'sparkle', run: fishStage('caught') },
    // 곤충
    { at: t3 + 0.2, end: L(4) - 0.4, cls: 'cine-chips cine-decor-chips', html: `<span>🦋 호랑나비</span><span>🦋 파랑 나비</span><span>🐞 무당벌레</span>` },
    {
      at: L(3) + 1.5,
      end: t4 - 0.1,
      cls: 'cine-card',
      html: `<small>도감 등록!</small><b>🦋 호랑나비 잡았다</b>`,
      sfx: 'pop',
      run: () => {
        sc().setBugs(BUGS_HERE.filter((b) => b.id !== 'cine-bug-tiger'));
        sc().setDance('hop');
      },
    },
    // 동굴
    { at: t4 + 0.3, end: L(4) + 1.6, cls: 'cine-chips cine-decor-chips', html: `<span>⛏️ 동굴 2층</span><span>💎 반짝반짝</span>` },
    {
      at: L(4) + 1.4,
      end: t5 - 0.1,
      cls: 'cine-card',
      html: `<small>✨ 희귀 광석</small><b>💎 자수정 캤다!</b>`,
      sfx: 'sparkle',
      run: () => {
        sc().setCaveNodes(CAVE_HERE.filter((n) => n.id !== 'cine-ore-amethyst'));
        sc().setDance('hop');
      },
    },
    // 팔기
    { at: t5 + 0.2, end: t6 - 0.1, cls: 'cine-chips cine-decor-chips', html: BAG.map((b) => `<span>${b.icon} ${b.label} ${b.price}</span>`).join('') },
    { at: t5 + 1.0, end: t6 - 0.1, cls: 'cine-count', html: `<small>잡화점에 팔았어요</small><b class="cine-num">+0</b><em>츄르 💰</em>`, sfx: 'riser' },
    // 꾸미기: 가구가 하나씩 놓인다
    { at: t6 + 0.35, end: t6 + 0.4, cls: 'cine-none', html: '', sfx: 'pop', pitch: 0.5, run: yardUpTo(1) },
    { at: t6 + 0.85, end: t6 + 0.9, cls: 'cine-none', html: '', sfx: 'pop', pitch: 0.6, run: yardUpTo(2) },
    { at: t6 + 1.35, end: t6 + 1.4, cls: 'cine-none', html: '', sfx: 'pop', pitch: 0.7, run: yardUpTo(3) },
    { at: t6 + 1.85, end: t6 + 1.9, cls: 'cine-none', html: '', sfx: 'pop', pitch: 0.8, run: yardUpTo(4) },
    { at: t6 + 2.3, end: t6 + 2.35, cls: 'cine-none', html: '', sfx: 'pop', pitch: 0.9, run: yardUpTo(5) },
    { at: t6 + 0.3, end: t7 - 0.1, cls: 'cine-chips cine-decor-chips', html: `<span>🛒 해먹</span><span>🐾 캣타워</span><span>🏮 등불</span>` },
    { at: t7 + 0.2, end: 99, cls: 'cine-cta', html: `<span>댓글에</span> <b>'입주'</b><em>오늘부터 같이 놀아요 🐾</em>`, sfx: 'pop' },
  ];

  return {
    shots,
    heroNo: null,
    voice: playVoiceUrl,
    voiceAt: A,
    caps: PLAY_LINES.map(([a, b, text]) => ({ at: A + a, end: A + b + 0.25, text })),
    overlays,
    tick,
    cleanup: () => {
      const s = sc();
      s.setFishing(null);
      s.setDance(null);
      s.setBugs([]);
      s.setNpcs([]);
      leaveCave();
      s.setYardItemsFree(homeNo, []);
      s.setWalkMode(false);
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

/** 무늬별 기본 고양이 (섬에 그 무늬 주민이 없을 때) */
const THUMB_CATS: NonNullable<House['cat']>[] = [
  { pattern: 'cheese', fur: '#f4a650', eyeColor: '#5fbf6a' },
  { pattern: 'white', fur: '#fffaf2', eyeColor: '#6fb7e8' },
  { pattern: 'tuxedo', fur: '#35323a', eyeColor: '#7ac36a' },
  { pattern: 'gray', fur: '#a9adb8', eyeColor: '#f2c94c' },
  { pattern: 'black', fur: '#34313a', eyeColor: '#f2c94c' },
  { pattern: 'calico', fur: '#f0a04b', eyeColor: '#6fb7e8' },
];

/** 썸네일: 가장 최근 입주한 집 앞 길에 무늬가 다른 고양이 6마리 (뒷줄 3, 앞줄 3), 집이 뒤로 보이게 */
function buildThumbShot(): { pose: Pose; cats: RemotePlayer[] } {
  const G = GROUND_Y;
  const residents = [...state.houses.values()].filter((h) => !h.isNpc && h.igHandle);
  const heroNo = residents.sort((a, b) => b.houseNo - a.houseNo)[0]?.houseNo ?? 1;
  const hs = houseSlot(heroNo);
  const fx = Math.sin(hs.rot);
  const fz = Math.cos(hs.rot);
  const rx = Math.cos(hs.rot);
  const rz = -Math.sin(hs.rot);
  // 무늬마다 주민 고양이 하나 (없으면 기본)
  const cats = THUMB_CATS.map((def) => residents.find((h) => h.cat?.pattern === def.pattern)?.cat ?? def);
  const lookD = 4.2;
  const camD = lookD + Math.cos(0.24) * 10.5;
  const camX = hs.x + fx * camD;
  const camZ = hs.z + fz * camD;
  const spots: [number, number][] = [
    [-1.1, 4.4],
    [0, 4.25],
    [1.1, 4.4],
    [-0.75, 5.5],
    [0.2, 5.7],
    [1.0, 5.45],
  ];
  const players: RemotePlayer[] = spots.map(([side, d], i) => {
    const x = hs.x + fx * d + rx * side;
    const z = hs.z + fz * d + rz * side;
    return {
      id: `cine-thumb${i}`,
      houseNo: null,
      handle: '',
      x,
      z,
      rotY: Math.atan2(camX - x, camZ - z) + (i % 2 ? 0.25 : -0.2),
      anim: i === 1 || i === 4 ? 'sit' : 'idle',
      cat: cats[i],
    };
  });
  return {
    pose: { x: hs.x + fx * lookD, y: G + 1.0, z: hs.z + fz * lookD, yaw: hs.rot, pitch: 0.24, dist: 10.5, fov: 40 },
    cats: players,
  };
}

/** 꾸미기 썸네일 기본 집 (앞에 있을수록 먼저). 사용자가 고른 정돈된 집 */
const TIDY_THUMB = ['푸른곰팡이'];

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
  const voices = new Map([playVoiceUrl, winterVoiceUrl, decorVoiceUrl, seriesVoiceUrl, hookVoiceUrl, newcomerVoiceUrl].map((u) => [u, loadCineVoice(u)]));
  let newcomer: Newcomer | null = null;

  const root = document.createElement('div');
  root.id = 'cinema';
  root.innerHTML = `
    <div class="cine-ovl"></div>
    <div class="cine-cap" hidden><span></span></div>
    <div class="cine-black"></div>
    <div class="cine-panel">
      <h2>🎬 촬영 모드</h2>
      <p class="cine-lead">진짜 게임 화면에 카메라만 움직여요. <b>자동 녹화</b>가 켜져 있으면 화면 기록 없이 끝나자마자 영상 파일이 나와요.</p>
      <div class="cine-result" hidden></div>
      <button class="cine-go cine-play">🎣 노는 하루 릴스 <small>낚시, 곤충, 동굴, 츄르, 꾸미기 · 약 24초</small></button>
      <button class="cine-go cine-go-sub cine-winter">🌙 겨울밤 릴스 <small>코타츠 고양이, 남은 집 · 약 27초</small></button>
      <button class="cine-go cine-go-sub cine-winterthumb">🖼️ 겨울밤 썸네일 <small>코타츠 고양이, 글자 없이</small></button>
      <button class="cine-go cine-go-sub2 cine-decor">🎨 꾸미기 릴스 <small>지붕 그림, 집 안, 고양이 · 약 30초</small></button>
      <button class="cine-go cine-go-sub cine-series">📅 연재 릴스 <small>약 39초</small></button>
      <label class="cine-opt cine-day-row">연재 <b>Day</b> <input class="cine-day-in" type="number" min="1" inputmode="numeric" value="${seriesDay()}" /> <small>(날짜로 자동, 고칠 수 있어요)</small></label>
      <button class="cine-go cine-go-sub cine-thumb">🖼️ 썸네일 사진 <small>고양이 6마리, 글자 없이</small></button>
      <button class="cine-go cine-go-sub cine-decorthumb">🖼️ 꾸미기 썸네일 <small>입주 첫날 vs 지금, 글자 없이</small></button>
      <label class="cine-opt">썸네일 집 <select class="cine-thumb-house"><option value="">찾는 중…</option></select></label>
      <button class="cine-go cine-hookreel cine-go-sub2">🔥 첫 1초 릴스 <small>빈 집 → 내 집, 약 14초</small></button>
      <button class="cine-go cine-reel cine-go-sub2" disabled>📣 새 주민 릴스 <small class="cine-reel-who">찾는 중…</small></button>
      <p class="cine-reel-note">나레이션 목소리가 함께 나와요. 소리를 켜고 찍으세요.</p>
      <button class="cine-go cine-all cine-go-sub">▶ 섬 구경 이어서 찍기 <small>약 ${Math.round(shots.reduce((s, x) => s + x.dur, 0))}초</small></button>
      <div class="cine-shots">
        ${shots.map((s, i) => `<button class="cine-shot" data-i="${i}">${s.label}</button>`).join('')}
      </div>
      <label class="cine-opt"><input type="checkbox" data-o="rec" ${canRecord() ? 'checked' : 'disabled'} /> 🔴 자동 녹화 <small>${canRecord() ? '(끝나면 영상 파일로 저장)' : '(이 브라우저는 안 돼요. 화면 기록을 쓰세요)'}</small></label>
      <label class="cine-opt"><input type="checkbox" data-o="caps" checked /> 자막 넣기 <small>(릴스)</small></label>
      <label class="cine-opt"><input type="checkbox" data-o="tags" checked /> 집 이름표 보이기</label>
      <label class="cine-opt"><input type="checkbox" data-o="max" /> 아주 선명하게 <small>(해상도 3배, 폰이 버거워 끊길 수 있어요)</small></label>
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
  // 자동 녹화 (2026-11-19)
  const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
  const resultBox = $('.cine-result');
  let recWanted = false;
  let recording: Recording | null = null;
  let recLabel = 'reel';
  let resultUrl: string | null = null;
  let thumbPose: Pose | null = null;

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
    if (thumbPose) {
      scene.setCinemaCamera(toCamera(thumbPose, 0));
      return;
    }
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
    // 자동 녹화: 앞의 검은 화면은 빼고 여기서부터 찍는다
    if (recWanted && !recording) {
      recWanted = false;
      recording = startRecording(scene, sceneCanvas, root);
      if (!recording) stopRecordAudio();
    }
    drawReelText(t);
    let i = 0;
    while (i < playlist.length && t >= playlist[i].dur) {
      t -= playlist[i].dur;
      i++;
    }
    if (i >= playlist.length) {
      // 끝: 검게 두었다가 패널을 다시 보인다 (녹화는 마지막 컷이 끝난 순간 멈춘다)
      setBlack(1);
      if (recording) finishRecording();
      if (t > 0.9) stop();
      return;
    }
    const shot = playlist[i];
    if (i !== shotIndex) {
      shotIndex = i;
      // 밤 컷이 시작되면 해가 진다 (1.4초 동안). 낮 컷은 낮으로 (컷 사이 검은 동안 바뀐다)
      scene.setTimeOfDay(shot.night || (i > 0 && playlist[i - 1].night && shot.id === 'island') ? 'night' : 'day');
      shot.enter?.();
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
    // 자동 녹화: 소리 길은 지금 열어 둔다 (곧 틀 나레이션도 녹화로 가게). 영상은 검은 화면이 끝나면 시작
    recording?.cancel();
    recording = null;
    recWanted = ($('[data-o="rec"]') as HTMLInputElement).checked && canRecord();
    if (recWanted) startRecordAudio();
    resultBox.hidden = true;
    if (withReel && voice) stopVoice = playCineVoice(voice, 1.5 + withReel.voiceAt);
    playing = true;
  };

  const finishRecording = () => {
    const rec = recording;
    recording = null;
    if (!rec) return;
    const label = recLabel;
    void rec.stop().then((blob) => showResult(blob, label));
  };

  /** 녹화한 영상: 미리 보기 + 사진에 저장(공유) + 내려받기 */
  const showResult = (blob: Blob | null, label: string) => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    if (!blob) {
      resultBox.innerHTML = '<p class="cine-lead">녹화가 안 됐어요. 폰의 화면 기록으로 찍어 주세요.</p>';
      resultBox.hidden = false;
      return;
    }
    const name = videoFileName(blob, label);
    resultUrl = URL.createObjectURL(blob);
    const file = new File([blob], name, { type: blob.type });
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    resultBox.innerHTML = `
      <p class="cine-result-h">🎬 녹화 완료 <small>${(blob.size / 1048576).toFixed(1)}MB · ${blob.type.includes('mp4') ? 'MP4' : 'WebM'}</small></p>
      <video src="${resultUrl}" controls playsinline muted></video>
      <div class="cine-result-btns">
        ${canShare ? '<button class="cine-go cine-save">📲 사진에 저장 / 공유</button>' : ''}
        <a class="cine-go cine-go-sub cine-down" href="${resultUrl}" download="${name}">⬇ 내려받기</a>
      </div>
      ${blob.type.includes('mp4') ? '' : '<p class="cine-reel-note">WebM 파일이에요. 인스타에 안 올라가면 폰(사파리)에서 다시 찍으면 MP4 로 나와요.</p>'}`;
    resultBox.hidden = false;
    resultBox.querySelector('.cine-save')?.addEventListener('click', () => {
      void navigator.share({ files: [file] }).catch(() => {});
    });
    panel.scrollTop = 0;
  };

  // ── 썸네일 사진 (2026-11-19): 집 앞에 무늬가 다른 고양이 6마리. 글자는 사용자가 따로 넣는다 ──
  const thumbBtn = $<HTMLButtonElement>('.cine-thumb');
  thumbBtn.addEventListener('click', () => {
    if (playing) return;
    thumbBtn.disabled = true;
    const shot = buildThumbShot();
    const max = ($('[data-o="max"]') as HTMLInputElement).checked;
    scene.setCinemaQuality(max ? 'max' : 'high');
    scene.setNameTags(false);
    scene.setTimeOfDay('day');
    scene.setRemotePlayers(shot.cats);
    panel.hidden = true;
    resultBox.hidden = true;
    thumbPose = shot.pose;
    // 고양이가 나타나고 그림자가 자리 잡을 때까지 기다렸다가 한 장
    setTimeout(() => {
      scene.onAfterRender(() => {
        scene.onAfterRender(null);
        const c = document.createElement('canvas');
        c.width = sceneCanvas.width;
        c.height = sceneCanvas.height;
        c.getContext('2d')?.drawImage(sceneCanvas, 0, 0);
        c.toBlob((blob) => {
          thumbPose = null;
          scene.setRemotePlayers([]);
          scene.setNameTags(true);
          panel.hidden = false;
          thumbBtn.disabled = false;
          showPhoto(blob);
        }, 'image/png');
      });
    }, 2200);
  });

  // 썸네일 집 고르기: 꾸민 방 목록. 기본은 정돈된 집 (2026-11-20 사용자: "오레오 집 말고 정돈된 집으로")
  const thumbHouse = $<HTMLSelectElement>('.cine-thumb-house');
  void fetchShowcase().then((d) => {
    const list = d.rooms.filter((x) => state.houses.has(x.houseNo));
    thumbHouse.innerHTML = list.length ? list.map((x) => `<option value="${x.houseNo}">${esc(x.handle)} (${x.room.length}개)</option>`).join('') : '<option value="">꾸민 집이 없어요</option>';
    const tidy = list.find((x) => TIDY_THUMB.includes(x.handle));
    if (tidy) thumbHouse.value = String(tidy.houseNo);
  });
  // ── 꾸미기 썸네일 (2026-11-20): 같은 방을 같은 자리에서 두 번 찍어 위(빈 방 = 입주 첫날) / 아래(꾸민 방 = 지금)로 붙인다 ──
  const decorThumbBtn = $<HTMLButtonElement>('.cine-decorthumb');
  /** 다음 그림 한 장을 캔버스로 복사 */
  const grab = () =>
    new Promise<HTMLCanvasElement>((ok) => {
      scene.onAfterRender(() => {
        scene.onAfterRender(null);
        const c = document.createElement('canvas');
        c.width = sceneCanvas.width;
        c.height = sceneCanvas.height;
        c.getContext('2d')?.drawImage(sceneCanvas, 0, 0);
        ok(c);
      });
    });
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  decorThumbBtn.addEventListener('click', () => {
    if (playing || thumbPose) return;
    decorThumbBtn.disabled = true;
    void (async () => {
      const data = await fetchShowcase();
      const pickNo = Number(thumbHouse.value);
      const r = data.rooms.find((x) => x.houseNo === pickNo && state.houses.has(x.houseNo)) ?? data.rooms.find((x) => state.houses.has(x.houseNo));
      if (!r) {
        decorThumbBtn.disabled = false;
        resultBox.innerHTML = '<p class="cine-lead">꾸민 집 안이 아직 없어요.</p>';
        resultBox.hidden = false;
        return;
      }
      const half = r.big ? 5.5 : 4;
      const k = half / 4;
      const max = ($('[data-o="max"]') as HTMLInputElement).checked;
      scene.setCinemaQuality(max ? 'max' : 'high');
      scene.setNameTags(false);
      scene.setTimeOfDay('day');
      panel.hidden = true;
      resultBox.hidden = true;
      pinDrawings([...r.room.map((i) => i.drawingId), surfaceDrawing(r.wallpaper), surfaceDrawing(r.floor)]);
      // 방 전체가 화면 가운데 절반 높이 안에 들어오게 조금 멀리서 (절반씩 잘라 붙인다)
      thumbPose = { x: 0.45 * k, y: 0.9, z: -0.35 * k, yaw: 0.6, pitch: 0.62, dist: 27 * k, fov: 40 };
      const cat = { x: 0.2, z: half - 1.6, yaw: 0.5 };
      // 입주 첫날: 빈 방 (기본 벽지, 바닥)
      scene.setWalkMode(true, r.houseNo);
      scene.enterHouse(r.houseNo, [], 'cream', 'wood', r.big);
      scene.setLocalPosition(cat.x, cat.z, cat.yaw);
      scene.setSitting(true);
      await wait(1800);
      const before = await grab();
      // 지금: 같은 방, 같은 자리
      scene.enterHouse(r.houseNo, r.room, r.wallpaper, r.floor, r.big);
      scene.setLocalPosition(cat.x, cat.z, cat.yaw);
      await wait(2600);
      const after = await grab();
      scene.setSitting(false);
      scene.setWalkMode(false);
      pinDrawings([]);
      thumbPose = null;
      scene.setNameTags(true);
      panel.hidden = false;
      decorThumbBtn.disabled = false;
      // 붙이기: 각 캡처의 가운데 절반 높이를 잘라 위/아래에. 방이 가운데 줄 쪽으로 조금 모이게 (프로필 격자 3:4 에서 덜 잘리게)
      const W = before.width;
      const H = before.height;
      const h = Math.round(H / 2);
      const shift = Math.round(H * 0.035);
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      const top0 = Math.round(H / 2 - h / 2);
      ctx.drawImage(before, 0, top0 - shift, W, h, 0, 0, W, h);
      ctx.drawImage(after, 0, top0 + shift, W, h, 0, h, W, H - h);
      // 가운데 가르는 줄
      ctx.fillStyle = '#fffaf0';
      ctx.fillRect(0, h - Math.round(H * 0.004), W, Math.round(H * 0.008));
      out.toBlob((blob) => showPhoto(blob, '위는 입주 첫날(빈 방), 아래는 지금(꾸민 방)이에요. 가운데 줄 근처나 위아래 끝에 "입주 첫날 → 지금" 같은 글자를 넣으세요. 프로필 격자에서는 가운데 3:4 만 보여요.', 'decorthumb'), 'image/png');
    })();
  });

  // ── 겨울밤 썸네일 (2026-11-21): 밤, 코타츠 위에 앉은 치즈 고양이 + 뒤에 트리와 밤 창문. 위쪽 1/3 은 글자 자리로 비운다 ──
  const winterThumbBtn = $<HTMLButtonElement>('.cine-winterthumb');
  winterThumbBtn.addEventListener('click', () => {
    if (playing || thumbPose) return;
    winterThumbBtn.disabled = true;
    void (async () => {
      const fake = winterRoomHouse(newcomer?.houseNo ?? null);
      const max = ($('[data-o="max"]') as HTMLInputElement).checked;
      scene.setCinemaQuality(max ? 'max' : 'high');
      scene.setNameTags(false);
      scene.setTimeOfDay('night');
      panel.hidden = true;
      resultBox.hidden = true;
      scene.setHouses(withMine(fake));
      scene.setWalkMode(true, fake.houseNo);
      scene.enterHouse(fake.houseNo, WINTER_THUMB_ROOM, 'stripe', 'carpet', false);
      // 코타츠 앞(카메라 쪽)에서 코타츠를 보고 섰다가 폴짝 올라간다
      scene.setLocalPosition(1.2, 1.3, 0.72 + Math.PI);
      // 고양이를 화면 아래쪽 가운데, 트리를 뒤 왼쪽에 (위쪽은 벽과 창문 = 글자 자리)
      thumbPose = { x: -0.1, y: 1.35, z: 0.35, yaw: 0.72, pitch: 0.14, dist: 4.4, fov: 42 };
      await wait(700);
      scene.sitOnSeat('cine-kotatsu');
      await wait(2600);
      const shot = await grab();
      scene.sitOnSeat(null);
      scene.setWalkMode(false);
      pushHousesToScene(true);
      thumbPose = null;
      scene.setTimeOfDay('day');
      scene.setNameTags(true);
      panel.hidden = false;
      winterThumbBtn.disabled = false;
      shot.toBlob(
        (blob) => showPhoto(blob, '위쪽 벽 자리에 "추운 밤엔 고양이섬 ❄️", 아래나 옆에 작은 띠로 "남은 집 N채"(설정의 다음 섬까지 숫자)를 넣으세요. 프로필 격자에서는 가운데 3:4 만 보여요.', 'winterthumb'),
        'image/png',
      );
    })();
  });

  const showPhoto = (blob: Blob | null, note = '위쪽 하늘/길 자리에 글자를 넣으세요. 프로필 격자에서는 가운데 3:4 만 보여요.', tag = 'thumb') => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    if (!blob) return;
    resultUrl = URL.createObjectURL(blob);
    const d = new Date(Date.now() + 9 * 3600_000).toISOString();
    const name = `goyangi_${tag}_${d.slice(0, 10)}_${d.slice(11, 13)}${d.slice(14, 16)}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    resultBox.innerHTML = `
      <p class="cine-result-h">🖼️ 썸네일 사진 <small>${sceneCanvas.width}×${sceneCanvas.height}</small></p>
      <img src="${resultUrl}" alt="썸네일 사진" />
      <div class="cine-result-btns">
        ${canShare ? '<button class="cine-go cine-save">📲 사진에 저장 / 공유</button>' : ''}
        <a class="cine-go cine-go-sub cine-down" href="${resultUrl}" download="${name}">⬇ 내려받기</a>
      </div>
      <p class="cine-reel-note">${note}</p>`;
    resultBox.hidden = false;
    resultBox.querySelector('.cine-save')?.addEventListener('click', () => {
      void navigator.share({ files: [file] }).catch(() => {});
    });
    panel.scrollTop = 0;
  };

  const stop = () => {
    if (recording) finishRecording();
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
    recLabel = 'newcomer';
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
      recLabel = `day${day}`;
      startReel(seriesBtn, () => buildSeriesReel(data, day));
    });
  });
  const decorBtn = $<HTMLButtonElement>('.cine-decor');
  decorBtn.addEventListener('click', () => {
    void unlockSound();
    decorBtn.disabled = true;
    void fetchShowcase().then((data) => {
      decorBtn.disabled = false;
      recLabel = 'decor';
      startReel(decorBtn, () => buildDecorReel(data));
    });
  });
  const playBtn = $<HTMLButtonElement>('.cine-play');
  playBtn.addEventListener('click', () => {
    recLabel = 'play';
    startReel(playBtn, () => buildPlayReel(newcomer?.houseNo ?? null));
  });
  const winterBtn = $<HTMLButtonElement>('.cine-winter');
  winterBtn.addEventListener('click', () => {
    recLabel = 'winter';
    startReel(winterBtn, () => buildWinterReel(newcomer?.houseNo ?? null));
  });
  const hookBtn = $<HTMLButtonElement>('.cine-hookreel');
  hookBtn.addEventListener('click', () => {
    recLabel = 'hook';
    startReel(hookBtn, () => buildHookReel(newcomer?.houseNo ?? null));
  });
  $('.cine-all').addEventListener('click', () => {
    recLabel = 'island';
    play(shots);
  });
  root.querySelectorAll<HTMLButtonElement>('.cine-shot').forEach((btn) => {
    btn.addEventListener('click', () => {
      recLabel = 'shot';
      play([shots[Number(btn.dataset.i)]]);
    });
  });

  scene.setNameTags(true);
  requestAnimationFrame(frame);
}
