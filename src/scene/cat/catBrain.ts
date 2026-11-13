import { mulberry32 } from '../util/rand';

/**
 * 고양이 한 마리의 행동. 마당 안에서
 * 가만히 있기 → 천천히 걷기 → 가끔 졸기 를 되풀이한다.
 * 가까이 보이는 고양이만 이걸 돌리고, 먼 고양이는 멈춰 둔다.
 */
export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type State = 'idle' | 'walk' | 'sleep';

const WALK_SPEED = 0.62;
/** 걸음 한 바퀴에 나아가는 거리 */
const STRIDE = 0.5;

export class CatBrain {
  x: number;
  z: number;
  yaw: number;
  /** 걸음 위상 */
  phase = 0;
  /** 0~1 부드럽게 변하는 값들 (셰이더로 넘긴다) */
  walk = 0;
  sleep = 0;
  happy = 0;
  /** 폴짝 뛰는 높이 */
  hop = 0;
  private state: State = 'idle';
  private timer: number;
  private goalX = 0;
  private goalZ = 0;
  private happyTimer = 0;
  private hopT = 1;
  private readonly rnd: () => number;
  private readonly area: Area;

  constructor(area: Area, seed: number) {
    this.area = area;
    this.rnd = mulberry32(seed * 7919 + 13);
    this.x = area.minX + (area.maxX - area.minX) * (0.25 + this.rnd() * 0.5);
    this.z = area.minZ + (area.maxZ - area.minZ) * (0.3 + this.rnd() * 0.5);
    this.yaw = (this.rnd() - 0.5) * 1.2;
    this.timer = 0.6 + this.rnd() * 3;
  }

  /** 쓰다듬기: 눈웃음 + 폴짝 */
  pet() {
    this.happyTimer = 1.8;
    this.hopT = 0;
    if (this.state === 'sleep') this.toIdle(2.5);
    if (this.state === 'walk') this.toIdle(2.2);
  }

  /** 바로 재우기/깨우기 (데모용) */
  setSleeping(on: boolean) {
    if (on) {
      this.state = 'sleep';
      this.timer = 9999;
    } else this.toIdle(1);
  }

  get sleeping() {
    return this.state === 'sleep';
  }

  update(dt: number) {
    const ease = (cur: number, goal: number, rate: number) => cur + (goal - cur) * (1 - Math.exp(-dt * rate));
    this.timer -= dt;

    if (this.state === 'idle') {
      if (this.timer <= 0) {
        const r = this.rnd();
        if (r < 0.62) {
          this.state = 'walk';
          this.goalX = this.area.minX + (this.area.maxX - this.area.minX) * this.rnd();
          this.goalZ = this.area.minZ + (this.area.maxZ - this.area.minZ) * this.rnd();
          this.timer = 12;
        } else if (r < 0.8) {
          this.state = 'sleep';
          this.timer = 7 + this.rnd() * 9;
        } else {
          // 두리번: 화면 쪽을 중심으로 고개 방향만 바꾼다
          this.goalYaw = (this.rnd() - 0.5) * 1.6;
          this.timer = 1.5 + this.rnd() * 3;
        }
      }
      this.yaw = turnToward(this.yaw, this.goalYaw, dt * 2.2);
    } else if (this.state === 'walk') {
      const dx = this.goalX - this.x;
      const dz = this.goalZ - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08 || this.timer <= 0) {
        this.goalYaw = (this.rnd() - 0.5) * 1.4;
        this.toIdle(1.5 + this.rnd() * 4);
      } else {
        this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), dt * 3.2);
        // 몸이 가는 방향을 어느 정도 향했을 때만 나아간다
        const facing = Math.max(0, Math.cos(angleDiff(Math.atan2(dx, dz), this.yaw)));
        const step = Math.min(d, WALK_SPEED * this.walk * facing * dt);
        this.x += Math.sin(this.yaw) * step;
        this.z += Math.cos(this.yaw) * step;
        this.phase += (step / STRIDE) * Math.PI * 2;
      }
    } else if (this.timer <= 0) {
      this.toIdle(1.5 + this.rnd() * 2);
    }

    this.walk = ease(this.walk, this.state === 'walk' ? 1 : 0, 6);
    this.sleep = ease(this.sleep, this.state === 'sleep' ? 1 : 0, 2.2);

    this.happyTimer = Math.max(0, this.happyTimer - dt);
    this.happy = this.happyTimer > 0 ? 1 : 0;
    if (this.hopT < 1) {
      this.hopT = Math.min(1, this.hopT + dt / 0.42);
      this.hop = Math.sin(this.hopT * Math.PI) * 0.22;
    } else this.hop = 0;
  }

  private goalYaw = 0;

  private toIdle(wait: number) {
    this.state = 'idle';
    this.timer = wait;
  }
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(cur: number, goal: number, maxStep: number) {
  const d = angleDiff(goal, cur);
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
