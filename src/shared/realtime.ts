// 실시간(주변 유저 보이기) 서버와 화면이 같이 쓰는 약속. 메시지는 작게(짧은 키, 정수) 보낸다.
import type { FishingPose, PlayerAnim } from './types';

export const RT_PROTOCOL = 'ci.v1';
export const ANIMS: readonly PlayerAnim[] = ['idle', 'walk', 'sit', 'jump'];
/** 낚시 단계 번호 (0 = 낚시 안 함) */
export const FISH_POSES: readonly (FishingPose | null)[] = [null, 'cast', 'wait', 'bite', 'reel', 'caught'];

/** 내 고양이가 1초에 갈 수 있는 최대 거리 (걷기 최고 속도 약 4.7 + 점프, 지연 여유) */
export const MAX_SPEED = 9;
/** 이보다 크게 튀면 순간이동으로 보고 되돌린다 (월드 단위) */
export const MAX_JUMP = 4;
/** 한 연결이 1초에 보낼 수 있는 메시지 수 (MOVE_SEND_HZ 8 + 여유) */
export const MAX_MSG_PER_SEC = 14;
/** 구역 객체 하나에 붙을 수 있는 최대 연결 수 (넘으면 단독 모드) */
export const ZONE_CONN_MAX = 600;
/** 위치는 0.1 단위, 방향은 0.01 단위 정수로 보낸다 */
export const POS_SCALE = 10;
export const ROT_SCALE = 100;

// ── 묶어 보내기 (2026-11-15, 동접 500명 무료 한도) ──
// 위치를 1초에 8번 보내던 것을, SAMPLE_MS 마다 찍어 두었다가 서버가 정한 간격(si, 1~3초)마다 한 번에 묶어 보낸다.
// 받는 쪽은 그만큼 늦게(si + 여유) 되감아 보여 주므로 움직임은 부드럽다. 가만히 있으면 아무것도 보내지 않는다.
/** 내 위치를 찍는 간격 (ms) */
export const SAMPLE_MS = 250;
/** 한 메시지에 담는 지난 위치 수 상한 */
export const TRAIL_MAX = 12;
/** 서버가 정하는 보내기 간격 (ms): 사람이 많거나 오늘 많이 썼으면 길어진다 */
export const SEND_MS_MIN = 1000;
export const SEND_MS_MAX = 3000;
/** 구역 객체 하나의 하루 받는 메시지 예산 (20개 = 요청 1건, 무료 하루 10만 건). 넘어가면 간격을 늘린다 */
export const DAY_MSG_SOFT = 1_000_000;

/** 화면 → 서버 */
export type ClientMsg =
  /**
   * 내 위치: x, z (POS_SCALE 정수), r (ROT_SCALE 정수), a (ANIMS 번호), f (FISH_POSES 번호, 낚시 안 하면 생략).
   * p: 그 앞의 위치들 [x, z, r, x, z, r, ...] (오래된 것부터, i ms 간격, 마지막이 위의 x, z, r)
   */
  | { t: 'm'; x: number; z: number; r: number; a: number; f?: number; p?: number[]; i?: number }
  /** 방 안 메시지 (방에서만) */
  | { t: 'room'; d: unknown };

/** 유저 한 명의 위치: [id, x, z, r, a, f, q, i, p] (q: 위치 순번, 바뀌었을 때만 새 위치. i, p: 지난 위치 묶음) */
export type PlayerTuple =
  | [string, number, number, number, number]
  | [string, number, number, number, number, number]
  | [string, number, number, number, number, number, number, number, number[]];

/** 서버 → 화면 */
export type ServerMsg =
  /** 접속 완료. 내 연결 id, 방 이름, 서버 시각 */
  | { t: 'hello'; id: string; room: string; st: number }
  /** 처음 보이는 유저 정보: id, h(아이디), n(번지), c([털, 무늬, 눈]) */
  | { t: 'u'; u: Array<{ id: string; h: string; n: number | null; c: [string, string, string] | null }> }
  /** 지금 내게 보이는 유저 전체: [id, x, z, r, a, f?] (빠진 유저는 사라진 것. f 는 낚시 중일 때만 붙는다) */
  | { t: 's'; st: number; p: Array<PlayerTuple> }
  /** 보내기 간격 (ms). 바뀔 때마다 온다 */
  | { t: 'cfg'; si: number }
  /** 서버가 받아들이지 않은 위치. 이 위치로 되돌린다 */
  | { t: 'fix'; x: number; z: number }
  /** 방 안 메시지 */
  | { t: 'room'; from: string; d: unknown }
  /** 연결을 끊는 이유 (full: 꽉 참, replaced: 다른 창에서 접속, limit: 너무 많이 보냄) */
  | { t: 'bye'; reason: 'full' | 'replaced' | 'limit' | 'bad' };

/** 실시간 객체 이름: 구역은 'zone:3', 미니게임 방은 'room:test' */
export const zoneRoomName = (zone: number) => `zone:${zone}`;
export const gameRoomName = (id: string) => `room:${id}`;
export const ROOM_ID_RE = /^[a-z0-9-]{1,32}$/;
