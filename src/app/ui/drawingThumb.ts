// 직접 그린 그림(32x32) → 작은 그림(<img>). 같은 그림은 한 번만 만든다.
import { decodeDrawing, DEFAULT_PALETTE, DRAWING_SIZE } from '../../scene';
import type { Drawing } from '../../shared/types';

const urls = new Map<string, string>();

export const paletteOf = (d: Pick<Drawing, 'palette'>) => (d.palette?.length === 16 ? d.palette : [...DEFAULT_PALETTE]);

export function drawingUrl(d: Drawing): string {
  const hit = urls.get(d.id);
  if (hit) return hit;
  const px = decodeDrawing(d.pixels);
  const c = document.createElement('canvas');
  c.width = c.height = DRAWING_SIZE;
  const ctx = c.getContext('2d')!;
  const pal = paletteOf(d);
  if (px) {
    for (let i = 0; i < px.length; i++) {
      ctx.fillStyle = pal[px[i]];
      ctx.fillRect(i % DRAWING_SIZE, Math.floor(i / DRAWING_SIZE), 1, 1);
    }
  }
  const url = c.toDataURL('image/png');
  urls.set(d.id, url);
  return url;
}

export const drawingThumb = (d: Drawing, size: number) =>
  `<img class="pixel" src="${drawingUrl(d)}" width="${size}" height="${size}" alt="그림" draggable="false" />`;
