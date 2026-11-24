import * as THREE from 'three';
import { createGlowLambert, GLOW_ATTRS, type GlowShared } from '../core/glowLambert';
import { fillAttr, mergeParts, paint } from '../util/geo';

/**
 * 낚시하는 모습: 내 고양이 앞에 든 낚싯대, 낚싯줄, 물에 뜬 찌, 물결, 잡힌 물고기.
 * 고양이를 앉히고 물 쪽으로 돌리는 것은 index 가 한다. 여기서는 소품만 움직인다.
 *
 * 상태
 * - cast   : 낚싯대를 휘둘러 찌를 던진다 (0.6초쯤 날아가서 물에 떨어진 뒤에는 wait 와 같은 모습)
 * - wait   : 찌가 물 위에서 천천히 까딱인다
 * - bite   : 찌가 쑥 들어가며 떨리고, 물결이 빨라지고, 낚싯대 끝이 휜다
 * - reel   : 줄을 감는다 (찌가 고양이 쪽으로 끌려오고 낚싯대가 들썩인다)
 * - caught : 물고기가 줄 끝에 매달려 올라와 파닥인다
 */
export type FishingState = 'cast' | 'wait' | 'bite' | 'reel' | 'caught';

const ROD_LEN = 1.3;
const CAST_TIME = 0.6;

function piece(g: THREE.BufferGeometry, color: string) {
  paint(g, color);
  fillAttr(g, 'aMask', [0, 0]);
  return g;
}

function buildRod() {
  const parts = [
    piece(new THREE.CylinderGeometry(0.012, 0.024, ROD_LEN, 6).translate(0, ROD_LEN / 2, 0), '#b98557'),
    piece(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 7).translate(0, 0.1, 0), '#5b4636'),
    // 줄 감개
    piece(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 10).rotateZ(Math.PI / 2).translate(0.045, 0.27, 0), '#fff6ea'),
    piece(new THREE.SphereGeometry(0.02, 6, 4).translate(0, ROD_LEN, 0), '#f4c95d'),
  ];
  return mergeParts(parts, GLOW_ATTRS);
}

function buildBobber() {
  const top = new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const bottom = new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const tip = new THREE.CylinderGeometry(0.008, 0.008, 0.11, 4).translate(0, 0.12, 0);
  return mergeParts([piece(top, '#ff6f61'), piece(bottom, '#fffaf0'), piece(tip, '#5b4636')], GLOW_ATTRS);
}

/** 작은 물고기. 원점은 입(줄에 걸린 곳), 몸은 -y 로 늘어진다 */
function buildFish() {
  const body = new THREE.SphereGeometry(0.1, 10, 8);
  body.scale(0.62, 1.55, 1).translate(0, -0.17, 0);
  const tail = new THREE.ConeGeometry(0.085, 0.13, 4).scale(0.35, 1, 1).translate(0, -0.37, 0);
  const fin = new THREE.ConeGeometry(0.04, 0.09, 4).scale(0.35, 1, 1).rotateX(-Math.PI / 2).translate(0, -0.17, 0.11);
  const parts = [piece(body, '#7cc4f2'), piece(tail, '#5aa6dc'), piece(fin, '#5aa6dc')];
  for (const sx of [1, -1]) parts.push(piece(new THREE.SphereGeometry(0.02, 6, 4).translate(sx * 0.056, -0.08, 0.035), '#2e2a33'));
  // 배는 밝게
  parts.push(piece(new THREE.SphereGeometry(0.085, 8, 6).scale(0.55, 1.3, 0.8).translate(0, -0.17, -0.035), '#eaf7ff'));
  return mergeParts(parts, GLOW_ATTRS);
}

export class FishingRig {
  readonly group = new THREE.Group();
  state: FishingState | null = null;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly rod: THREE.Mesh;
  private readonly bobber: THREE.Mesh;
  private readonly fish: THREE.Mesh;
  private readonly ripples: THREE.Mesh[] = [];
  private readonly rippleMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
  private readonly line: THREE.Line;
  private readonly linePos: THREE.BufferAttribute;
  private readonly target = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly base = new THREE.Vector3();
  /** 지금 상태로 바뀐 뒤 흐른 시간 */
  private t = 0;
  private clock = 0;
  /** 낚싯대 기울기 (0 = 똑바로 섬, 클수록 앞으로 숙임) */
  private tilt = 0.8;
  /** 줄을 감은 정도 0~1 */
  private reel = 0;
  /** 물고기가 올라온 정도 0~1 */
  private lift = 0;

