import * as THREE from 'three';
import type { CatLook } from '../../shared/types';
import { CatFlock } from '../cat/CatFlock';
import { PATTERN_INDEX } from '../cat/catMaterial';
import type { CatModel } from '../cat/catModel';
import type { GlowShared } from '../core/glowLambert';
import { FishingRig, type FishingState } from '../fishing/FishingRig';
import { hash01 } from '../util/rand';
import { GRAVITY, groundHeightAt, JUMP_V, SPEED_FAST, STRIDE, type Bridge } from '../walk/Walker';
import { NameTags } from './NameTags';
import type { PlayerAnim, RemotePlayer } from './types';

/**
 * 내 주변에 있는 다른 유저의 고양이.
 *
 * 앱이 setPlayers 로 "지금 보여줄 유저 목록"을 통째로 넘기면(1초에 8~10번쯤)
 * - 받은 위치를 시각과 함께 적어 두고, 약 150ms 전 시점의 위치를 앞뒤 값 사이에서 계산해 그린다.
 *   그래서 드문드문 오는 위치로도 끊기지 않고 걷는 것처럼 보인다.
 * - 위치가 크게 튀면 순간이동하지 않고 빠르게 미끄러지듯 따라간다.
 * - 목록에 새로 생긴 유저는 뿅 하고 커지며 나타나고, 빠진 유저는 작아지며 사라진다.
 *
 * 고양이는 InstancedMesh 두 개(가까운 유저용 / 먼 유저용 단순 모양)로만 그린다.
 * 낚시 중인 유저(RemotePlayer.fishing)는 가까운 순서로 FISH_RIGS 명까지 낚싯대와 찌를 그린다 (한 명에 그리기 6번).
 * 유저 자리(Rec)는 처음에 POOL 개를 만들어 두고 계속 다시 쓴다.
 */

