/**
 * 춤 (2026-11-15). 고양이 모양은 그대로 두고 높이, 방향, 크기, 걸음 다리만 움직여 흉내 낸다.
 * 내 고양이(setDance)와 다른 유저(RemotePlayer.dance)가 같은 함수를 쓴다. 걷는 동안에는 춤을 멈춘다.
 */
export interface DanceMotion {
  /** 위로 뜨는 높이 */
  dy: number;
  /** 몸 방향에 더하는 각도 */
  dyaw: number;
  /** 크기 배율 */
  scale: number;
  /** 제자리 걸음 (다리 움직임). walk 가 0 이면 다리는 그대로 */
  phase: number;
  walk: number;
  /** 0~1 웃는 눈 */
  happy: number;
}

const out: DanceMotion = { dy: 0, dyaw: 0, scale: 1, phase: 0, walk: 0, happy: 0 };

/** t: 춤을 시작한 뒤 지난 초 */
export function danceMotion(id: string | null | undefined, t: number): DanceMotion | null {
  if (!id) return null;
  out.dy = 0;
  out.dyaw = 0;
  out.scale = 1;
  out.phase = 0;
  out.walk = 0;
  out.happy = 1;
  switch (id) {
    case 'wiggle':
      out.dyaw = Math.sin(t * 9) * 0.5;
      out.dy = Math.abs(Math.sin(t * 9)) * 0.05;
      break;
    case 'hop':
      out.dy = Math.abs(Math.sin(t * 5.2)) * 0.5;
      out.scale = 1 + Math.cos(t * 10.4) * 0.04;
      break;
    case 'sway':
      out.dyaw = Math.sin(t * 2.6) * 0.75;
      out.dy = Math.abs(Math.sin(t * 2.6)) * 0.08;
      out.phase = t * 3;
      out.walk = 0.35;
      break;
    case 'spin':
      out.dyaw = t * 7;
      out.dy = Math.abs(Math.sin(t * 7)) * 0.08;
      break;
    case 'tap':
      out.phase = t * 15;
      out.walk = 0.9;
      out.dy = Math.abs(Math.sin(t * 15)) * 0.05;
      out.dyaw = Math.sin(t * 1.8) * 0.4;
      break;
    case 'twirl': {
      const k = (t % 1.6) / 1.6;
      out.dy = Math.sin(k * Math.PI) * 0.75;
      out.dyaw = k * Math.PI * 4;
      out.scale = 1 + Math.sin(k * Math.PI * 2) * 0.05;
      break;
    }
    default:
      return null;
  }
  return out;
}
