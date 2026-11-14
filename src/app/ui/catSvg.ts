// 2D 고양이 그림 (입양 카드, 팝업). 씬의 3D 고양이와 같은 털/무늬/눈 색을 쓴다.
import type { CatLook } from '../../shared/types';

/** 색을 조금 어둡게/밝게 (amount: -1 ~ 1) */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const DARK = '#3a3438';
const CREAM = '#fff7ec';
const ORANGE = '#f0a04b';

/**
 * 앉아 있는 둥근 고양이. viewBox 0 0 200 200.
 * idPrefix 는 한 페이지에 여러 장 그릴 때 그라데이션 id 가 겹치지 않게 한다.
 */
export function catSvgInner(look: CatLook, idPrefix = 'c'): string {
  const fur = look.fur;
  const furDark = shade(fur, -0.18);
  const furLight = shade(fur, 0.25);
  const isDarkFur = look.pattern === 'black' || look.pattern === 'tuxedo';
  const line = isDarkFur ? shade(fur, 0.35) : shade(fur, -0.45);
  const inner = isDarkFur ? '#e8a0a8' : '#f6b3b5';
  const g = `${idPrefix}-body`;

  // 무늬
  let marks = '';
  if (look.pattern === 'cheese' || look.pattern === 'gray') {
    const s = furDark;
    marks = `
      <path d="M88 52 q12 -6 24 0" stroke="${s}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M84 62 q16 -7 32 0" stroke="${s}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M52 132 q10 6 6 18" stroke="${s}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M148 132 q-10 6 -6 18" stroke="${s}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  } else if (look.pattern === 'calico') {
    marks = `
      <path d="M58 40 q22 -14 38 6 q-6 22 -30 22 q-14 -10 -8 -28z" fill="${ORANGE}"/>
      <path d="M118 44 q20 -6 30 14 q-4 18 -22 14 q-12 -12 -8 -28z" fill="${DARK}"/>
      <ellipse cx="66" cy="150" rx="18" ry="14" fill="${DARK}" opacity="0.9"/>
      <ellipse cx="138" cy="140" rx="16" ry="18" fill="${ORANGE}"/>`;
  } else if (look.pattern === 'tuxedo') {
    marks = `
      <path d="M100 96 q-26 18 -22 70 q22 12 44 0 q4 -52 -22 -70z" fill="${CREAM}"/>
      <ellipse cx="100" cy="84" rx="20" ry="13" fill="${CREAM}"/>`;
  }
  const bodyFill = look.pattern === 'calico' ? CREAM : `url(#${g})`;
  // 밝은 털은 배경에 묻히지 않게 옅은 테두리
  const light = look.pattern === 'white' || look.pattern === 'calico';
  const edge = light ? ` stroke="#e2cfb8" stroke-width="2.5"` : '';
  const earFill = look.pattern === 'calico' ? CREAM : fur;

  return `
    <defs>
      <radialGradient id="${g}" cx="45%" cy="35%" r="70%">
        <stop offset="0" stop-color="${furLight}"/>
        <stop offset="1" stop-color="${fur}"/>
      </radialGradient>
    </defs>
    <ellipse cx="100" cy="186" rx="62" ry="9" fill="#000" opacity="0.08"/>
    <!-- 꼬리 -->
    ${light && look.pattern === 'white' ? '<path d="M150 168 q36 -4 30 -40 q-3 -14 -14 -12" stroke="#e2cfb8" stroke-width="19" fill="none" stroke-linecap="round"/>' : ''}
    <path d="M150 168 q36 -4 30 -40 q-3 -14 -14 -12" stroke="${look.pattern === 'calico' ? ORANGE : fur}" stroke-width="15" fill="none" stroke-linecap="round"/>
    <!-- 몸 -->
    <ellipse cx="100" cy="140" rx="58" ry="46" fill="${bodyFill}"${edge}/>
    <!-- 머리 -->
    <path d="M44 40 L58 82 L78 54 Z" fill="${earFill}"${edge} stroke-linejoin="round"/>
    <path d="M156 40 L142 82 L122 54 Z" fill="${look.pattern === 'calico' ? DARK : earFill}"${edge} stroke-linejoin="round"/>
    <path d="M51 52 L60 74 L71 58 Z" fill="${inner}"/>
    <path d="M149 52 L140 74 L129 58 Z" fill="${inner}"/>
    <ellipse cx="100" cy="82" rx="56" ry="46" fill="${bodyFill}"${edge}/>
    ${marks}
    <!-- 앞발 -->
    <ellipse cx="82" cy="178" rx="13" ry="9" fill="${look.pattern === 'tuxedo' ? CREAM : look.pattern === 'calico' ? CREAM : furLight}"/>
    <ellipse cx="118" cy="178" rx="13" ry="9" fill="${look.pattern === 'tuxedo' ? CREAM : look.pattern === 'calico' ? CREAM : furLight}"/>
    <!-- 눈 -->
    <ellipse cx="78" cy="80" rx="10" ry="12" fill="${look.eyeColor}"/>
    <ellipse cx="122" cy="80" rx="10" ry="12" fill="${look.eyeColor}"/>
    <ellipse cx="79" cy="82" rx="5" ry="8" fill="#241c1c"/>
    <ellipse cx="121" cy="82" rx="5" ry="8" fill="#241c1c"/>
    <circle cx="82" cy="76" r="3" fill="#fff"/>
    <circle cx="125" cy="76" r="3" fill="#fff"/>
    <!-- 볼 -->
    <ellipse cx="66" cy="98" rx="8" ry="5" fill="#ff8f9a" opacity="0.35"/>
    <ellipse cx="134" cy="98" rx="8" ry="5" fill="#ff8f9a" opacity="0.35"/>
    <!-- 코와 입 -->
    <path d="M96 94 h8 l-4 5 z" fill="#f08a96"/>
    <path d="M100 99 q-4 7 -10 4 M100 99 q4 7 10 4" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <!-- 수염 -->
    <path d="M58 92 h-22 M58 99 l-20 5 M142 92 h22 M142 99 l20 5" stroke="${line}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`;
}

export function catSvg(look: CatLook, size = 120, idPrefix = 'c'): string {
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" aria-hidden="true">${catSvgInner(look, idPrefix)}</svg>`;
}
