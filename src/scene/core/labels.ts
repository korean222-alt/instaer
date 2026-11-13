import * as THREE from 'three';

/**
 * 집 위에 뜨는 이름표(인스타 아이디). 화면에서 항상 같은 크기로 보인다.
 * 창립 주민은 금색 테두리 + 별.
 */
const FONT = '700 34px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

export interface LabelOptions {
  founder?: boolean;
  /** 빈 집 이름표는 흐리게 */
  muted?: boolean;
}

export function createLabelSprite(text: string, opts: LabelOptions = {}): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = FONT;
  const star = opts.founder ? 40 : 0;
  const padX = 26;
  const textW = Math.ceil(ctx.measureText(text).width);
  const w = textW + padX * 2 + star;
  const h = 62;
  const margin = 8;
  const tail = 12;
  canvas.width = w + margin * 2;
  canvas.height = h + margin * 2 + tail;

  const x0 = margin;
  const y0 = margin;
  const r = h / 2;
  const body = new Path2D();
  body.roundRect(x0, y0, w, h, r);
  const cx = canvas.width / 2;
  body.moveTo(cx - 11, y0 + h - 1);
  body.lineTo(cx, y0 + h + tail);
  body.lineTo(cx + 11, y0 + h - 1);
  body.closePath();

  ctx.shadowColor = 'rgba(70, 50, 30, 0.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = opts.muted ? 'rgba(255,255,255,0.78)' : '#ffffff';
  ctx.fill(body);
  ctx.shadowColor = 'transparent';
  if (opts.founder) {
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
    grad.addColorStop(0, '#ffd966');
    grad.addColorStop(1, '#f0a93a');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5;
    const ring = new Path2D();
    ring.roundRect(x0 + 2.5, y0 + 2.5, w - 5, h - 5, r - 2.5);
    ctx.stroke(ring);
  }

  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  let tx = x0 + padX;
  if (opts.founder) {
    ctx.fillStyle = '#f2ab2e';
    drawStar(ctx, tx + 14, y0 + h / 2, 15);
    tx += star;
  }
  ctx.fillStyle = opts.muted ? '#9a8f86' : '#5b4636';
  ctx.fillText(text, tx, y0 + h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    sizeAttenuation: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  // 꼬리 끝이 기준점에 오도록
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  sprite.userData.px = { w: canvas.width / 2, h: canvas.height / 2 };
  return sprite;
}

/** 화면 크기나 확대가 바뀔 때 이름표 크기를 다시 맞춘다 */
export function fitLabel(sprite: THREE.Sprite, camera: THREE.PerspectiveCamera, viewportH: number, scale = 1) {
  const px = sprite.userData.px as { w: number; h: number };
  const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewportH;
  sprite.scale.set(px.w * k * scale, px.h * k * scale, 1);
}

export function disposeLabel(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.48;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
