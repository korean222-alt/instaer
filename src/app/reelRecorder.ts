// 촬영 모드 자동 녹화 (2026-11-19, 사용자: "자동으로 녹화되게 만들어줘").
// 폰 화면 기록 없이 릴스 영상 파일을 바로 만든다.
// - 섬(WebGL 캔버스)을 매 프레임 녹화용 2D 캔버스에 복사하고 (씬 onAfterRender: 그림이 지워지기 전),
//   그 위에 촬영 글자들(#cinema 의 카드, 자막, 말풍선, 검은 화면)을 캔버스 글씨로 다시 그린다.
//   HTML 을 그대로 찍는 방법은 아이폰에서 캔버스가 막히거나 너무 느려서, 상자 색/둥근 모서리/글자만 따라 그린다 (기울기와 그림자 일부는 생략).
// - 소리: 효과음, 배경 음악, 나레이션이 나가는 길을 녹화 스트림에도 잇는다 (sound.ts startRecordAudio).
// - 결과는 mp4 (아이폰 사파리, 최근 크롬) 또는 webm. 공유하기(사진에 저장)나 내려받기로 꺼낸다.
import type { IslandScene } from '../scene';
import { startRecordAudio, stopRecordAudio } from './audio/sound';

const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && pickType() !== null;
}

function pickType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of TYPES) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return null;
}

export interface Recording {
  /** 녹화를 끝내고 파일을 돌려준다 */
  stop(): Promise<Blob | null>;
  /** 저장하지 않고 버린다 */
  cancel(): void;
}

