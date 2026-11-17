import {
  BRIDGE,
  collidersNear,
  DOCK_DECK_Y,
  DOCK_HALF_W,
  dockArea,
  landAt,
  onDock,
  skipCollider,
  zoneAt,
  zoneCenter,
  type Collider,
} from '../layout';
import { GROUND_Y } from '../world/constants';
import { heightFromLand } from '../world/mapField';

/**
 * 내 고양이의 움직임: 조이스틱 입력 → 속도 → 위치, 그리고 막힌 곳 처리.
 *
 * 막힌 곳은 전부 단순한 도형이다.
 * - 원: 나무, 바위, 연못, 등불, 큰 꾸미기 아이템
 * - (돌아간) 네모: 집 몸체, 울타리, 벤치
 * - 바다: 해안 거리(landAt)가 MIN_LAND 보다 작은 곳. 다리 위는 예외
 * 벽에 닿으면 멈추지 않고 벽을 따라 미끄러진다 (겹친 만큼만 밖으로 밀어낸다).
 */
const RADIUS = 0.32;
const SPEED_SLOW = 1.25;
export const SPEED_FAST = 4.7;
/** 한 걸음(다리 한 번 왕복) 길이, 점프 처음 속도, 중력. 다른 유저 고양이도 같은 값으로 움직인다 */
export const STRIDE = 0.66;
export const JUMP_V = 4.7;
export const GRAVITY = 17;
/** 이 높이 이하인 막힌 것은 점프로 넘을 수 있다 (울타리 0.5) */
const LOW_OBSTACLE = 0.55;
/** 이보다 바다 쪽으로는 못 간다 (모래사장까지는 내려갈 수 있다) */
const MIN_LAND = 1.0;

export type WalkAnim = 'idle' | 'walk' | 'sit' | 'jump';

export interface Bridge {
  x: number;
  z: number;
  axis: 'x' | 'z';
}
export interface Blocker {
  x: number;
  z: number;
  r: number;
}