  constructor(shared: GlowShared) {
    this.material = createGlowLambert(shared, { instanced: false });
    this.rod = new THREE.Mesh(buildRod(), this.material);
    this.bobber = new THREE.Mesh(buildBobber(), this.material);
    this.fish = new THREE.Mesh(buildFish(), this.material);
    this.rod.castShadow = this.fish.castShadow = true;
    const ring = new THREE.RingGeometry(0.82, 1, 24).rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(ring, this.rippleMaterial.clone());
      m.renderOrder = 6;
      this.ripples.push(m);
    }
    const lineGeo = new THREE.BufferGeometry();
    this.linePos = new THREE.BufferAttribute(new Float32Array(9), 3);
    this.linePos.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute('position', this.linePos);
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#fffdf6', transparent: true, opacity: 0.85 }));
    for (const o of [this.rod, this.bobber, this.fish, this.line, ...this.ripples]) {
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.group.visible = false;
  }

  /** 찌를 던질 물 위의 자리 (waterY 는 그곳의 수면 높이) */
  begin(x: number, z: number, waterY: number) {
    this.target.set(x, waterY, z);
    this.reel = 0;
    this.lift = 0;
    this.tilt = 0.8;
  }

  setState(state: FishingState | null) {
    if (state === this.state) return;
    this.state = state;
    this.t = 0;
    this.group.visible = state !== null;
  }

