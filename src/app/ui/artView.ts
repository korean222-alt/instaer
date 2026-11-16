// 그림 크게 보기 (2026-11-16): 캔버스, 액자, 간판, 러그를 누르면 그 그림을 화면 가운데에 크게 띄운다.
import { decorItem } from '../../shared/config';
import { decodeDrawing, DRAWING_SIZE } from '../../scene';
import { drawingById } from '../art';
import { play } from '../audio/sound';
import { esc } from './dom';
import { paletteOf } from './drawingThumb';

let box: HTMLElement | null = null;

export function showArt(drawingId: string, type: string) {
  const d = drawingById(drawingId);
  if (!d) return;
  if (!box) {
    box = document.createElement('div');
    box.className = 'art-view';
    box.hidden = true;
    document.getElementById('app')!.appendChild(box);
    box.addEventListener('click', (e) => {
      if (e.target === box || (e.target as HTMLElement).closest('[data-close]')) {
        play('close');
        box!.hidden = true;
      }
    });
  }
  const scale = 12;
  box.innerHTML = `<div class="art-card"><b>${esc(decorItem(type)?.label ?? '그림')}</b><canvas width="${DRAWING_SIZE * scale}" height="${DRAWING_SIZE * scale}"></canvas><button class="btn small" data-close>닫기</button></div>`;
  const c = box.querySelector('canvas')!;
  const g = c.getContext('2d')!;
  const px = decodeDrawing(d.pixels);
  const pal = paletteOf(d);
  if (px)
    for (let i = 0; i < px.length; i++) {
      g.fillStyle = pal[px[i]];
      g.fillRect((i % DRAWING_SIZE) * scale, Math.floor(i / DRAWING_SIZE) * scale, scale, scale);
    }
  box.hidden = false;
}