function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Walker {
  x = 0;
  z = 0;
  /** 발바닥 높이 (땅 높이 + 점프) */
  y = GROUND_Y;
  /** 땅 높이 */
  groundY = GROUND_Y;
  /** 점프로 떠 있는 높이 */
  air = 0;
  yaw = 0;
  speed = 0;
  /** 셰이더로 넘기는 값들 */
  phase = 0;
  walk = 0;
  sit = 0;
  yawn = 0;
  anim: WalkAnim = 'idle';
  /** 집이 있는 자리인지 (없는 자리의 집/울타리는 막지 않는다) */
  hasHouse: (houseNo: number) => boolean = () => true;
  /** 그때그때 달라지는 막힌 곳 (큰 꾸미기 아이템) */
  blockers: (x: number, z: number, out: Blocker[]) => void = () => {};
  bridges: Bridge[] = [];
  /**
   * 집 안에 있을 때의 방 크기. null 이 아니면 섬의 땅/막힌 곳 대신 이 네모 안에서만 움직인다.
   * 앞쪽 가운데(문, 절반 폭 doorHalf)로는 doorZ 까지 더 나갈 수 있다. 가구는 blockers 로 막는다
   */
  room: { minX: number; maxX: number; minZ: number; maxZ: number; y: number; doorHalf: number; doorZ: number } | null = null;
  /** true 인 동안에는 가만히 있으면 바로 앉는다 (낚시할 때) */
  holdSit = false;
  /** 빠르기 배수 (고양이 자동차를 타면 1보다 크다. 2026-11-16) */
  speedMul = 1;

  private vx = 0;
  private vz = 0;
  private vy = 0;
  private idle = 0;
  private yawnAt = 9;
  private yawnT = 1;
  private readonly near: Collider[] = [];
  private readonly extra: Blocker[] = [];

  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = this.vy = 0;
    this.speed = 0;
    this.air = 0;
    this.idle = 0;
    this.sit = this.yawn = this.walk = 0;
    this.yawnT = 1;
    this.resolve(x, z);
    this.groundY = this.heightAt(this.x, this.z);
    this.y = this.groundY;
  }

  /**
   * @param mx, my  이동 입력 (카메라 기준. x 오른쪽, y 앞). 길이 0~1
   * @param camYaw  카메라가 고양이를 바라보는 방향의 각도 (0이면 카메라가 +z 쪽에 있다)
   */
  update(dt: number, mx: number, my: number, camYaw: number, jump: boolean) {
    const m = Math.min(1, Math.hypot(mx, my));
    let tx = 0;
    let tz = 0;
    if (m > 0.01) {
      // 카메라가 보는 방향이 앞
      const s = Math.sin(camYaw);
      const c = Math.cos(camYaw);
      const dx = (mx * c - my * s) / m;
      const dz = (-mx * s - my * c) / m;
      const e = m * m * (3 - 2 * m);
      const sp = (SPEED_SLOW + (SPEED_FAST - SPEED_SLOW) * e) * this.speedMul;
      tx = dx * sp;
      tz = dz * sp;
      // 가는 방향으로 부드럽게 몸을 돌린다
      this.yaw += angleDiff(Math.atan2(dx, dz), this.yaw) * (1 - Math.exp(-dt * 11));
    }
    const k = 1 - Math.exp(-dt * (m > 0.01 ? 9 : 12));
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    const px = this.x;
    const pz = this.z;
    this.resolve(this.x + this.vx * dt, this.z + this.vz * dt);
    const moved = Math.hypot(this.x - px, this.z - pz);
    this.speed = dt > 0 ? moved / dt : 0;
    this.phase += (moved / STRIDE) * Math.PI * 2;

    // 점프
    const grounded = this.air <= 0 && this.vy <= 0;
    if (jump && grounded) this.vy = JUMP_V;
    if (this.vy !== 0 || this.air > 0) {
      this.air += this.vy * dt;
      this.vy -= GRAVITY * dt;
      if (this.air <= 0) {
        this.air = 0;
        this.vy = 0;
      }
    }
    // 땅 높이는 살짝 늦게 따라가서 턱에서 툭 튀지 않게 한다
    const g = this.heightAt(this.x, this.z);
    this.groundY += (g - this.groundY) * (1 - Math.exp(-dt * 18));
    const moving = this.speed > 0.15;
    const walkGoal = moving ? Math.min(1, 0.45 + this.speed / SPEED_FAST) : 0;
    this.walk += (walkGoal - this.walk) * (1 - Math.exp(-dt * 9));
    // 걸을 때 몸이 통통 튄다
    this.y = this.groundY + this.air + Math.abs(Math.sin(this.phase)) * 0.045 * this.walk * (this.air > 0 ? 0 : 1);

    // 가만히 있으면 앉고, 가끔 하품한다
    if (moving || this.air > 0 || m > 0.01) {
      this.idle = 0;
      this.yawnAt = 8 + (this.phase % 5);
    } else this.idle += dt;
    if (this.holdSit && this.idle > 0) this.idle = Math.max(this.idle, 5.01);
    this.sit += ((this.idle > 5 ? 1 : 0) - this.sit) * (1 - Math.exp(-dt * 4));
    if (this.idle > this.yawnAt && this.yawnT >= 1) {
      this.yawnT = 0;
      this.yawnAt = this.idle + 9 + (this.phase % 4);
    }
    if (this.yawnT < 1) {
      this.yawnT = Math.min(1, this.yawnT + dt / 1.7);
      this.yawn = Math.sin(this.yawnT * Math.PI) ** 0.6;
    } else this.yawn = 0;

    this.anim = this.air > 0 ? 'jump' : moving ? 'walk' : this.sit > 0.5 ? 'sit' : 'idle';
  }

  /** (nx, nz) 로 가려고 할 때 막힌 곳을 피해 실제로 설 자리를 정한다 */
  private resolve(nx: number, nz: number) {
    const room = this.room;
    if (room) {
      for (let iter = 0; iter < 3; iter++) {
        this.extra.length = 0;
        this.blockers(nx, nz, this.extra);
        for (const b of this.extra) {
          const dx = nx - b.x;
          const dz = nz - b.z;
          const d = Math.hypot(dx, dz);
          const min = b.r + RADIUS;
          if (d < min && d > 1e-4) {
            nx = b.x + (dx / d) * min;
            nz = b.z + (dz / d) * min;
          }
        }
        // 문턱 위에서는 문 폭 안에만 설 수 있다
        const inDoor = Math.abs(nx) < room.doorHalf - RADIUS;
        if (nz > room.maxZ - RADIUS && (inDoor || this.z > room.maxZ - RADIUS + 0.01)) {
          nx = Math.max(-room.doorHalf + RADIUS, Math.min(room.doorHalf - RADIUS, nx));
          nz = Math.min(room.doorZ - RADIUS, nz);
        } else nz = Math.min(room.maxZ - RADIUS, nz);
        nx = Math.max(room.minX + RADIUS, Math.min(room.maxX - RADIUS, nx));
        nz = Math.max(room.minZ + RADIUS, nz);
      }
      this.x = nx;
      this.z = nz;
      return;
    }
    const ox = this.x;
    const oz = this.z;
    for (let iter = 0; iter < 3; iter++) {
      const zone = zoneAt(nx, nz);
      if (zone >= 0) {
        const c = zoneCenter(zone);
        const lx = nx - c.x;
        const lz = nz - c.z;
        let px = lx;
        let pz = lz;
        for (const col of collidersNear(lx, lz, RADIUS + 0.2, this.near)) {
          if (skipCollider(col, zone, this.hasHouse)) continue;
          // 2026-11-16: 점프로 높이 뜨면 낮은 것(울타리, 벤치, 바위)은 넘어간다
          if (col.h > 0 && col.h <= LOW_OBSTACLE && this.air > col.h * 0.55) continue;
          const dx = px - col.x;
          const dz = pz - col.z;
          if (col.r > 0) {
            const d = Math.hypot(dx, dz);
            const min = col.r + RADIUS;
            if (d < min) {
              if (d < 1e-4) px += min;
              else {
                px = col.x + (dx / d) * min;
                pz = col.z + (dz / d) * min;
              }
            }
            continue;
          }
          // 네모: 네모 기준 좌표로 돌려서 가장 가까운 점을 찾는다
          const ux = dx * col.cos - dz * col.sin;
          const uz = dx * col.sin + dz * col.cos;
          const qx = Math.max(-col.hx, Math.min(col.hx, ux));
          const qz = Math.max(-col.hz, Math.min(col.hz, uz));
          let ex = ux - qx;
          let ez = uz - qz;
          let d = Math.hypot(ex, ez);
          if (d >= RADIUS) continue;
          let push: number;
          if (d < 1e-4) {
            // 안에 들어와 있으면 가까운 변 쪽으로 내보낸다
            const gx = col.hx - Math.abs(ux);
            const gz = col.hz - Math.abs(uz);
            if (gx < gz) {
              ex = Math.sign(ux) || 1;
              ez = 0;
              push = gx + RADIUS;
            } else {
              ex = 0;
              ez = Math.sign(uz) || 1;
              push = gz + RADIUS;
            }
            d = 1;
          } else push = RADIUS - d;
          const wx = (ex / d) * push;
          const wz = (ez / d) * push;
          px += wx * col.cos + wz * col.sin;
          pz += -wx * col.sin + wz * col.cos;
        }
        nx = c.x + px;
        nz = c.z + pz;
      }
      // 큰 꾸미기 아이템
      this.extra.length = 0;
      this.blockers(nx, nz, this.extra);
      for (const b of this.extra) {
        const dx = nx - b.x;
        const dz = nz - b.z;
        const d = Math.hypot(dx, dz);
        const min = b.r + RADIUS;
        if (d < min && d > 1e-4) {
          nx = b.x + (dx / d) * min;
          nz = b.z + (dz / d) * min;
        }
      }
      // 바다: 해안 쪽으로 넘어간 만큼 땅 쪽으로 되민다 (해안선을 따라 미끄러진다)
      const br = this.bridgeAt(nx, nz);
      if (onDock(nx, nz)) {
        // 부두 위: 물 위로 나온 곳에서는 옆과 끝으로 못 나간다 (섬에 걸친 쪽은 옆으로 내려설 수 있다)
        if (landAt(nx, nz) < MIN_LAND + 0.4) {
          const d = dockArea();
          const lim = DOCK_HALF_W - 0.45;
          nx = d.x + Math.max(-lim, Math.min(lim, nx - d.x));
          nz = Math.min(d.z1 - 0.4, nz);
        }
      } else if (br) {
        // 다리 위에서는 난간 밖으로 못 나간다 (섬에 걸친 양 끝은 옆으로 내려설 수 있다)
        if (landAt(nx, nz) < MIN_LAND + 0.4) {
          const lim = BRIDGE.width / 2 - 0.42;
          if (br.axis === 'x') nz = br.z + Math.max(-lim, Math.min(lim, nz - br.z));
          else nx = br.x + Math.max(-lim, Math.min(lim, nx - br.x));
        }
      } else {
        const land = landAt(nx, nz);
        if (land < MIN_LAND) {
          const e = 0.35;
          let gx = landAt(nx + e, nz) - landAt(nx - e, nz);
          let gz = landAt(nx, nz + e) - landAt(nx, nz - e);
          const gl = Math.hypot(gx, gz);
          if (gl > 1e-5) {
            gx /= gl;
            gz /= gl;
            const push = Math.min(1.5, MIN_LAND - land + 0.02);
            nx += gx * push;
            nz += gz * push;
          }
        }
      }
    }
    // 그래도 바다나 막힌 곳이면 움직이지 않는다
    if (!this.bridgeAt(nx, nz) && !onDock(nx, nz) && landAt(nx, nz) < MIN_LAND - 0.15 && landAt(ox, oz) >= MIN_LAND - 0.15) {
      nx = ox;
      nz = oz;
    }
    this.x = nx;
    this.z = nz;
  }

  private bridgeAt(x: number, z: number): Bridge | null {
    return bridgeAt(this.bridges, x, z);
  }

  private heightAt(x: number, z: number): number {
    if (this.room) return this.room.y;
    return groundHeightAt(this.bridges, x, z);
  }
}

function bridgeAt(bridges: readonly Bridge[], x: number, z: number): Bridge | null {
  const half = BRIDGE.length / 2;
  const w = BRIDGE.width / 2 - 0.1;
  for (const b of bridges) {
    const along = b.axis === 'x' ? x - b.x : z - b.z;
    const side = b.axis === 'x' ? z - b.z : x - b.x;
    if (Math.abs(along) <= half && Math.abs(side) <= w) return b;
  }
  return null;
}

/** 그 자리의 땅 높이 (다리 위면 다리 바닥). 내 고양이와 다른 유저 고양이가 같이 쓴다 */
export function groundHeightAt(bridges: readonly Bridge[], x: number, z: number): number {
  let ground = heightFromLand(landAt(x, z));
  if (onDock(x, z)) ground = Math.max(ground, DOCK_DECK_Y);
  const b = bridgeAt(bridges, x, z);
  if (!b) return ground;
  const along = b.axis === 'x' ? x - b.x : z - b.z;
  const deck = GROUND_Y + BRIDGE.rise * (1 - Math.pow((2 * along) / BRIDGE.length, 2));
  return Math.max(ground, deck);
}
