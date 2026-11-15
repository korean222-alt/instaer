// 그림 그리기: 32x32 픽셀, 16색. 씬과 같은 encodeDrawing / decodeDrawing / DEFAULT_PALETTE 를 쓴다.
import { decodeDrawing, DEFAULT_PALETTE, DRAWING_SIZE, encodeDrawing } from '../../scene';
import { DRAWING_MAX } from '../../shared/config';
import type { Drawing } from '../../shared/types';
import { drawingById, loadMyDrawings, myDrawingList, rememberDrawing } from '../art';
import { play } from '../audio/sound';
import { ApiError, saveDrawing } from '../net/api';
import { go } from '../router';
import { state } from '../state';
import { toast } from '../ui/toast';
import { refreshWallet } from '../wallet';
import type { Screen } from './types';

const N = DRAWING_SIZE;
type Tool = 'pen' | 'eraser' | 'fill';

/** 지붕 앞면의 가로:세로 (씬 houseGeometry 의 ROOF_ART_ASPECT 와 같다) */
export const ROOF_ART_ASPECT = 1.6;

let onSaved: ((d: Drawing) => void) | null = null;
/**
 * 그리기 화면을 연다. 저장하면 cb 로 새 그림을 알려 주고 판을 닫는다.
 * roof: 지붕에 붙일 그림 (도화지가 지붕 앞면 모양이고, 바탕은 지붕 색으로 보인다)
 */
export function openDrawEditor(cb?: (d: Drawing) => void, copyFrom?: string, roof = false) {
  onSaved = cb ?? null;
  go('draw', roof ? `roof${copyFrom ? `-${copyFrom}` : ''}` : (copyFrom ?? 'new'));
}

