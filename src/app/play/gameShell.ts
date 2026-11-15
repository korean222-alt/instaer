// 미니게임 화면 틀: 섬 위에 뜨는 판 (제목, 닫기, 캔버스, 아래 안내와 버튼).
// 떠 있는 동안 body.playing 이 붙어서 조이스틱/버튼 위를 덮는다 (게임 중에 고양이가 걷지 않게).

export interface GameShell {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** CSS 픽셀 크기 */
  w: number;
  h: number;
  setMessage(html: string): void;
  setButtons(html: string): void;
  close(): void;
}

export function openShell(title: string, opts: { aspect: number; onClose(): void; onAction(act: string): void }): GameShell {
  const el = document.createElement('div');
  el.className = 'game';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="game-card">
      <div class="game-head"><b>${title}</b><button class="close" data-act="close" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <canvas class="game-canvas"></canvas>
      <div class="game-msg"></div>
      <div class="game-btns"></div>
    </div>`;
  document.getElementById('app')!.appendChild(el);
  document.body.classList.add('playing');
  const canvas = el.querySelector('canvas')!;
  const w = Math.min(380, window.innerWidth - 32);
  const h = Math.min(Math.round(w * opts.aspect), window.innerHeight - 230);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  let closed = false;
  const shell: GameShell = {
    el,
    canvas,
    g,
    w,
    h,
    setMessage: (html) => (el.querySelector('.game-msg')!.innerHTML = html),
    setButtons: (html) => (el.querySelector('.game-btns')!.innerHTML = html),
    close() {
      if (closed) return;
      closed = true;
      el.remove();
      document.body.classList.remove('playing');
      opts.onClose();
    },
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'close') shell.close();
    else opts.onAction(b.dataset.act!);
  });
  return shell;
}
