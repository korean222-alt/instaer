/**
 * 걷기 조작.
 * - 모바일: 화면 왼쪽 아래에 손가락을 대면 그 자리에서 가상 조이스틱이 시작된다.
 *           그 밖의 빈 곳을 드래그하면 카메라가 좌우로 돈다. 오른쪽 아래에 점프 버튼.
 * - PC: WASD / 방향키로 이동, 마우스 드래그로 카메라 회전, 스페이스로 점프.
 *
 * 조이스틱과 점프 버튼은 걷기 모드일 때만 보인다. 캔버스 위에 겹쳐 놓고,
 * 아래쪽 홈 바(safe-area-inset-bottom)와 겹치지 않게 띄운다.
 */
const BASE = 132; // 조이스틱 바닥 지름(px). 엄지로 쓰기 쉬운 크기
const KNOB = 58;
const REACH = (BASE - KNOB) / 2 + 10; // 손잡이가 움직이는 반지름
const DEAD = 0.1;
const LOOK_SPEED = 0.0062; // 드래그 1px 당 회전(라디안)

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class WalkControls {
  /** 이동 입력. x: 오른쪽 +, y: 앞(화면 위쪽) +. 길이는 0~1 (살짝 밀면 작다) */
  moveX = 0;
  moveY = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly jumpBtn: HTMLButtonElement;
  private active = false;
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private stickMX = 0;
  private stickMY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookDelta = 0;
  private lookMoved = 0;
  private lookDownAt = 0;
  /** 2026-11-18 꾸미기: 조이스틱 없이 빈 곳 끌기는 모두 화면 돌리기(좌우)/기울이기(위아래), 두 손가락은 확대 */
  lookOnly = false;
  private lookY = 0;
  private lookDeltaY = 0;
  private pinchId = -1;
  private pinchX = 0;
  private pinchY = 0;
  private pinchFrom = 0;
  private zoomRatio = 1;
  private jump = false;
  private readonly held = new Set<string>();
  private tapCb: ((clientX: number, clientY: number) => void) | null = null;
  private readonly off: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string) => {
      const e = document.createElement(tag);
      e.style.cssText = css;
      return e;
    };
    // 캔버스와 같은 자리에 겹치는 판. 판 자체는 터치를 받지 않는다 (조이스틱 터치는 캔버스가 받는다)
    this.root = el(
      'div',
      'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:5;display:none;touch-action:none;user-select:none;-webkit-user-select:none;',
    );
    this.root.setAttribute('data-walk-ui', '');
    const bottom = 'calc(env(safe-area-inset-bottom, 0px) + 34px)';
    this.base = el(
      'div',
      `position:absolute;left:calc(env(safe-area-inset-left, 0px) + 26px);bottom:${bottom};width:${BASE}px;height:${BASE}px;` +
        'border-radius:50%;background:rgba(255,252,245,0.34);border:2px solid rgba(255,255,255,0.75);' +
        'box-shadow:0 4px 16px rgba(70,50,30,0.16);box-sizing:border-box;transition:opacity 0.15s ease;opacity:0.7;',
    );
    this.knob = el(
      'div',
      `position:absolute;left:50%;top:50%;width:${KNOB}px;height:${KNOB}px;margin:${-KNOB / 2}px 0 0 ${-KNOB / 2}px;` +
        'border-radius:50%;background:rgba(255,252,245,0.95);box-shadow:0 2px 8px rgba(70,50,30,0.28);will-change:transform;',
    );
    this.base.append(this.knob);
    this.jumpBtn = el(
      'button',
      `position:absolute;right:calc(env(safe-area-inset-right, 0px) + 26px);bottom:calc(env(safe-area-inset-bottom, 0px) + 52px);` +
        'width:78px;height:78px;border-radius:50%;border:2px solid rgba(255,255,255,0.8);background:rgba(255,143,122,0.92);' +
        'color:#fff;font:700 15px "Pretendard","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;' +
        'box-shadow:0 4px 16px rgba(70,50,30,0.22);pointer-events:auto;touch-action:none;cursor:pointer;padding:0;' +
        '-webkit-tap-highlight-color:transparent;transition:transform 0.08s ease;',
    );
    this.jumpBtn.type = 'button';
    this.jumpBtn.textContent = '점프';
    this.jumpBtn.setAttribute('aria-label', '점프');
    this.root.append(this.base, this.jumpBtn);
    (canvas.parentElement ?? document.body).append(this.root);

    const on = <T extends Event>(target: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on<PointerEvent>(canvas, 'pointerdown', (e) => this.onDown(e));
    on<PointerEvent>(canvas, 'pointermove', (e) => this.onMove(e));
    on<PointerEvent>(canvas, 'pointerup', (e) => this.onUp(e, false));
    on<PointerEvent>(canvas, 'pointercancel', (e) => this.onUp(e, true));
    on<PointerEvent>(this.jumpBtn, 'pointerdown', (e) => {
      e.preventDefault();
      this.jump = true;
      this.jumpBtn.style.transform = 'scale(0.92)';
    });
    const release = () => (this.jumpBtn.style.transform = '');
    on(this.jumpBtn, 'pointerup', release);
    on(this.jumpBtn, 'pointercancel', release);
    on(this.jumpBtn, 'pointerleave', release);
    on<KeyboardEvent>(window, 'keydown', (e) => {
      if (!this.active || e.metaKey || e.ctrlKey || e.altKey) return;
      // 2026-11-19: 글자를 쓰는 중(채팅, 게시판, 소원 칸)에는 스페이스/방향키를 가로채지 않는다 (띄어쓰기하면 점프하던 문제)
      if (e.isComposing || typingIn(e.target)) return;
      if (e.code === 'Space') {
        this.jump = true;
        e.preventDefault();
      } else if (KEYS[e.code]) {
        this.held.add(e.code);
        e.preventDefault();
      }
    });
    on<KeyboardEvent>(window, 'keyup', (e) => this.held.delete(e.code));
    // 글자 칸을 누르면 들고 있던 방향키를 놓는다 (고양이가 혼자 계속 걷지 않게)
    on<FocusEvent>(window, 'focusin', (e) => {
      if (typingIn(e.target)) this.held.clear();
    });
    on(window, 'blur', () => this.held.clear());
    on(window, 'resize', () => this.layout());
  }

  /** 걷기 모드를 켜고 끈다 (조이스틱과 점프 버튼이 같이 보이고 숨는다) */
  setActive(on: boolean) {
    this.active = on;
    this.root.style.display = on ? 'block' : 'none';
    this.reset();
    if (on) this.layout();
  }

  /** 빈 곳을 짧게 눌렀을 때 (집 누르기용) */
  onTap(cb: (clientX: number, clientY: number) => void) {
    this.tapCb = cb;
  }

  /** 지난번 이후 쌓인 위아래 끌기 (화면 높이에 대한 비율, 아래로 끌면 +) */
  takeLookY(): number {
    const d = this.lookDeltaY;
    this.lookDeltaY = 0;
    return d;
  }

  /** 지난번 이후 두 손가락 벌림 비율 (1보다 크면 벌렸다 = 가까이) */
  takeZoom(): number {
    const r = this.zoomRatio;
    this.zoomRatio = 1;
    return r;
  }

  /** 지난번 이후 쌓인 카메라 회전량(라디안)을 꺼낸다 */
  takeLook(): number {
    const d = this.lookDelta;
    this.lookDelta = 0;
    return d;
  }

  /** 점프가 눌렸으면 true (한 번만) */
  takeJump(): boolean {
    const j = this.jump;
    this.jump = false;
    return j;
  }

  /** 매 프레임: 조이스틱과 키보드를 합쳐서 moveX/moveY 를 정한다 */
  update() {
    let x = this.stickMX;
    let y = this.stickMY;
    if (this.held.size) {
      let kx = 0;
      let ky = 0;
      for (const code of this.held) {
        kx += KEYS[code][0];
        ky += KEYS[code][1];
      }
      const len = Math.hypot(kx, ky);
      if (len > 0) {
        x = kx / len;
        y = ky / len;
      }
    }
    this.moveX = x;
    this.moveY = y;
  }

  /** 캔버스 크기가 바뀌면 겹쳐 놓은 판도 맞춘다 */
  layout() {
    if (!this.active) return;
    const r = this.canvas.getBoundingClientRect();
    const s = this.root.style;
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
  }

  dispose() {
    for (const fn of this.off) fn();
    this.off.length = 0;
    this.root.remove();
  }

  private reset() {
    this.stickId = -1;
    this.lookId = -1;
    this.stickMX = this.stickMY = 0;
    this.moveX = this.moveY = 0;
    this.lookDelta = 0;
    this.lookDeltaY = 0;
    this.pinchId = -1;
    this.zoomRatio = 1;
    this.jump = false;
    this.held.clear();
    this.base.style.transform = '';
    this.base.style.opacity = '0.7';
    this.knob.style.transform = '';
  }

  private onDown(e: PointerEvent) {
    if (!this.active) return;
    const r = this.canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    const b = this.base.getBoundingClientRect();
    const onBase = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2)) < BASE * 0.62;
    // 왼쪽 아래 영역(터치) 또는 조이스틱 그림 위(마우스 포함)에서 시작하면 조이스틱
    const stickZone = e.pointerType !== 'mouse' && u < 0.56 && v > 0.42;
    if (this.lookOnly && this.lookId >= 0 && this.pinchId < 0 && e.pointerId !== this.lookId) {
      // 두 번째 손가락: 확대/축소 (그동안 돌리기는 멈춘다)
      this.pinchId = e.pointerId;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.pinchX = e.clientX;
      this.pinchY = e.clientY;
      this.pinchFrom = Math.hypot(this.pinchX - this.lookX, this.pinchY - this.lookY);
      this.lookMoved = 99;
      return;
    }
    if (!this.lookOnly && this.stickId < 0 && (stickZone || onBase)) {
      this.stickId = e.pointerId;
      this.canvas.setPointerCapture?.(e.pointerId);
      // 손가락을 댄 곳이 조이스틱 가운데가 된다 (화면 밖으로 나가지 않게만 한다)
      const half = BASE / 2;
      this.stickX = Math.min(r.right - half - 6, Math.max(r.left + half + 6, e.clientX));
      this.stickY = Math.min(r.bottom - half - 6, Math.max(r.top + half + 6, e.clientY));
      // transform 을 지운 원래 자리 기준으로 옮길 거리를 구한다
      this.base.style.transform = '';
      const home = this.base.getBoundingClientRect();
      this.base.style.transform = `translate(${this.stickX - (home.left + half)}px, ${this.stickY - (home.top + half)}px)`;
      this.base.style.opacity = '1';
      this.moveStick(e);
      return;
    }
    if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.lookMoved = 0;
      this.lookDownAt = performance.now();
    }
  }

  private pinchMove() {
    const d = Math.hypot(this.pinchX - this.lookX, this.pinchY - this.lookY);
    if (this.pinchFrom > 20 && d > 20) this.zoomRatio *= d / this.pinchFrom;
    this.pinchFrom = d;
  }

  private onMove(e: PointerEvent) {
    if (!this.active) return;
    if (e.pointerId === this.stickId) this.moveStick(e);
    else if (e.pointerId === this.pinchId) {
      this.pinchX = e.clientX;
      this.pinchY = e.clientY;
      this.pinchMove();
    } else if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.lookX;
      const dy = e.clientY - this.lookY;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      if (this.pinchId >= 0) {
        this.pinchMove();
        return;
      }
      this.lookMoved += Math.abs(dx) + (this.lookOnly ? Math.abs(dy) : 0);
      this.lookDelta -= dx * LOOK_SPEED;
      if (this.lookOnly) this.lookDeltaY += dy / Math.max(200, this.canvas.clientHeight);
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean) {
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.stickMX = this.stickMY = 0;
      this.base.style.transform = '';
      this.base.style.opacity = '0.7';
      this.knob.style.transform = '';
    } else if (e.pointerId === this.pinchId) {
      this.pinchId = -1;
    } else if (e.pointerId === this.lookId) {
      this.lookId = -1;
      if (this.pinchId >= 0) {
        // 남은 손가락이 이어서 돌린다
        this.lookId = this.pinchId;
        this.lookX = this.pinchX;
        this.lookY = this.pinchY;
        this.pinchId = -1;
        this.lookMoved = 99;
      }
      if (this.active && !cancelled && this.lookMoved < 8 && performance.now() - this.lookDownAt < 400) {
        this.tapCb?.(e.clientX, e.clientY);
      }
    }
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }

  private moveStick(e: PointerEvent) {
    let dx = e.clientX - this.stickX;
    let dy = e.clientY - this.stickY;
    const len = Math.hypot(dx, dy);
    if (len > REACH) {
      dx *= REACH / len;
      dy *= REACH / len;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, len / REACH);
    if (m < DEAD) {
      this.stickMX = this.stickMY = 0;
      return;
    }
    // 가운데의 안 움직이는 범위를 뺀 만큼만 세기로 쓴다
    const k = (m - DEAD) / (1 - DEAD) / Math.max(1e-6, len);
    this.stickMX = (e.clientX - this.stickX) * k;
    this.stickMY = -(e.clientY - this.stickY) * k;
  }
}

/** 글자를 쓰는 칸인지 (input, textarea, 직접 고치는 글) */
function typingIn(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(t.type);
  return false;
}
