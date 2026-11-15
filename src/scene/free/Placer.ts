import * as THREE from 'three';
import { createGlowLambert, type GlowShared } from '../core/glowLambert';
import { FREE_ITEMS, itemDef, type ItemGeometries } from './catalog';
import type { DrawingStore } from './drawings';
import { artMatrix, YARD_LIFT } from './FreeItems';
import { canPlace, itemMatrix, pickItem, toLocal, WALL_HEIGHT, wallOf, type Space } from './space';
import type { PlacedItem } from './types';

/**
 * 꾸미기 모드: 아이템을 손가락으로 끌어서 놓고 돌린다.
 *
 * - 아이템 위에서 누른 채 끌면 그 아이템이 손가락을 따라온다 (바닥 것은 바닥 위로, 벽걸이는 벽을 따라).
 * - 끄는 동안 다른 손가락을 대고 비틀면 돌아간다. rotate() 로도 돌릴 수 있다.
 * - 다른 것과 겹치거나 밖으로 나가면 빨갛게 보이고, 그 상태로 손을 떼면 마지막으로 놓였던 자리로 돌아간다.
 * - 놓일 때마다 onPlace 를 부른다 (새 아이템이든 옮긴 아이템이든 같은 id 로 "이 값으로 저장").
 * - 끌지 않고 짧게 누르면 onPick 을 부른다.
 *
 * 아이템 위에서 시작한 터치만 가져가고, 빈 곳의 터치는 그대로 카메라/조이스틱으로 간다.
 */
const TAP_PX = 7;
const TAP_MS = 400;
const OK_COLOR = new THREE.Color('#ffffff');
const BAD_COLOR = new THREE.Color('#ff5a5a');
const RING_OK = new THREE.Color('#6fdc8c');
const RING_BAD = new THREE.Color('#ff5a5a');