  /** (x, y, z) 는 내 고양이 발 자리, yaw 는 바라보는 방향, scale 은 고양이 크기 */
  update(dt: number, x: number, y: number, z: number, yaw: number, scale: number) {
    const state = this.state;
    if (!state) return;
    this.t += dt;
    this.clock += dt;
    const t = this.t;
    const c = this.clock;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    // 낚싯대: 앞발 앞에 세우고 상태에 따라 기울인다
    const casting = state === 'cast' && t < CAST_TIME;
    const k = casting ? t / CAST_TIME : 1;
    let tiltGoal = 0.8;
    if (casting) tiltGoal = -0.5 + 1.55 * Math.min(1, k * 1.6);
    else if (state === 'bite') tiltGoal = 0.98 + Math.sin(c * 38) * 0.035;
    else if (state === 'reel') tiltGoal = 0.52 + Math.sin(c * 15) * 0.07;
    else if (state === 'caught') tiltGoal = 0.5;
    this.tilt += (tiltGoal - this.tilt) * (1 - Math.exp(-dt * (casting ? 30 : 9)));
    // 2026-11-24: 몸 가운데 가까이 세우면 (특히 낚아 올릴 때 거의 세우면) 낚싯대가 머리를 뚫고 지나가 보여서 앞발 앞, 살짝 옆으로 뺀다
    const fwd = 0.58 * scale;
    const side = 0.14 * scale;
    this.base.set(x + sin * fwd + cos * side, y + 0.26 * scale, z + cos * fwd - sin * side);
    this.rod.position.copy(this.base);
    this.rod.rotation.set(this.tilt, yaw, 0, 'YXZ');
    this.rod.scale.setScalar(scale);
    const reach = Math.sin(this.tilt) * ROD_LEN * scale;
    this.tip.set(this.base.x + sin * reach, this.base.y + Math.cos(this.tilt) * ROD_LEN * scale, this.base.z + cos * reach);

    // 줄 끝 (찌 또는 물고기)
    this.reel += ((state === 'reel' ? 0.5 : state === 'caught' ? 1 : 0) - this.reel) * (1 - Math.exp(-dt * (state === 'caught' ? 5 : 1.6)));
    this.lift += ((state === 'caught' ? 1 : 0) - this.lift) * (1 - Math.exp(-dt * 4.5));
    const tg = this.target;
    const inWater = !casting && state !== 'caught';
    if (casting) {
      // 낚싯대 끝에서 물까지 포물선으로 날아간다
      const e = k * k * (3 - 2 * k);
      this.end.lerpVectors(this.tip, tg, e);
      this.end.y += Math.sin(k * Math.PI) * 1.1;
    } else if (state === 'caught') {
      // 물고기가 물에서 낚싯대 끝 아래로 올라와 흔들린다
      const hang = 0.42 * scale;
      this.end.set(
        THREE.MathUtils.lerp(tg.x, this.tip.x, this.lift) + Math.sin(c * 5.2) * 0.05 * this.lift,
        THREE.MathUtils.lerp(tg.y, this.tip.y - hang, this.lift) + Math.sin(this.lift * Math.PI) * 0.35,
        THREE.MathUtils.lerp(tg.z, this.tip.z, this.lift),
      );
    } else {
      // 물 위의 찌: 줄을 감으면 고양이 쪽으로 끌려온다 (물 밖으로는 나오지 않게 절반까지만)
      const pull = this.reel * 0.55;
      let bob = Math.sin(c * 2.1) * 0.014;
      if (state === 'bite') bob = -0.075 + Math.sin(c * 34) * 0.018;
      else if (state === 'reel') bob = -0.02 + Math.sin(c * 19) * 0.012;
      else if (state === 'cast') bob += Math.exp(-(t - CAST_TIME) * 5) * Math.sin((t - CAST_TIME) * 16) * 0.05;
      this.end.set(tg.x + (this.base.x - tg.x) * pull * 0.5, tg.y + 0.015 + bob, tg.z + (this.base.z - tg.z) * pull * 0.5);
    }
    this.bobber.visible = state !== 'caught';
    this.bobber.position.copy(this.end);
    this.bobber.rotation.set(state === 'bite' ? Math.sin(c * 30) * 0.25 : Math.sin(c * 1.7) * 0.08, 0, state === 'reel' ? 0.3 : 0);
    this.fish.visible = state === 'caught';
    if (this.fish.visible) {
      this.fish.position.copy(this.end);
      this.fish.rotation.set(0, yaw + Math.PI / 2 + Math.sin(c * 9) * 0.5, Math.sin(c * 13) * 0.22);
      this.fish.scale.setScalar(scale * (0.5 + 0.5 * this.lift));
    }

    // 낚싯줄: 가운데가 살짝 처진다 (당길 때는 팽팽하게)
    const slack = casting || state === 'reel' || state === 'bite' || state === 'caught' ? 0.02 : 0.16;
    this.linePos.setXYZ(0, this.tip.x, this.tip.y, this.tip.z);
    this.linePos.setXYZ(1, (this.tip.x + this.end.x) / 2, (this.tip.y + this.end.y) / 2 - slack, (this.tip.z + this.end.z) / 2);
    this.linePos.setXYZ(2, this.end.x, this.end.y, this.end.z);
    this.linePos.needsUpdate = true;

    // 물결: 찌 둘레로 퍼지는 고리 두 개
    const speed = state === 'bite' ? 2.6 : state === 'reel' ? 1.7 : 0.55;
    for (let i = 0; i < this.ripples.length; i++) {
      const m = this.ripples[i];
      m.visible = inWater || (state === 'caught' && this.lift < 0.6);
      if (!m.visible) continue;
      const p = (c * speed + i * 0.5) % 1;
      const r = 0.1 + p * (state === 'bite' ? 0.62 : 0.42);
      m.position.set(state === 'caught' ? tg.x : this.end.x, tg.y + 0.012, state === 'caught' ? tg.z : this.end.z);
      m.scale.set(r, 1, r);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - p) * (state === 'bite' ? 0.75 : 0.42);
    }
  }

  dispose() {
    this.rod.geometry.dispose();
    this.bobber.geometry.dispose();
    this.fish.geometry.dispose();
    this.ripples[0].geometry.dispose();
    for (const m of this.ripples) (m.material as THREE.Material).dispose();
    this.rippleMaterial.dispose();
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    this.material.dispose();
  }
}
