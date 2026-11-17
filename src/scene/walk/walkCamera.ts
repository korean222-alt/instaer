import * as THREE from 'three';
import { collidersNear, skipCollider, zoneAt, zoneCenter, type Collider } from '../layout';
import { GROUND_Y } from '../world/constants';

/**
 * 걷기 카메라: 고양이 뒤쪽 위에서 비스듬히 내려다보는 3인칭 시점.
 * - 고양이를 스프링처럼 부드럽게 따라간다 (점프는 조금만 따라가서 화면이 출렁이지 않는다)
 * - 드래그로 좌우로 돈다
 * - 집이나 나무가 고양이를 가리면 카메라를 그 앞으로 당긴다.
 *   바로 뒤에 집이 붙어 있어서 당길 자리도 없으면 카메라를 위로 올려서 지붕 너머로 내려다본다
 */
export const WALK_FOV = 50;
export const WALK_DIST = 14;
/** 내려다보는 각도 후보. 앞의 것부터 보고, 가려지지 않는 첫 각도를 쓴다 */
const PITCHES = [35, 48, 62, 78].map((d) => THREE.MathUtils.degToRad(d));
const MIN_DIST = 2.4;
const STEP = 0.7;
const FOCUS_UP = 0.85;

/** 목표값을 넘지 않고 부드럽게 따라가는 스프링 (임계 감쇠) */
function smoothDamp(cur: number, goal: number, vel: { v: number }, time: number, dt: number) {
  const omega = 2 / time;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - goal;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  return goal + (change + temp) * exp;
}

export class WalkCamera {
  /** 0이면 카메라가 고양이의 +z 쪽(화면 아래쪽)에 있다. 기존 동네 시점과 같은 방향 */
  yaw = 0;
  /** 따라가는 점 (고양이 조금 위) */
  readonly focus = new THREE.Vector3();
  dist = WALK_DIST;
  /** 시야 넓히기 0~1 (setWalkZoom). 카메라가 멀고 조금 높아진다 */
  zoom = 0;
  private pitch = PITCHES[0];
  private get far() {
    return WALK_DIST * (1 + 0.38 * this.zoom);
  }
  hasHouse: (houseNo: number) => boolean = () => true;
  private readonly vx = { v: 0 };
  private readonly vy = { v: 0 };
  private readonly vz = { v: 0 };
  private readonly near: Collider[] = [];
  private readonly dir = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  /** 바로 그 자리로 옮긴다 (걷기 시작할 때) */
  snap(x: number, y: number, z: number, yaw: number) {
    this.focus.set(x, y + FOCUS_UP, z);
    this.vx.v = this.vy.v = this.vz.v = 0;
    this.yaw = yaw;
    this.dist = WALK_DIST;
    this.pitch = PITCHES[0];
  }

  update(dt: number, camera: THREE.PerspectiveCamera, x: number, groundY: number, air: number, z: number, lookDelta: number) {
    this.yaw += lookDelta;
    this.focus.x = smoothDamp(this.focus.x, x, this.vx, 0.16, dt);
    this.focus.z = smoothDamp(this.focus.z, z, this.vz, 0.16, dt);
    this.focus.y = smoothDamp(this.focus.y, groundY + FOCUS_UP + air * 0.3, this.vy, 0.3, dt);

    // 가려지지 않는 가장 낮은 각도를 고른다. 전부 가려지면 가장 멀리까지 트인 각도
    const lift = this.zoom * THREE.MathUtils.degToRad(7);
    let goal = PITCHES[0] + lift;
    let bestFree = 0;
    for (const p0 of PITCHES) {
      const p = p0 + lift;
      const f = this.freeDistance(p);
      if (f > bestFree + 0.01) {
        bestFree = f;
        goal = p;
      }
      if (f >= this.far) break;
    }
    this.pitch += (goal - this.pitch) * (1 - Math.exp(-dt * (goal > this.pitch ? 7 : 2.5)));

    // 가려지면 당기고(빠르게), 트이면 다시 물러난다(천천히)
    const free = this.freeDistance(this.pitch);
    const rate = free < this.dist ? 14 : 2.6;
    this.dist += (free - this.dist) * (1 - Math.exp(-dt * rate));

    camera.position.copy(this.focus).addScaledVector(this.dir, this.dist);
    camera.lookAt(this.look.copy(this.focus).setY(this.focus.y + 0.35));
    if (camera.near !== 0.4) {
      camera.near = 0.4;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  /** 고양이에서 카메라 쪽으로 가면서 집/나무에 처음 걸리는 거리 */
  private freeDistance(pitch: number): number {
    const cp = Math.cos(pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(pitch), Math.cos(this.yaw) * cp);
    const f = this.focus;
    const zone = zoneAt(f.x, f.z);
    const far = this.far;
    if (zone < 0) return far;
    const c = zoneCenter(zone);
    const step = STEP;
    for (let t = 1; t <= far; t += step) {
      const px = f.x + this.dir.x * t - c.x;
      const pz = f.z + this.dir.z * t - c.z;
      const h = f.y + this.dir.y * t - GROUND_Y;
      for (const col of collidersNear(px, pz, 0.5, this.near)) {
        if (col.occ <= 0 || h > col.h) continue;
        if (skipCollider(col, zone, this.hasHouse)) continue;
        const dx = px - col.x;
        const dz = pz - col.z;
        if (col.r > 0) {
          // 나무: 잎은 줄기 위쪽에만 있다
          if (h < col.h * 0.3) continue;
          if (dx * dx + dz * dz < col.occ * col.occ) return Math.max(MIN_DIST, t - step);
        } else {
          const ux = dx * col.cos - dz * col.sin;
          const uz = dx * col.sin + dz * col.cos;
          if (Math.abs(ux) < col.hx + col.occ && Math.abs(uz) < col.hz + col.occ) return Math.max(MIN_DIST, t - step);
        }
      }
    }
    return far;
  }
}