const round2 = (v: number) => Math.round(v * 100) / 100;
const wrap = (a: number) => {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return Math.round(a * 10000) / 10000;
};
const newId = () => `i${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;

export class Placer {
  readonly group = new THREE.Group();
  active = false;
  space: Space | null = null;
  onPlace: ((item: PlacedItem) => void) | null = null;
  onPick: ((itemId: string) => void) | null = null;
  /** 목록이나 손에 든 아이템이 바뀌어서 다시 그려야 할 때 */
  onChange: (() => void) | null = null;

  private list: PlacedItem[] = [];
  private held: PlacedItem | null = null;
  /** 손에 든 아이템이 목록에 놓여 있는가 (새로 꺼냈는데 놓을 자리가 없으면 false) */
  private placed = false;
  private valid = true;
  private dragId = -1;
  private twistId = -1;
  private twistFrom = 0;
  private twistRot = 0;
  private downX = 0;
  private downY = 0;
  private downAt = 0;
  private moved = 0;
  /** 아이템을 든 채 빈 곳을 누른 터치 (짧게 누르면 그 자리로 옮긴다. 끌면 카메라가 움직인다) */
  private groundId = -1;
  private groundX = 0;
  private groundY = 0;
  private groundAt = 0;
  private revertTimer: ReturnType<typeof setTimeout> | undefined;
  private offX = 0;
  private offZ = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  private readonly heldMesh: THREE.Mesh;
  private readonly heldMat: THREE.MeshLambertMaterial;
  private readonly artMesh: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly v = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly l = { x: 0, z: 0 };
  private readonly off: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly geometries: ItemGeometries,
    private readonly drawings: DrawingStore,
    shared: GlowShared,
  ) {
    this.heldMat = createGlowLambert(shared, { instanced: false });
    this.heldMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.heldMat);
    this.heldMesh.castShadow = true;
    this.artMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    this.ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.36, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.renderOrder = 3;
    for (const mesh of [this.heldMesh, this.artMesh, this.ring]) {
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.visible = false;

    // 캔버스의 다른 조작(카메라, 조이스틱)보다 먼저 받아서, 아이템을 누른 터치만 가져간다
    const on = (type: string, fn: (e: PointerEvent) => void) => {
      window.addEventListener(type, fn as EventListener, true);
      this.off.push(() => window.removeEventListener(type, fn as EventListener, true));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', (e) => this.onUp(e));
  }

  /** 지금 손에 든 아이템 (따로 그리므로 FreeItems 는 이 id 를 건너뛴다) */
  get heldId(): string | null {
    return this.held ? this.held.id : null;
  }
  get dragging() {
    return this.dragId >= 0;
  }
  /** 확인용 */
  get state() {
    return { active: this.active, held: this.held ? { ...this.held } : null, valid: this.valid, placed: this.placed };
  }

  /**
   * 꾸미기 시작. typeOrId 가 목록에 있는 아이템 id 면 그 아이템을 집고,
   * 아이템 종류 이름이면 새로 하나 꺼내서 빈 자리에 놓는다. null 이면 아무것도 들지 않는다.
   */
  begin(space: Space, list: PlacedItem[], typeOrId: string | null) {
    this.cancelDrag();
    this.space = space;
    this.list = list;
    this.active = true;
    this.held = null;
    this.placed = false;
    if (typeOrId) {
      const existing = list.find((it) => it.id === typeOrId);
      if (existing) this.hold(existing);
      else if (Object.prototype.hasOwnProperty.call(FREE_ITEMS, typeOrId)) this.add(typeOrId);
      else console.warn(`[scene] startPlacing: '${typeOrId}' 는 놓인 아이템 id 도, 아이템 종류 이름도 아니에요`);
    }
    this.refresh();
    this.onChange?.();
  }

  end() {
    if (!this.active) return;
    this.cancelDrag();
    this.active = false;
    this.held = null;
    this.space = null;
    this.group.visible = false;
    this.onChange?.();
  }

  /** 목록이 통째로 바뀌었을 때 (앱이 setYardItemsFree 등을 다시 부름) */
  relist(list: PlacedItem[]) {
    this.list = list;
    if (this.held && !this.dragging) {
      const now = list.find((it) => it.id === this.held!.id);
      if (now) this.hold(now);
      else if (this.placed) this.held = null;
    }
    this.refresh();
  }

  /** 손에 든 아이템을 돌린다 (라디안. 기본 45도) */
  rotate(step = Math.PI / 4) {
    const h = this.held;
    if (!h || !this.space || itemDef(h.type).mount === 'wall') return;
    h.rotY = wrap(h.rotY + step);
    this.valid = canPlace(this.space, h, this.list);
    if (!this.dragging) this.commit(false);
    this.refresh();
  }

  /** 그림 목록이 바뀌었을 때 */
  refresh() {
    const h = this.held;
    const s = this.space;
    if (!h || !s || !this.active) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const def = itemDef(h.type);
    const lift = (s.kind === 'yard' ? YARD_LIFT : 0) + (this.dragging && def.mount !== 'wall' ? 0.07 : 0);
    this.heldMesh.geometry = this.geometries.get(h.type);
    itemMatrix(s, h, lift, this.heldMesh.matrix);
    this.heldMat.color.copy(this.valid ? OK_COLOR : BAD_COLOR);
    const art = def.art ? this.drawings.material(h.drawingId) : null;
    this.artMesh.visible = !!art && this.valid;
    if (art && def.art) {
      this.artMesh.material = art;
      artMatrix(this.heldMesh.matrix, def.art, this.artMesh.matrix);
    }
    // 차지하는 자리 표시: 놓을 수 있으면 초록, 아니면 빨강
    this.ringMat.color.copy(this.valid ? RING_OK : RING_BAD);
    if (def.mount === 'wall') {
      // 벽면에 붙인 네모
      this.m.makeRotationX(Math.PI / 2).setPosition(0, (def.y0 ?? 0) + def.height / 2, 0.012);
      this.ring.matrix.copy(itemMatrix(s, h, 0, this.heldMesh.matrix)).multiply(this.m);
      this.ring.matrix.scale(this.s.set(def.hx * 2 + 0.16, 1, def.height + 0.16));
    } else {
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), s.rot + h.rotY);
      this.v.set(s.ox + h.x * s.cos + h.z * s.sin, s.y + (s.kind === 'yard' ? YARD_LIFT : 0) + (def.mount === 'rug' ? 0.06 : 0.02), s.oz - h.x * s.sin + h.z * s.cos);
      this.ring.matrix.compose(this.v, this.q, this.s.set(def.hx * 2 + 0.18, 1, def.hz * 2 + 0.18));
    }
  }

  dispose() {
    for (const fn of this.off) fn();
    this.off.length = 0;
    this.heldMat.dispose();
    this.ringMat.dispose();
    this.artMesh.geometry.dispose();
    this.ring.geometry.dispose();
  }

  // ───────────── 집기 / 놓기 ─────────────

  private hold(item: PlacedItem) {
    this.held = { ...item };
    this.placed = true;
    this.valid = true;
  }

  /** 새 아이템을 꺼내서 빈 자리를 찾아 놓는다 */
  private add(type: string) {
    const s = this.space!;
    const def = itemDef(type);
    if (def.mount === 'wall' && s.kind !== 'room') {
      console.warn(`[scene] startPlacing: '${type}' 은 벽에 거는 아이템이라 집 안에서만 놓을 수 있어요`);
      return;
    }
    const item: PlacedItem = { id: newId(), type, x: 0, z: 0, rotY: 0 };
    this.held = item;
    this.placed = false;
    this.valid = false;
    if (def.mount === 'wall') {
      // 뒤쪽 벽 가운데부터, 그다음 왼쪽 벽
      for (let w = 0; w < 2 && !this.valid; w++) {
        for (let i = 0; i < 14 && !this.valid; i++) {
          const along = Math.ceil(i / 2) * 0.6 * (i % 2 ? 1 : -1);
          if (w === 0) Object.assign(item, { x: round2(along), z: -s.wall, rotY: 0 });
          else Object.assign(item, { x: -s.wall, z: round2(along), rotY: wrap(Math.PI / 2) });
          this.valid = canPlace(s, item, this.list);
        }
      }
      if (!this.valid) Object.assign(item, { x: 0, z: -s.wall, rotY: 0 });
    } else {
      // 공간 앞쪽 가운데에서 시작해 바깥으로 돌아가며 찾는다
      const cx = (s.minX + s.maxX) / 2;
      const cz = s.kind === 'yard' ? 1.6 : 0.6;
      search: for (let ring = 0; ring < 12; ring++) {
        const n = ring === 0 ? 1 : ring * 8;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          item.x = round2(cx + Math.sin(a) * ring * 0.4);
          item.z = round2(cz + Math.cos(a) * ring * 0.4);
          if (canPlace(s, item, this.list)) {
            this.valid = true;
            break search;
          }
        }
      }
      if (!this.valid) {
        item.x = round2(cx);
        item.z = round2(cz);
      }
    }
    if (this.valid) this.commit(true);
  }

  /** 지금 자리가 괜찮으면 목록에 넣고 알린다. 아니면 마지막으로 놓였던 자리로 되돌린다 */
  private commit(revert: boolean) {
    const h = this.held;
    if (!h) return;
    const i = this.list.findIndex((it) => it.id === h.id);
    if (this.valid) {
      const saved = { ...h };
      if (i >= 0) this.list[i] = saved;
      else this.list.push(saved);
      this.placed = true;
      this.onPlace?.({ ...saved });
      this.onChange?.();
    } else if (revert && i >= 0) {
      this.hold(this.list[i]);
    }
  }

  // ───────────── 터치 ─────────────

  private ray(e: { clientX: number; clientY: number }): THREE.Ray {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }

  /** 광선이 바닥에 닿는 점 (공간 좌표). 못 닿으면 null */
  private floorPoint(ray: THREE.Ray): { x: number; z: number } | null {
    const s = this.space!;
    this.plane.constant = -s.y;
    const hit = ray.intersectPlane(this.plane, this.v);
    return hit ? toLocal(s, hit.x, hit.z, this.l) : null;
  }

  /** 광선이 가리키는 벽과 그 벽을 따라간 위치 (집 안은 공간 좌표와 화면 좌표가 같다) */
  private wallPoint(ray: THREE.Ray): { wall: number; along: number } | null {
    const s = this.space!;
    const o = ray.origin;
    const d = ray.direction;
    let best: { wall: number; along: number } | null = null;
    let bestT = Infinity;
    if (d.z < -1e-5) {
      const t = (-s.wall - o.z) / d.z;
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      if (t > 0 && Math.abs(x) <= s.wall && y >= 0 && y <= WALL_HEIGHT + 0.6) {
        bestT = t;
        best = { wall: 0, along: x };
      }
    }
    if (d.x < -1e-5) {
      const t = (-s.wall - o.x) / d.x;
      const z = o.z + d.z * t;
      const y = o.y + d.y * t;
      if (t > 0 && t < bestT && Math.abs(z) <= s.wall && y >= 0 && y <= WALL_HEIGHT + 0.6) best = { wall: 1, along: z };
    }
    if (best) return best;
    // 바닥을 가리키고 있으면 가까운 쪽 벽으로 친다
    const f = this.floorPoint(ray);
    if (!f) return null;
    return f.x + s.wall < f.z + s.wall ? { wall: 1, along: f.z } : { wall: 0, along: f.x };
  }

  private onDown(e: PointerEvent) {
    if (!this.active || !this.space || e.target !== this.canvas) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.dragId >= 0) {
      // 끄는 중에 다른 손가락을 대면 비틀어서 돌린다
      if (this.twistId < 0 && this.held && itemDef(this.held.type).mount !== 'wall') {
        this.twistId = e.pointerId;
        this.twistFrom = this.twistAngle();
        this.twistRot = this.held.rotY;
        this.moved = TAP_PX + 1;
      }
      e.stopPropagation();
      return;
    }
    const ray = this.ray(e);
    // 손에 든 아이템은 지금 보이는 자리로 찾는다
    const h = this.held;
    const shown = h ? [...this.list.filter((it) => it.id !== h.id), h] : this.list;
    const hit = pickItem(this.space, shown, ray);
    if (!hit) {
      this.pointers.delete(e.pointerId);
      // 2026-11-15: 아이템을 든 채 빈 곳을 짧게 누르면 그 자리로 옮긴다 (터치는 카메라에도 그대로 간다)
      if (h && this.groundId < 0) {
        this.groundId = e.pointerId;
        this.groundX = e.clientX;
        this.groundY = e.clientY;
        this.groundAt = performance.now();
      }
      return;
    }
    if (!h || hit.id !== h.id) {
      this.hold(hit);
      this.onChange?.();
    }
    const held = this.held!;
    this.dragId = e.pointerId;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downAt = performance.now();
    this.moved = 0;
    if (itemDef(held.type).mount === 'wall') {
      const w = this.wallPoint(ray);
      const cur = wallOf(this.space, held);
      this.offX = w && w.wall === cur ? (cur === 0 ? held.x : held.z) - w.along : 0;
    } else {
      const f = this.floorPoint(ray);
      this.offX = f ? held.x - f.x : 0;
      this.offZ = f ? held.z - f.z : 0;
      // 높은 가구는 윗부분을 누르면 바닥 점이 멀리 잡히므로, 너무 벌어진 값은 쓰지 않는다
      if (Math.hypot(this.offX, this.offZ) > 2.2) this.offX = this.offZ = 0;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 이미 끝난 터치 */
    }
    e.stopPropagation();
    e.preventDefault();
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId === this.groundId && Math.hypot(e.clientX - this.groundX, e.clientY - this.groundY) > TAP_PX) this.groundId = -1;
    const p = this.pointers.get(e.pointerId);
    if (!p || this.dragId < 0 || !this.space || !this.held) return;
    p.x = e.clientX;
    p.y = e.clientY;
    e.stopPropagation();
    const s = this.space;
    const h = this.held;
    const def = itemDef(h.type);
    if (e.pointerId === this.twistId) {
      // 15도씩 끊어서 돌린다
      const a = this.twistRot - (this.twistAngle() - this.twistFrom);
      h.rotY = wrap(Math.round(a / (Math.PI / 12)) * (Math.PI / 12));
    } else if (e.pointerId === this.dragId) {
      this.moved = Math.max(this.moved, Math.hypot(e.clientX - this.downX, e.clientY - this.downY));
      if (this.moved < TAP_PX) return;
      const ray = this.ray(e);
      if (def.mount === 'wall') {
        const w = this.wallPoint(ray);
        if (!w) return;
        const lim = s.wall - def.hx - 0.06;
        const along = round2(Math.max(-lim, Math.min(lim, w.along + (w.wall === wallOf(s, h) ? this.offX : 0))));
        if (w.wall === 0) Object.assign(h, { x: along, z: -s.wall, rotY: 0 });
        else Object.assign(h, { x: -s.wall, z: along, rotY: wrap(Math.PI / 2) });
      } else {
        const f = this.floorPoint(ray);
        if (!f) return;
        // 가운데가 공간 밖으로 나가지는 않게 한다
        const pad = Math.min(def.hx, def.hz);
        h.x = round2(Math.max(s.minX + pad, Math.min(s.maxX - pad, f.x + this.offX)));
        h.z = round2(Math.max(s.minZ + pad, Math.min(s.maxZ - pad, f.z + this.offZ)));
      }
    } else return;
    this.valid = canPlace(s, h, this.list);
    this.refresh();
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId === this.groundId) {
      this.groundId = -1;
      if (e.type === 'pointerup' && performance.now() - this.groundAt < TAP_MS && this.active && this.space && this.held && this.dragId < 0) this.moveHeldTo(this.ray(e));
      return;
    }
    if (!this.pointers.delete(e.pointerId)) return;
    if (e.pointerId === this.twistId) {
      this.twistId = -1;
      e.stopPropagation();
      return;
    }
    if (e.pointerId !== this.dragId) return;
    e.stopPropagation();
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.dragId = -1;
    this.twistId = -1;
    const tap = e.type === 'pointerup' && this.moved < TAP_PX && performance.now() - this.downAt < TAP_MS;
    if (tap) {
      if (this.held) this.onPick?.(this.held.id);
    } else this.commit(true);
    this.refresh();
  }

  /** 손에 든 아이템을 광선이 가리키는 자리로 옮긴다. 놓을 수 있으면 바로 놓고, 아니면 빨갛게 그 자리에 둔다 */
  private moveHeldTo(ray: THREE.Ray) {
    const s = this.space!;
    const h = this.held!;
    const def = itemDef(h.type);
    if (def.mount === 'wall') {
      const w = this.wallPoint(ray);
      if (!w) return;
      const lim = s.wall - def.hx - 0.06;
      const along = round2(Math.max(-lim, Math.min(lim, w.along)));
      if (w.wall === 0) Object.assign(h, { x: along, z: -s.wall, rotY: 0 });
      else Object.assign(h, { x: -s.wall, z: along, rotY: wrap(Math.PI / 2) });
    } else {
      const f = this.floorPoint(ray);
      if (!f) return;
      if (f.x < s.minX - 0.6 || f.x > s.maxX + 0.6 || f.z < s.minZ - 0.6 || f.z > s.maxZ + 0.6) return;
      const pad = Math.min(def.hx, def.hz);
      h.x = round2(Math.max(s.minX + pad, Math.min(s.maxX - pad, f.x)));
      h.z = round2(Math.max(s.minZ + pad, Math.min(s.maxZ - pad, f.z)));
    }
    this.valid = canPlace(s, h, this.list);
    if (this.valid) this.commit(false);
    else {
      // 놓을 수 없는 곳: 잠깐 빨갛게 보여 준 뒤 마지막으로 놓였던 자리로 돌아간다
      const id = h.id;
      clearTimeout(this.revertTimer);
      this.revertTimer = setTimeout(() => {
        if (this.held?.id !== id || this.dragging || this.valid) return;
        this.commit(true);
        this.valid = true;
        this.refresh();
        this.onChange?.();
      }, 650);
    }
    this.refresh();
    this.onChange?.();
  }

  private cancelDrag() {
    this.groundId = -1;
    if (this.dragId >= 0 && this.canvas.hasPointerCapture?.(this.dragId)) this.canvas.releasePointerCapture(this.dragId);
    this.dragId = -1;
    this.twistId = -1;
    this.pointers.clear();
  }

  /** 끄는 손가락에서 비트는 손가락으로 가는 방향 */
  private twistAngle(): number {
    const a = this.pointers.get(this.dragId);
    const b = this.pointers.get(this.twistId);
    return a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
  }
}
