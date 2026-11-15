// 입양 결과 카드. 스토리에 올리기 좋은 세로(1080x1920) 그림을 SVG 로 만들고, 저장/공유용 PNG 로 바꾼다.
// 고양이는 씬이 찍어 준 3D 그림(renderCatPreview)을 쓰고, 그게 안 되면(WebGL 끊김 등) 2D 그림을 쓴다.
import { catLook } from '../../shared/catLook';
import type { RegionId } from '../../shared/types';
import { regionColor, regionLabel, state } from '../state';
import { catSvgInner } from './catSvg';
import { esc } from './dom';

export interface CardInfo {
  handle: string;
  houseNo: number;
  founder: boolean;
  region: RegionId;
  /** 지역 순위 (모르면 null) */
  regionRank: number | null;
  regionTotal: number | null;
}

/** 3D 고양이 그림 자리 (발이 풀밭 타원 위에 오게) */
const CAT_IMG = { x: 170, y: 290, size: 740 };
const W = 1080;
const H = 1920;
const FONT = `'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif`;

/** 긴 문구를 두 줄로 */
function wrap(text: string, max = 15): string[] {
  if (text.length <= max) return [text];
  const words = text.split(' ');
  let a = '';
  let i = 0;
  while (i < words.length && (a + ' ' + words[i]).trim().length <= Math.ceil(text.length / 2) + 2) a = (a + ' ' + words[i++]).trim();
  if (!a) a = words[i++] ?? '';
  return [a, words.slice(i).join(' ')].filter(Boolean);
}

/** 3D 고양이 그림 (PNG data URL). 안 되면 빈 글자 */
function catPhoto(info: CardInfo): string {
  try {
    const look = catLook(info.handle);
    const cat = state.houses.get(info.houseNo)?.cat ?? { fur: look.fur, pattern: look.pattern, eyeColor: look.eyeColor };
    const url = state.scene.renderCatPreview(cat, 512, { houseNo: info.houseNo, pose: 'sit' });
    return typeof url === 'string' && url.startsWith('data:image/') ? url : '';
  } catch {
    return '';
  }
}

/** catImg: 3D 고양이 그림 (없으면 2D 그림) */
export function cardSvg(info: CardInfo, catImg = ''): string {
  const look = catLook(info.handle);
  const color = regionColor(info.region);
  const label = regionLabel(info.region);
  const quote = wrap(`“${look.personality}”`);
  const rankLine =
    info.regionRank !== null && info.regionTotal !== null
      ? `${label} ${info.regionRank}위 · 우리 지역 ${info.regionTotal.toLocaleString()}마리`
      : `${label}에 입주`;
  const chips = [`${look.patternLabel} 고양이`, ...(info.founder ? ['창립 주민'] : [])];
  const chipW = (t: string) => 64 + t.length * 40;
  const chipsW = chips.reduce((n, t) => n + chipW(t), 0) + (chips.length - 1) * 20;
  let cx = (W - chipsW) / 2;
  const chipEls = chips
    .map((t, i) => {
      const w = chipW(t);
      const x = cx;
      cx += w + 20;
      const founder = i === 1;
      return `<rect x="${x}" y="1300" width="${w}" height="80" rx="40" fill="${founder ? '#ffd166' : '#ffffff'}" stroke="${founder ? '#e8b440' : '#eadbc7'}" stroke-width="3"/>
        <text x="${x + w / 2}" y="1353" font-size="38" font-weight="800" fill="#5b4636" text-anchor="middle">${esc(t)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(FONT)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bfeaf0"/>
      <stop offset="0.55" stop-color="#e4f6f2"/>
      <stop offset="1" stop-color="#fdf3e3"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="160" cy="250" r="90" fill="#ffffff" opacity="0.5"/>
  <circle cx="930" cy="180" r="60" fill="#ffffff" opacity="0.5"/>
  <ellipse cx="540" cy="935" rx="400" ry="62" fill="#a8d97c"/>
  <ellipse cx="540" cy="925" rx="360" ry="42" fill="#bfe58f"/>

  <text x="540" y="170" font-size="44" font-weight="700" fill="#5b4636" opacity="0.7" text-anchor="middle">고양이섬 · ${info.houseNo}번지</text>
  <text x="540" y="260" font-size="84" font-weight="900" fill="#5b4636" text-anchor="middle">입양 완료!</text>

  ${
    catImg
      ? `<image x="${CAT_IMG.x}" y="${CAT_IMG.y}" width="${CAT_IMG.size}" height="${CAT_IMG.size}" href="${catImg}" xlink:href="${catImg}"/>`
      : `<g transform="translate(240 360) scale(3)">${catSvgInner(look, 'card')}</g>`
  }

  <text x="540" y="1150" font-size="120" font-weight="900" fill="#5b4636" text-anchor="middle">${esc(look.name)}</text>
  <text x="540" y="1230" font-size="44" font-weight="700" fill="#8a715e" text-anchor="middle">@${esc(info.handle)} 의 고양이</text>
  ${chipEls}

  <rect x="110" y="1430" width="860" height="${quote.length > 1 ? 210 : 150}" rx="44" fill="#ffffff" opacity="0.9"/>
  ${quote.map((l, i) => `<text x="540" y="${1525 + i * 66 - (quote.length > 1 ? 0 : 0)}" font-size="50" font-weight="800" fill="#5b4636" text-anchor="middle">${esc(l)}</text>`).join('')}

  <text x="540" y="${quote.length > 1 ? 1736 : 1676}" font-size="44" font-weight="800" fill="#5b4636" text-anchor="middle"><tspan fill="${color}">● </tspan>${esc(rankLine)}</text>
  <text x="540" y="1850" font-size="36" font-weight="700" fill="#8a715e" text-anchor="middle">나도 고양이 입양하기 · ${esc(location.host)}</text>
</svg>`;
}

/** SVG → PNG Blob (저장/공유용) */
export function svgToPng(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext('2d');
      if (!g) return reject(new Error('canvas'));
      g.drawImage(img, 0, 0, W, H);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
    };
    img.onerror = () => reject(new Error('svg image'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** 카드 그림 영역 + 공유 버튼을 만든다 */
export async function mountCard(root: HTMLElement, info: CardInfo) {
  const svg = cardSvg(info, catPhoto(info));
  root.innerHTML = `
    <div class="card-frame"><img class="card-img" alt="입양 결과 카드" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" /></div>
    <div class="row">
      <button class="btn primary" data-act="share">카드 공유하기</button>
    </div>
    <p class="note center">이미지를 길게 눌러 저장해서 스토리에 올려 보세요.</p>`;
  let png: Blob | null = null;
  try {
    png = await svgToPng(svg);
    const url = URL.createObjectURL(png);
    (root.querySelector('.card-img') as HTMLImageElement).src = url;
  } catch {
    /* PNG 가 안 되면 SVG 그대로 보여 준다 */
  }
  root.querySelector('[data-act="share"]')?.addEventListener('click', async () => {
    const { toast } = await import('./toast');
    const file = png ? new File([png], `cat-island-${info.houseNo}.png`, { type: 'image/png' }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '고양이섬 입양 카드' });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: '고양이섬', text: `@${info.handle} 의 고양이를 입양했어요`, url: location.origin });
        return;
      }
    } catch {
      return; // 사용자가 공유를 취소함
    }
    if (png) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(png);
      a.download = `cat-island-${info.houseNo}.png`;
      a.click();
      toast('카드 그림을 저장했어요');
    } else toast('이미지를 길게 눌러 저장해 주세요');
  });
}