/** 한 번에 다룰 수 있는 유저 수 (보이는 유저 + 사라지는 중인 유저) */
const POOL = 40;
/** 유저마다 기억해 두는 최근 위치 수 */
const SNAPS = 8;
/** 이만큼 지난 시점을 그린다 (ms) */
const DELAY = 150;
/** 위치가 오는 보통 간격 (ms). 한동안 멈춰 있던 유저가 다시 움직일 때 쓴다 */
const SEND_GAP = 125;
/** 이보다 오래 소식이 없었으면 그동안 제자리에 있었던 것으로 본다 (ms) */
const HOLD_GAP = 250;
/** 보통은 이 속도 안에서 따라가고, 더 멀리 벌어지면 거리에 비례해 빨라진다 */
const SLIDE_SPEED = 14;
const SCALE = 1.12;
const FADE_IN = 0.38;
const FADE_OUT = 0.28;
/** 이름표: 가까운 순서로 이만큼만 */
const TAG_MAX = 10;
/** 품질 단계별: 이 거리 안의 유저만 자세한 모양 + 그림자 */
const NEAR_RADIUS = [22, 22, 16, 12, 9];
const ANIMS: readonly PlayerAnim[] = ['idle', 'walk', 'sit', 'jump'];
const JUMP = 3;
const SIT = 2;
/** 다른 유저 낚싯대는 가까운 순서로 이만큼만 그린다 */
const FISH_RIGS = 3;
const FISH_STATES: ReadonlySet<string> = new Set(['cast', 'wait', 'bite', 'reel', 'caught']);
const DEFAULT_CAT: CatLook = { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' };

function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

class Rec {
  used = false;
  id = '';
  handle = '';
  /** 목록에 들어 있는가 (아니면 사라지는 중) */
  alive = false;
  stamp = 0;
  /** 아직 한 번도 그리지 않았다 (첫 위치는 미끄러지지 않고 바로 놓는다) */
  fresh = true;

  // 겉모습
  readonly fur = new THREE.Color();
  readonly eye = new THREE.Color();
  pattern = 0;
  seed = 0;
  lookKey = '';

  // 받은 위치 기록 (오래된 것부터 차례로, n 개)
  readonly st = new Float64Array(SNAPS);
  readonly sx = new Float32Array(SNAPS);
  readonly sz = new Float32Array(SNAPS);
  readonly sr = new Float32Array(SNAPS);
  readonly sa = new Uint8Array(SNAPS);
  n = 0;

  // 지금 그리는 상태
  x = 0;
  z = 0;
  yaw = 0;
  groundY = 0;
  air = 0;
  vy = 0;
  jumpT = 0;
  speed = 0;
  phase = 0;
  walk = 0;
  sit = 0;
  /** 나타난 정도 0~1 */
  show = 0;
  near = false;

  // 이름표
  tagSlot = -1;
  tagAlpha = 0;
  tagWant = false;
  /** 기준점(내 고양이)까지 거리의 제곱 */
  d2 = 0;

  // 낚시
  fishing: FishingState | null = null;
  /** 맡은 낚싯대 번호 (-1 이면 없음) */
  rig = -1;

  push(t: number, x: number, z: number, rotY: number, anim: number) {
    if (this.n === SNAPS) {
      this.st.copyWithin(0, 1);
      this.sx.copyWithin(0, 1);
      this.sz.copyWithin(0, 1);
      this.sr.copyWithin(0, 1);
      this.sa.copyWithin(0, 1);
      this.n--;
    }
    const i = this.n++;
    this.st[i] = t;
    this.sx[i] = x;
    this.sz[i] = z;
    this.sr[i] = rotY;
    this.sa[i] = anim;
  }
}

export interface RemoteView {
  /** 거리 기준점 (걷는 중이면 내 고양이, 아니면 화면 가운데) */
  focusX: number;
  focusZ: number;
  walking: boolean;
  /** 카메라 거리 */
  dist: number;
  viewportW: number;
  viewportH: number;
  /** 자동 품질 단계 (0=최고) */
  quality: number;
}

/** 다른 유저 낚싯대에 필요한 것 (index 가 넘긴다) */
export interface RemoteFishingSupport {
  shared: GlowShared;
  /** (x, z) 에 앉아 yaw 쪽을 보는 고양이가 찌를 던질 물 위의 자리 */
  target(x: number, z: number, yaw: number): { x: number; y: number; z: number };
}

export class RemotePlayers {
  readonly group = new THREE.Group();
  bridges: readonly Bridge[] = [];
  /** 집 안처럼 바닥이 평평한 곳에서는 그 높이. null 이면 섬의 땅 높이를 쓴다 */
  flatY: number | null = null;
  /** 확인용: 지금 그리는 수 */
  shown = 0;
  shownNear = 0;
  shownTags = 0;

  private readonly near: CatFlock;
  private readonly far: CatFlock;
  private readonly tags = new NameTags();
  private readonly recs: Rec[] = [];
  private readonly byId = new Map<string, Rec>();
  private readonly picked: Rec[] = new Array(TAG_MAX);
  private active = 0;
  private stamp = 0;

  private readonly rigs: FishingRig[] = [];
  private readonly rigOwner: Array<Rec | null> = [];
  private readonly fishSupport: RemoteFishingSupport | null;
  private readonly fishCand: Rec[] = [];

  constructor(model: CatModel, fishing?: RemoteFishingSupport) {
    this.fishSupport = fishing ?? null;
    this.near = new CatFlock(model, POOL, 'low');
    this.far = new CatFlock(model, POOL, 'tiny');
    // 먼 유저는 그림자도 드리우지 않는다
    this.far.mesh.castShadow = false;
    this.near.mesh.visible = false;
    this.far.mesh.visible = false;
    this.group.add(this.near.mesh, this.far.mesh, this.tags.mesh);
    for (let i = 0; i < POOL; i++) this.recs.push(new Rec());
    if (fishing)
      for (let i = 0; i < FISH_RIGS; i++) {
        const rig = new FishingRig(fishing.shared);
        this.rigs.push(rig);
        this.rigOwner.push(null);
        this.group.add(rig.group);
      }
  }

  /** 지금 보여줄 유저 목록 전체. now 는 performance.now() 기준 시각(ms) */
  setPlayers(players: readonly RemotePlayer[], now: number) {
    // 빈 목록이 계속 와도 할 일이 없다
    if (players.length === 0 && this.active === 0) return;
    const stamp = ++this.stamp;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const id = String(p.id);
      let anim = ANIMS.indexOf(p.anim);
      if (anim < 0) anim = 0;
      const rotY = Number.isFinite(p.rotY) ? p.rotY : 0;
      let r = this.byId.get(id);
      if (!r) {
        r = this.recs.find((c) => !c.used);
        // 자리가 꽉 찼으면 넘치는 유저는 그리지 않는다
        if (!r) continue;
        r.used = true;
        r.id = id;
        r.n = 0;
        r.fresh = true;
        r.show = 0;
        r.air = r.vy = r.speed = r.walk = r.sit = 0;
        r.jumpT = 0;
        r.phase = hash01(hashString(id) % 100000, 3) * 6.28;
        r.near = false;
        r.tagAlpha = 0;
        r.tagSlot = -1;
        r.lookKey = '';
        r.fishing = null;
        r.rig = -1;
        this.byId.set(id, r);
        this.active++;
        r.push(now, p.x, p.z, rotY, anim);
      } else if (r.stamp !== stamp) {
        const last = r.n - 1;
        // 거의 다 사라진 뒤에 다시 들어온 유저는 새 자리에서 다시 나타난다
        if (!r.alive && r.show < 0.15) {
          r.n = 0;
          r.fresh = true;
          r.push(now, p.x, p.z, rotY, anim);
        } else if (r.sx[last] !== Math.fround(p.x) || r.sz[last] !== Math.fround(p.z) || r.sr[last] !== Math.fround(rotY) || r.sa[last] !== anim) {
          // 한동안 같은 값이었다면 그동안 제자리에 있었던 것이므로, 직전까지 그 자리에 있었다고 적어 준다
          // (그러지 않으면 오래전 위치에서부터 계산해서 첫걸음이 툭 튄다)
          if (now - r.st[last] > HOLD_GAP) r.push(now - SEND_GAP, r.sx[last], r.sz[last], r.sr[last], r.sa[last]);
          r.push(now, p.x, p.z, rotY, anim);
        }
        // 값이 그대로면 적지 않는다 (앱이 같은 목록을 매 프레임 넘겨도 괜찮다)
      } else continue;
      r.stamp = stamp;
      r.alive = true;
      r.fishing = p.fishing && FISH_STATES.has(p.fishing) ? p.fishing : null;
      if (r.handle !== p.handle) {
        r.handle = String(p.handle ?? '');
        // 이름이 바뀌면 이름표를 새로 받는다
        this.tags.give(r.tagSlot);
        r.tagSlot = -1;
      }
      const cat = p.cat ?? DEFAULT_CAT;
      const key = `${cat.fur}|${cat.pattern}|${cat.eyeColor}|${p.houseNo ?? ''}`;
      if (r.lookKey !== key) {
        r.lookKey = key;
        r.fur.set(cat.fur);
        r.eye.set(cat.eyeColor);
        r.pattern = PATTERN_INDEX[cat.pattern] ?? 0;
        // 집이 있으면 그 집 마당 고양이와 같은 얼룩이 나오게 같은 값을 쓴다
        r.seed = p.houseNo != null ? hash01(p.houseNo, 99) : hash01(hashString(id) % 100000, 7);
      }
    }
    // 목록에서 빠진 유저는 사라지기 시작한다
    for (const r of this.recs) if (r.used && r.stamp !== stamp) r.alive = false;
  }

  update(now: number, dt: number, view: RemoteView) {
    if (this.active === 0) {
      if (this.shown) {
        this.shown = this.shownNear = this.shownTags = 0;
        this.near.mesh.visible = this.far.mesh.visible = false;
        this.tags.begin();
        this.tags.end(view.viewportW, view.viewportH);
      }
      return;
    }
    const t = now - DELAY;
    // 전체 시점처럼 아주 멀리서 볼 때는 그리지 않는다 (움직임 계산은 이어 간다)
    const visible = view.dist < 300;
    const nearR = view.walking ? NEAR_RADIUS[Math.min(view.quality, NEAR_RADIUS.length - 1)] : view.dist < 45 ? 26 : 0;
    const tagRange = view.walking ? 30 : Math.max(30, view.dist * 0.55);
    let nNear = 0;
    let nFar = 0;
    let nPicked = 0;
    const picked = this.picked;

    for (const r of this.recs) {
      if (!r.used) continue;
      // 나타나기 / 사라지기
      r.show = r.alive ? Math.min(1, r.show + dt / FADE_IN) : r.show - dt / FADE_OUT;
      if (r.show <= 0) {
        this.release(r);
        continue;
      }
      this.move(r, t, dt);

      const dx = r.x - view.focusX;
      const dz = r.z - view.focusZ;
      r.d2 = dx * dx + dz * dz;
      // 경계에서 모양이 깜빡이지 않게 들어올 때와 나갈 때 거리를 다르게 둔다
      const lim = r.near ? nearR + 3 : nearR;
      r.near = nearR > 0 && r.d2 < lim * lim;

      if (visible) {
        // 나타날 때는 살짝 튀어 오르듯 커지고, 사라질 때는 스르르 작아진다
        const s = r.show;
        const k = r.alive ? 1 + 2.3 * Math.pow(s - 1, 3) + 1.3 * Math.pow(s - 1, 2) : s * s * (3 - 2 * s);
        const flock = r.near ? this.near : this.far;
        const slot = r.near ? nNear++ : nFar++;
        const hop = r.air > 0 ? 0 : Math.abs(Math.sin(r.phase)) * 0.045 * r.walk;
        flock.setLookRaw(slot, r.fur, r.eye, r.pattern, r.seed, r.sit, 0);
        flock.setPose(slot, r.x, r.groundY + r.air + hop + 0.035, r.z, r.yaw, SCALE * Math.max(0.001, k));
        flock.setAnim(slot, r.phase, r.walk, 0, 0);
      }

      // 이름표 후보: 가까운 순서로 TAG_MAX 명 (지금 보이는 이름표는 조금 더 버틴다)
      r.tagWant = false;
      if (visible && r.alive && r.handle && r.d2 < tagRange * tagRange) {
        const key = keyOf(r);
        let i = -1;
        if (nPicked < TAG_MAX) i = nPicked++;
        else if (keyOf(picked[TAG_MAX - 1]) > key) i = TAG_MAX - 1;
        if (i >= 0) {
          while (i > 0 && keyOf(picked[i - 1]) > key) {
            picked[i] = picked[i - 1];
            i--;
          }
          picked[i] = r;
        }
      }
    }
    for (let i = 0; i < nPicked; i++) picked[i].tagWant = true;

    this.updateFishing(dt, visible);

    // 이름표
    this.tags.begin();
    let nTags = 0;
    for (const r of this.recs) {
      if (!r.used) continue;
      r.tagAlpha = r.tagWant ? Math.min(1, r.tagAlpha + dt / 0.22) : Math.max(0, r.tagAlpha - dt / 0.22);
      if (r.tagAlpha <= 0) {
        if (r.tagSlot >= 0) {
          this.tags.give(r.tagSlot);
          r.tagSlot = -1;
        }
        continue;
      }
      if (r.tagSlot < 0) {
        r.tagSlot = this.tags.take(r.handle);
        if (r.tagSlot < 0) {
          // 빈자리가 없으면 다음 프레임에 다시 시도한다
          r.tagAlpha = 0;
          continue;
        }
      }
      const d = Math.sqrt(r.d2);
      // 멀수록 작게, 범위 끝에서는 사라진다
      const e = THREE.MathUtils.smoothstep(d, 7, tagRange * 0.85);
      const edge = 1 - THREE.MathUtils.smoothstep(d, tagRange * 0.82, tagRange);
      const a = r.tagAlpha * edge * Math.min(1, r.show * 1.4);
      if (a <= 0.01) continue;
      this.tags.push(r.tagSlot, r.x, r.groundY + r.air * 0.6 + SCALE * 1.02 + 0.06, r.z, 1 - 0.36 * e, a);
      nTags++;
    }
    this.tags.end(view.viewportW, view.viewportH);

    this.near.count = nNear;
    this.far.count = nFar;
    this.near.mesh.visible = nNear > 0;
    this.far.mesh.visible = nFar > 0;
    this.shown = nNear + nFar;
    this.shownNear = nNear;
    this.shownTags = nTags;
  }

  /** 낚시 중인 가까운 유저에게 낚싯대를 나눠 주고 움직인다 */
  private updateFishing(dt: number, visible: boolean) {
    const sup = this.fishSupport;
    if (!sup) return;
    const cand = this.fishCand;
    cand.length = 0;
    if (visible) for (const r of this.recs) if (r.used && r.alive && r.fishing && r.near && r.show > 0.5) cand.push(r);
    cand.sort((a, b) => a.d2 - b.d2);
    if (cand.length > FISH_RIGS) cand.length = FISH_RIGS;
    // 더는 그리지 않을 유저의 낚싯대를 거둔다
    for (let i = 0; i < this.rigs.length; i++) {
      const o = this.rigOwner[i];
      if (o && !cand.includes(o)) this.freeRig(o);
    }
    for (const r of cand) {
      let rig: FishingRig;
      if (r.rig < 0) {
        const i = this.rigOwner.indexOf(null);
        if (i < 0) continue;
        this.rigOwner[i] = r;
        r.rig = i;
        rig = this.rigs[i];
        const tg = sup.target(r.x, r.z, r.yaw);
        rig.begin(tg.x, tg.z, tg.y);
        rig.setState(null);
      } else rig = this.rigs[r.rig];
      if (rig.state !== r.fishing) {
        // 다시 던지면 찌를 새로 던진다
        if (r.fishing === 'cast' && rig.state !== null) {
          const tg = sup.target(r.x, r.z, r.yaw);
          rig.begin(tg.x, tg.z, tg.y);
          rig.setState(null);
        }
        rig.setState(r.fishing);
      }
      rig.update(dt, r.x, r.groundY + r.air + 0.035, r.z, r.yaw, SCALE);
    }
  }

  private freeRig(r: Rec) {
    if (r.rig < 0) return;
    this.rigs[r.rig].setState(null);
    this.rigOwner[r.rig] = null;
    r.rig = -1;
  }

  /** 모두 바로 지운다 (집 안팎을 오갈 때. 사라지는 모습 없이) */
  clear() {
    for (const r of this.recs) if (r.used) this.release(r);
  }

  dispose() {
    this.near.dispose();
    this.far.dispose();
    this.tags.dispose();
    for (const rig of this.rigs) rig.dispose();
    this.byId.clear();
  }

  private release(r: Rec) {
    this.freeRig(r);
    this.tags.give(r.tagSlot);
    r.tagSlot = -1;
    r.used = false;
    r.alive = false;
    this.byId.delete(r.id);
    this.active--;
  }

  /** 시각 t 의 위치를 받은 값 사이에서 계산하고, 그리는 위치가 그쪽으로 따라가게 한다 */
  private move(r: Rec, t: number, dt: number) {
    // t 바로 앞의 기록 a 와 바로 뒤의 기록 b
    let a = 0;
    while (a < r.n - 1 && r.st[a + 1] <= t) a++;
    const b = Math.min(r.n - 1, a + 1);
    let tx = r.sx[a];
    let tz = r.sz[a];
    let tyaw = r.sr[a];
    let anim = r.sa[a];
    if (b !== a && t > r.st[a]) {
      const k = Math.min(1, (t - r.st[a]) / (r.st[b] - r.st[a]));
      tx += (r.sx[b] - tx) * k;
      tz += (r.sz[b] - tz) * k;
      tyaw += angleDiff(r.sr[b], tyaw) * k;
      if (k > 0.5) anim = r.sa[b];
    }

    let moved = 0;
    if (r.fresh) {
      r.fresh = false;
      r.x = tx;
      r.z = tz;
      r.yaw = tyaw;
      r.groundY = this.flatY ?? groundHeightAt(this.bridges, tx, tz);
    } else {
      const ex = tx - r.x;
      const ez = tz - r.z;
      const d = Math.hypot(ex, ez);
      // 보통 걸음은 그대로 따라가고, 크게 벌어지면 벌어진 만큼 빨리 미끄러진다
      const step = Math.max(SLIDE_SPEED, d * 6) * dt;
      if (d <= step) {
        r.x = tx;
        r.z = tz;
        moved = d;
      } else {
        r.x += (ex / d) * step;
        r.z += (ez / d) * step;
        moved = step;
      }
      r.yaw += angleDiff(tyaw, r.yaw) * (1 - Math.exp(-dt * 16));
      const g = this.flatY ?? groundHeightAt(this.bridges, r.x, r.z);
      r.groundY += (g - r.groundY) * (1 - Math.exp(-dt * 18));
    }

    // 걸음: 실제로 움직인 거리만큼 다리를 움직인다 (미끄러질 때 다리가 헛돌지 않게 상한을 둔다)
    const raw = dt > 0 ? moved / dt : 0;
    r.speed += (raw - r.speed) * (1 - Math.exp(-dt * 12));
    r.phase += (Math.min(moved, SPEED_FAST * 1.5 * dt) / STRIDE) * Math.PI * 2;
    const moving = r.speed > 0.15;
    const walkGoal = moving ? Math.min(1, 0.45 + r.speed / SPEED_FAST) : 0;
    r.walk += (walkGoal - r.walk) * (1 - Math.exp(-dt * 9));
    r.sit += ((anim === SIT && !moving ? 1 : 0) - r.sit) * (1 - Math.exp(-dt * 4));

    // 점프: 'jump' 가 오면 내 고양이와 같은 높이로 한 번 뛴다. 계속 'jump' 면 이어서 뛴다
    if (r.air > 0 || r.vy > 0) {
      r.jumpT += dt;
      r.air += r.vy * dt;
      r.vy -= GRAVITY * dt;
      if (r.air <= 0) {
        r.air = 0;
        r.vy = 0;
      }
    } else if (anim === JUMP) {
      if (r.jumpT === 0 || r.jumpT > 0.75) {
        r.vy = JUMP_V;
        r.jumpT = 1e-4;
      } else r.jumpT += dt;
    } else r.jumpT = 0;
  }
}

const keyOf = (r: Rec) => (r.tagAlpha > 0 ? r.d2 * 0.8 : r.d2);
