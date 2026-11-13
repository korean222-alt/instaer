import * as THREE from 'three';

/**
 * 낮/밤 분위기. 조명 두 개(하늘빛 + 해/달)와 바다/안개 색을 한곳에서 관리하고
 * 낮 ↔ 밤을 부드럽게 넘긴다. 다른 재질은 여기의 shared 값을 uniform 으로 같이 쓴다.
 */
export type TimeMode = 'day' | 'night';

interface Palette {
  horizon: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sun: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  seaShallow: string;
  seaDeep: string;
  foam: string;
}

const DAY: Palette = {
  horizon: '#c9eef2',
  hemiSky: '#fff6e8',
  hemiGround: '#bcdc9c',
  hemiIntensity: 1.55,
  sun: '#fff0d6',
  sunIntensity: 2.35,
  sunDir: [-0.55, 1.0, 0.62],
  seaShallow: '#8fe8d9',
  seaDeep: '#55c2dc',
  foam: '#ffffff',
};

const NIGHT: Palette = {
  horizon: '#232d63',
  hemiSky: '#aab4f5',
  hemiGround: '#55609f',
  hemiIntensity: 1.7,
  sun: '#c9d6ff',
  sunIntensity: 1.35,
  sunDir: [0.5, 1.0, 0.45],
  seaShallow: '#4a8fc4',
  seaDeep: '#243f8c',
  foam: '#c6dbff',
};


export class Atmosphere {
  readonly shared = { uTime: { value: 0 }, uNight: { value: 0 }, uRegion: { value: new THREE.Vector2(-1, 0) } };
  readonly hemi = new THREE.HemisphereLight();
  readonly sun = new THREE.DirectionalLight();
  readonly horizon = new THREE.Color();
  readonly seaShallow = new THREE.Color();
  readonly seaDeep = new THREE.Color();
  readonly foam = new THREE.Color();
  private goal = 0;
  private sunDistance = 120;
  private readonly dir = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly a = new THREE.Color();
  private readonly b = new THREE.Color();

  constructor(scene: THREE.Scene, shadowMapSize: number) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.setShadowArea(0, 0, 24);
    this.apply();
  }

  /** 그림자를 그릴 범위 (가운데와 반지름). 보이는 곳만 좁게 잡을수록 그림자가 또렷하다 */
  setShadowArea(x: number, z: number, radius: number) {
    this.center.set(x, 0, z);
    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    // 범위가 넓어지면 해도 그만큼 멀리 둔다 (가까우면 그림자가 잘린다)
    this.sunDistance = radius * 2 + 50;
    cam.near = 1;
    cam.far = this.sunDistance * 2;
    cam.updateProjectionMatrix();
    this.placeSun();
  }

  setMode(mode: TimeMode, immediate = false) {
    this.goal = mode === 'night' ? 1 : 0;
    if (immediate) {
      this.shared.uNight.value = this.goal;
      this.apply();
    }
  }

  get mode(): TimeMode {
    return this.goal > 0.5 ? 'night' : 'day';
  }

  update(dt: number) {
    this.shared.uTime.value += dt;
    const n = this.shared.uNight.value;
    if (n !== this.goal) {
      const step = dt / 1.4;
      this.shared.uNight.value = n < this.goal ? Math.min(this.goal, n + step) : Math.max(this.goal, n - step);
      this.apply();
    }
  }

  private mix(out: THREE.Color, day: string, night: string, t: number) {
    out.copy(this.a.set(day)).lerp(this.b.set(night), t);
  }

  private apply() {
    const raw = this.shared.uNight.value;
    const t = raw * raw * (3 - 2 * raw);
    this.mix(this.horizon, DAY.horizon, NIGHT.horizon, t);
    this.mix(this.seaShallow, DAY.seaShallow, NIGHT.seaShallow, t);
    this.mix(this.seaDeep, DAY.seaDeep, NIGHT.seaDeep, t);
    this.mix(this.foam, DAY.foam, NIGHT.foam, t);
    this.mix(this.hemi.color, DAY.hemiSky, NIGHT.hemiSky, t);
    this.mix(this.hemi.groundColor, DAY.hemiGround, NIGHT.hemiGround, t);
    this.hemi.intensity = THREE.MathUtils.lerp(DAY.hemiIntensity, NIGHT.hemiIntensity, t);
    this.mix(this.sun.color, DAY.sun, NIGHT.sun, t);
    // 해가 지고 달이 뜨는 중간에는 빛을 잠깐 줄여서 그림자가 휙 도는 게 덜 보이게 한다
    const dip = 1 - 0.55 * Math.sin(Math.PI * t);
    this.sun.intensity = THREE.MathUtils.lerp(DAY.sunIntensity, NIGHT.sunIntensity, t) * dip;
    this.dir
      .set(
        THREE.MathUtils.lerp(DAY.sunDir[0], NIGHT.sunDir[0], t),
        THREE.MathUtils.lerp(DAY.sunDir[1], NIGHT.sunDir[1], t),
        THREE.MathUtils.lerp(DAY.sunDir[2], NIGHT.sunDir[2], t),
      )
      .normalize();
    this.placeSun();
  }

  private placeSun() {
    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(this.dir, this.sunDistance);
    this.sun.target.updateMatrixWorld();
  }
}