/** 녹화를 시작한다. sceneCanvas: 섬 캔버스, overlay: #cinema (패널은 그리지 않는다) */
export function startRecording(scene: IslandScene, sceneCanvas: HTMLCanvasElement, overlay: HTMLElement): Recording | null {
  const type = pickType();
  if (!type || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  // 화면 비율 그대로 (전에 폰 화면 기록으로 올린 것과 같게), 가로 1080 까지
  const cssW = sceneCanvas.clientWidth || innerWidth;
  const cssH = sceneCanvas.clientHeight || innerHeight;
  const W = even(Math.min(1080, sceneCanvas.width || cssW * 2));
  const H = even((W * cssH) / cssW);
  const scale = W / cssW;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const origin = sceneCanvas.getBoundingClientRect();

  // 영상은 초당 30장이다. 섬은 초당 60번까지 그려지는데, 그때마다 복사하면(GPU 에서 읽어 오기 + 글자 상자 다시 재기)
  // 폰이 버거워 화면이 끊긴다 (2026-11-20 사용자: "프레임이 너무 떨어져서 끊기는 것처럼 보여"). 30장 넘게는 복사하지 않는다.
  let lastDraw = 0;
  const draw = () => {
    const now = performance.now();
    if (now - lastDraw < 30) return;
    lastDraw = now;
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'transparent';
    try {
      ctx.drawImage(sceneCanvas, 0, 0, W, H);
    } catch {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    drawOverlay(ctx, overlay, scale, origin.left, origin.top);
  };
  scene.onAfterRender(draw);
  draw();

  const video = out.captureStream(30);
  const audio = startRecordAudio();
  const tracks = [...video.getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
  const stream = new MediaStream(tracks);
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 });
  } catch {
    try {
      rec = new MediaRecorder(stream);
    } catch {
      scene.onAfterRender(null);
      stopRecordAudio();
      return null;
    }
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  rec.start(1000);

  const finish = () => {
    scene.onAfterRender(null);
    stopRecordAudio();
    tracks.forEach((t) => t.stop());
  };
  return {
    stop: () =>
      new Promise<Blob | null>((ok) => {
        if (rec.state === 'inactive') {
          finish();
          ok(chunks.length ? new Blob(chunks, { type: rec.mimeType || type }) : null);
          return;
        }
        rec.onstop = () => {
          finish();
          ok(chunks.length ? new Blob(chunks, { type: rec.mimeType || type }) : null);
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      finish();
    },
  };
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

// ── 촬영 글자 다시 그리기 ──

interface Line {
  text: string;
  x: number;
  y: number;
}
/** 글자 덩어리의 줄 나눔은 글이나 자리가 바뀔 때만 다시 잰다 */
const lineCache = new WeakMap<Text, { key: string; lines: Line[] }>();

function drawOverlay(ctx: CanvasRenderingContext2D, root: HTMLElement, scale: number, ox: number, oy: number) {
  for (const el of Array.from(root.children) as HTMLElement[]) {
    if (el.classList.contains('cine-panel')) continue;
    drawEl(ctx, el, 1, scale, ox, oy);
  }
}

function drawEl(ctx: CanvasRenderingContext2D, el: HTMLElement, alpha: number, s: number, ox: number, oy: number) {
  if (el.hidden) return;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  const a = alpha * parseFloat(cs.opacity || '1');
  if (a <= 0.01) return;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  const x = (r.left - ox) * s;
  const y = (r.top - oy) * s;
  const w = r.width * s;
  const h = r.height * s;
  const bg = cs.backgroundColor;
  if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) {
    ctx.save();
    ctx.globalAlpha = a;
    if (cs.boxShadow && cs.boxShadow !== 'none') {
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 18 * s;
      ctx.shadowOffsetY = 6 * s;
    }
    ctx.fillStyle = bg;
    const rad = Math.min(parseFloat(cs.borderTopLeftRadius) * s || 0, w / 2, h / 2);
    roundRect(ctx, x, y, w, h, rad);
    ctx.fill();
    ctx.restore();
    // 말풍선 꼬리 (::after)
    if (el.classList.contains('cine-bub')) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - 6 * s, y + h - 1);
      ctx.lineTo(x + w / 2 + 6 * s, y + h - 1);
      ctx.lineTo(x + w / 2, y + h + 6 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) drawText(ctx, node as Text, cs, a, s, ox, oy);
    else if (node instanceof HTMLElement) drawEl(ctx, node, a, s, ox, oy);
  }
}

function drawText(ctx: CanvasRenderingContext2D, node: Text, cs: CSSStyleDeclaration, a: number, s: number, ox: number, oy: number) {
  const text = node.data;
  if (!text.trim()) return;
  const pr = node.parentElement!.getBoundingClientRect();
  const key = `${text}|${pr.left.toFixed(1)},${pr.top.toFixed(1)},${pr.width.toFixed(1)},${pr.height.toFixed(1)}`;
  let c = lineCache.get(node);
  if (!c || c.key !== key) {
    c = { key, lines: measureLines(node) };
    lineCache.set(node, c);
  }
  const size = parseFloat(cs.fontSize) || 16;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size * s}px ${cs.fontFamily}`;
  ctx.fillStyle = cs.color;
  ctx.textBaseline = 'middle';
  if (cs.textShadow && cs.textShadow !== 'none') {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 5 * s;
    ctx.shadowOffsetY = 2 * s;
  }
  for (const l of c.lines) ctx.fillText(l.text, (l.x - ox) * s, (l.y - oy) * s);
  ctx.restore();
}

/** 글자 하나하나의 자리를 재서 화면에 보이는 줄로 나눈다 */
function measureLines(node: Text): Line[] {
  const range = document.createRange();
  const lines: Line[] = [];
  let cur: { text: string; x: number; top: number; bottom: number } | null = null;
  let i = 0;
  for (const ch of Array.from(node.data)) {
    const len = ch.length;
    range.setStart(node, i);
    range.setEnd(node, i + len);
    i += len;
    const rects = range.getClientRects();
    const rc = rects[0];
    if (!rc || (rc.width === 0 && ch.trim() === '')) {
      if (cur && ch === ' ') cur.text += ' ';
      continue;
    }
    if (ch === '\n') continue;
    if (!cur || Math.abs(rc.top - cur.top) > rc.height * 0.5) {
      if (cur) lines.push({ text: cur.text.trimEnd(), x: cur.x, y: (cur.top + cur.bottom) / 2 });
      if (ch.trim() === '') {
        cur = null;
        continue;
      }
      cur = { text: ch, x: rc.left, top: rc.top, bottom: rc.bottom };
    } else cur.text += ch;
  }
  if (cur) lines.push({ text: cur.text.trimEnd(), x: cur.x, y: (cur.top + cur.bottom) / 2 });
  range.detach?.();
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 파일 이름: 고양이섬_릴스_2026-11-19_1830.mp4 */
export function videoFileName(blob: Blob, label: string): string {
  const d = new Date(Date.now() + 9 * 3600_000).toISOString();
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  return `goyangi_${label}_${d.slice(0, 10)}_${d.slice(11, 13)}${d.slice(14, 16)}.${ext}`;
}