export const drawScreen: Screen = {
  id: 'draw',
  title: '그림 그리기',
  render(root, param, ctx) {
    if (!state.me) {
      root.innerHTML = `<p class="empty">입주하면 32x32 그림을 그려서 액자, 간판, 러그, 벽지, 지붕에 붙일 수 있어요.</p><a class="btn primary" href="#/move-in">입주하러 가기</a>`;
      return;
    }
    document.body.classList.add('sheet-tall');
    const cb = onSaved;
    onSaved = null;
    const palette = [...DEFAULT_PALETTE];
    const px = new Uint8Array(N * N);
    const roof = !!param && param.startsWith('roof');
    const copyId = roof ? (param!.length > 5 ? param!.slice(5) : null) : param && param !== 'new' ? param : null;
    const src = copyId ? drawingById(copyId) : null;
    if (src) {
      const dec = decodeDrawing(src.pixels);
      if (dec) px.set(dec);
      ctx.setTitle('따라 그리기');
    }
    if (roof) ctx.setTitle(src ? '지붕 그림 고치기' : '지붕 그림 그리기');
    const roofColor = state.me?.roofColor ?? '#d9a37e';
    let color = 1;
    let tool: Tool = 'pen';
    const undo: Uint8Array[] = [];
    let saving = false;

    root.innerHTML = `
      ${
        roof
          ? `<div class="roof-draw" style="--roof:${roofColor}">
          <div class="roof-top"><i class="ear l"></i><i class="ear r"></i><i class="chim"></i></div>
          <canvas class="draw-canvas roof" width="${N * 16}" height="${Math.round((N * 16) / ROOF_ART_ASPECT)}" aria-label="지붕 그림판"></canvas>
          <div class="roof-wall"><i class="win"></i><i class="door"></i><i class="win"></i></div>
        </div>
        <p class="note">지붕 앞면 전체에 그대로 그려져요. 첫 번째 크림색(바탕)과 지우개로 지운 곳은 지붕 색으로 보여요.</p>`
          : `<div class="draw-wrap">
        <canvas class="draw-canvas" width="${N * 10}" height="${N * 10}" aria-label="그림판 32x32"></canvas>
      </div>`
      }
      <div class="draw-tools">
        <button class="pill btn-pill on" data-tool="pen">펜</button>
        <button class="pill btn-pill" data-tool="fill">채우기</button>
        <button class="pill btn-pill" data-tool="eraser">지우개</button>
        <button class="pill btn-pill" data-act="undo">되돌리기</button>
        <button class="pill btn-pill" data-act="clear">모두 지우기</button>
      </div>
      <div class="draw-palette">${palette.map((c, i) => `<button class="dot${i === color ? ' on' : ''}" data-color="${i}" style="background:${c}" aria-label="색 ${i + 1}"></button>`).join('')}</div>
      <p class="note">그림 하나는 512바이트라 아주 가벼워요. 내 그림은 ${DRAWING_MAX}장까지 둘 수 있어요.</p>
      <div class="row two sticky-actions">
        <button class="btn" data-act="cancel">닫기</button>
        <button class="btn primary" data-act="save">저장하기</button>
      </div>`;
    const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
    const g = canvas.getContext('2d')!;
    const S = canvas.width / N;
    const SY = canvas.height / N;

    const paint = () => {
      for (let i = 0; i < px.length; i++) {
        const x = (i % N) * S;
        const y = Math.floor(i / N) * SY;
        if (roof && px[i] === 0) {
          g.clearRect(x, y, S, SY);
          continue;
        }
        g.fillStyle = palette[px[i]];
        g.fillRect(x, y, S, SY);
      }
      g.strokeStyle = 'rgba(91,70,54,0.08)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 1; k < N; k++) {
        g.moveTo(k * S + 0.5, 0);
        g.lineTo(k * S + 0.5, N * SY);
        g.moveTo(0, k * SY + 0.5);
        g.lineTo(N * S, k * SY + 0.5);
      }
      g.stroke();
    };
    const snapshot = () => {
      undo.push(px.slice());
      if (undo.length > 40) undo.shift();
    };
    const setPx = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= N || y >= N) return;
      px[y * N + x] = tool === 'eraser' ? 0 : color;
    };
    const fill = (x: number, y: number) => {
      const from = px[y * N + x];
      const to = color;
      if (from === to) return;
      const stack = [y * N + x];
      while (stack.length) {
        const i = stack.pop()!;
        if (px[i] !== from) continue;
        px[i] = to;
        const cx = i % N;
        const cy = (i / N) | 0;
        if (cx > 0) stack.push(i - 1);
        if (cx < N - 1) stack.push(i + 1);
        if (cy > 0) stack.push(i - N);
        if (cy < N - 1) stack.push(i + N);
      }
    };
    const cell = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: Math.floor(((e.clientX - r.left) / r.width) * N), y: Math.floor(((e.clientY - r.top) / r.height) * N) };
    };

    let last: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      snapshot();
      const c = cell(e);
      if (tool === 'fill') {
        if (c.x >= 0 && c.y >= 0 && c.x < N && c.y < N) fill(c.x, c.y);
        last = null;
      } else {
        setPx(c.x, c.y);
        last = c;
      }
      paint();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const c = cell(e);
      // 빠르게 그어도 끊기지 않게 지난 칸과 이어 칠한다
      const steps = Math.max(Math.abs(c.x - last.x), Math.abs(c.y - last.y));
      for (let s = 1; s <= steps; s++) setPx(Math.round(last.x + ((c.x - last.x) * s) / steps), Math.round(last.y + ((c.y - last.y) * s) / steps));
      last = c;
      paint();
    });
    const up = () => (last = null);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    root.addEventListener('click', async (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.color) {
        color = Number(t.dataset.color);
        if (tool === 'eraser') tool = 'pen';
      } else if (t.dataset.tool) tool = t.dataset.tool as Tool;
      else if (t.dataset.act === 'undo') {
        const prev = undo.pop();
        if (prev) px.set(prev);
      } else if (t.dataset.act === 'clear') {
        snapshot();
        px.fill(0);
      } else if (t.dataset.act === 'cancel') return ctx.close();
      else if (t.dataset.act === 'save' && !saving) {
        await loadMyDrawings();
        if (myDrawingList().length >= DRAWING_MAX) {
          play('error');
          toast(`그림은 ${DRAWING_MAX}장까지예요. 꾸미기 탭에서 안 쓰는 그림을 지워 주세요`, 3000);
          return;
        }
        saving = true;
        t.textContent = '저장하는 중...';
        try {
          const res = await saveDrawing(encodeDrawing(px), palette);
          rememberDrawing(res.drawing, true);
          play('save');
          toast('그림을 저장했어요');
          void refreshWallet();
          if (cb) {
            cb(res.drawing);
            ctx.close();
          } else go('decorate');
          return;
        } catch (err) {
          play('error');
          toast(err instanceof ApiError ? err.message : '저장하지 못했어요');
          saving = false;
          t.textContent = '저장하기';
        }
        return;
      } else return;
      play('tap');
      root.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
      root.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.classList.toggle('on', Number(b.dataset.color) === color));
      paint();
    });
    paint();
    return () => document.body.classList.remove('sheet-tall');
  },
};
