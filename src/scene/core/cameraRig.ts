import * as THREE from 'three';

/**
 * 카메라 조작. 위에서 비스듬히 내려다보는 시점으로 고정하고
 * - 한 손가락 드래그: 이동 (손가락 아래의 땅이 그대로 따라온다)
 * - 두 손가락 핀치 / 마우스 휠: 확대·축소
 * - 가까이 갈수록 카메라가 낮아져서 고양이 얼굴이 보인다
 * - flyTo: 원하는 곳으로 부드럽게 이동
 */
export interface RigBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface RigOptions {
  groundY: number;
  minDist: number;
  maxDist: number;
  bounds: RigBounds;
}

const PITCH_NEAR = THREE.MathUtils.degToRad(37);
const PITCH_FAR = THREE.MathUtils.degToRad(47);

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private opts: RigOptions;
  // 현재 값과 목표 값
  private tx = 0;
  private tz = 0;
  private dist = 60;
  private gx = 0;
  private gz = 0;
  private gdist = 60;
  private vx = 0;
  private vz = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private downAt = 0;
  private moved = 0;
  private multi = false;
  private tapCb: ((clientX: number, clientY: number) => void) | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly plane: THREE.Plane;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly listeners: Array<[string, EventListener, AddEventListenerOptions?]> = [];

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, opts: RigOptions) {
    this.camera = camera;
    this.dom = dom;
    this.opts = opts;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -opts.groundY);
    const on = (type: string, fn: (e: any) => void, o?: AddEventListenerOptions) => {
      dom.addEventListener(type, fn as EventListener, o);
      this.listeners.push([type, fn as EventListener, o]);
    };
    on('pointerdown', (e: PointerEvent) => this.onDown(e));
    on('pointermove', (e: PointerEvent) => this.onMove(e));
    on('pointerup', (e: PointerEvent) => this.onUp(e));
    on('pointercancel', (e: PointerEvent) => this.onUp(e, true));
    on('wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on('contextmenu', (e: Event) => e.preventDefault());
    dom.style.touchAction = 'none';
    this.place();
  }

  setLimits(partial: Partial<RigOptions>) {
    this.opts = { ...this.opts, ...partial };
    this.gdist = THREE.MathUtils.clamp(this.gdist, this.opts.minDist, this.opts.maxDist);
  }

  onTap(cb: (clientX: number, clientY: number) => void) {
    this.tapCb = cb;
  }

  /** 지금 보고 있는 곳 */
  get target() {
    return { x: this.tx, z: this.tz, dist: this.dist };
  }

  /** 0(가장 가까이) ~ 1(가장 멀리) */
  get zoomT() {
    const { minDist, maxDist } = this.opts;
    return THREE.MathUtils.clamp(Math.log(this.dist / minDist) / Math.log(maxDist / minDist), 0, 1);
  }

  flyTo(x: number, z: number, dist?: number) {
    this.gx = x;
    this.gz = z;
    if (dist !== undefined) this.gdist = THREE.MathUtils.clamp(dist, this.opts.minDist, this.opts.maxDist);
    this.vx = this.vz = 0;
  }

  jumpTo(x: number, z: number, dist: number) {
    this.flyTo(x, z, dist);
    this.tx = this.gx;
    this.tz = this.gz;
    this.dist = this.gdist;
    this.place();
  }

  /** 화면 좌표 → 땅 위의 점 */
  groundPoint(clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  /** 화면 좌표로 쏜 광선 (탭한 물체 찾기용) */
  rayFrom(clientX: number, clientY: number): THREE.Ray {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray;
  }

  update(dt: number) {
    const b = this.opts.bounds;
    if (this.pointers.size === 0) {
      // 손을 뗀 뒤에도 살짝 미끄러진다
      this.gx += this.vx * dt;
      this.gz += this.vz * dt;
      const damp = Math.exp(-dt * 5.5);
      this.vx *= damp;
      this.vz *= damp;
    }
    this.gx = THREE.MathUtils.clamp(this.gx, b.minX, b.maxX);
    this.gz = THREE.MathUtils.clamp(this.gz, b.minZ, b.maxZ);
    const k = 1 - Math.exp(-dt * 7);
    this.tx += (this.gx - this.tx) * k;
    this.tz += (this.gz - this.tz) * k;
    this.dist *= Math.pow(this.gdist / this.dist, k);
    this.place();
  }

  dispose() {
    for (const [type, fn, o] of this.listeners) this.dom.removeEventListener(type, fn, o);
    this.listeners.length = 0;
  }

  private place() {
    const t = this.zoomT;
    const ease = t * t * (3 - 2 * t);
    const pitch = THREE.MathUtils.lerp(PITCH_NEAR, PITCH_FAR, ease);
    const lift = THREE.MathUtils.lerp(0.55, 0, ease);
    const y = this.opts.groundY + lift;
    this.camera.position.set(this.tx, y + Math.sin(pitch) * this.dist, this.tz + Math.cos(pitch) * this.dist);
    this.camera.lookAt(this.tx, y, this.tz);
    // 카메라 바로 앞을 가리는 나무나 집은 잘라낸다
    const near = Math.max(1, this.dist * 0.42);
    if (Math.abs(near - this.camera.near) > 0.01) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  private onDown(e: PointerEvent) {
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.downAt = performance.now();
      this.moved = 0;
      this.multi = false;
      this.vx = this.vz = 0;
      // 드래그를 시작하면 날아가던 이동은 멈춘다
      this.gx = this.tx;
      this.gz = this.tz;
    } else {
      this.multi = true;
      this.pinchDist = this.pointerSpread();
    }
  }

  private onMove(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const before = this.center();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    const after = this.center();

    // 손가락(들)의 가운데가 움직인 만큼 땅을 끌어온다
    const a = this.groundPoint(before.x, before.y, this.tmp);
    const b = this.groundPoint(after.x, after.y, this.tmp2);
    if (a && b) {
      const mx = a.x - b.x;
      const mz = a.z - b.z;
      this.gx += mx;
      this.gz += mz;
      this.tx += mx;
      this.tz += mz;
      const inst = 1 / Math.max(1 / 240, 1 / 60);
      this.vx = this.vx * 0.6 + mx * inst * 0.4;
      this.vz = this.vz * 0.6 + mz * inst * 0.4;
    }
    if (this.pointers.size >= 2) {
      const spread = this.pointerSpread();
      if (this.pinchDist > 0 && spread > 0) {
        const ratio = this.pinchDist / spread;
        this.gdist = THREE.MathUtils.clamp(this.gdist * ratio, this.opts.minDist, this.opts.maxDist);
        this.dist = THREE.MathUtils.clamp(this.dist * ratio, this.opts.minDist, this.opts.maxDist);
      }
      this.pinchDist = spread;
      this.vx = this.vz = 0;
    }
    this.place();
  }

  private onUp(e: PointerEvent, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.dom.releasePointerCapture?.(e.pointerId);
    if (this.pointers.size === 1) this.pinchDist = 0;
    if (this.pointers.size === 0) {
      const quick = performance.now() - this.downAt < 400;
      if (!cancelled && !this.multi && quick && this.moved < 10) {
        this.vx = this.vz = 0;
        this.tapCb?.(e.clientX, e.clientY);
      }
      if (this.multi) this.vx = this.vz = 0;
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const scale = Math.exp(THREE.MathUtils.clamp(e.deltaY, -120, 120) * 0.0016);
    this.gdist = THREE.MathUtils.clamp(this.gdist * scale, this.opts.minDist, this.opts.maxDist);
  }

  private center() {
    let x = 0;
    let y = 0;
    for (const p of this.pointers.values()) {
      x += p.x;
      y += p.y;
    }
    const n = Math.max(1, this.pointers.size);
    return { x: x / n, y: y / n };
  }

  private pointerSpread() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}
