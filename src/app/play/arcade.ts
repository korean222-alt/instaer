// 생선 받기 (오락실 미니게임, 30초): 손가락으로 바구니를 좌우로 옮겨서 떨어지는 생선을 받는다.
// 생선 +1, 황금 생선 +3, 낡은 장화 -2. 끝나면 점수를 서버에 알리고 점수 단계만큼 츄르와 선물을 받는다.
import { decorItem } from '../../shared/config';
import { ARCADE_PRIZE_SCORE, ARCADE_SEC, ARCADE_TIERS, CURRENCY } from '../../shared/economy';
import { play } from '../audio/sound';
import { ApiError, reportArcade } from '../net/api';
import { state } from '../state';
import { toast } from '../ui/toast';
import { applyWallet } from '../wallet';
import { openShell } from './gameShell';

interface Drop {
  x: number;
  y: number;
  vy: number;
  kind: 'fish' | 'gold' | 'boot';
  rot: number;
}

export function startArcade(onEnd?: () => void) {
  let raf = 0;
  let running = false;
  let started = 0;
  let last = 0;
  let score = 0;
  let spawnT = 0;
  let drops: Drop[] = [];
  let basket = 0.5;
  let pops: Array<{ x: number; y: number; text: string; t: number }> = [];

  const shell = openShell('생선 받기', {
    aspect: 1.35,
    onClose() {
      cancelAnimationFrame(raf);
      onEnd?.();
    },
    onAction(act) {
      if (act === 'start') begin();
      else if (act === 'stop') shell.close();
    },
  });
  const { g, w, h, canvas } = shell;
  const BW = 70;
  const tiers = ARCADE_TIERS.map((t) => `${t.score}점 ${t.coins}`).join(' · ');

  function idle() {
    shell.setMessage(`바구니를 좌우로 끌어서 생선을 받아요. 장화는 피하세요!<br /><small>${tiers} ${CURRENCY}, 하루 처음 ${ARCADE_PRIZE_SCORE}점이면 선물 상자</small>`);
    shell.setButtons('<button class="btn primary" data-act="start">시작</button>');
  }

  function begin() {
    running = true;
    score = 0;
    drops = [];
    pops = [];
    spawnT = 0.4;
    started = last = performance.now();
    shell.setMessage('');
    shell.setButtons('');
    play('tap');
  }

  const moveTo = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    basket = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    moveTo(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pressure > 0 || e.pointerType === 'mouse' || e.buttons) moveTo(e);
  });

  async function finish() {
    running = false;
    const ms = performance.now() - started;
    play('fanfare');
    shell.setMessage(`<b class="big">${score}점</b>`);
    shell.setButtons('<button class="btn" data-act="stop">그만하기</button><button class="btn primary" data-act="start">다시 하기</button>');
    if (!state.me) {
      shell.setMessage(`<b class="big">${score}점</b><br /><small>입주하면 점수만큼 ${CURRENCY}를 받아요</small>`);
      return;
    }
    try {
      const res = await reportArcade(score, Math.round(ms));
      applyWallet(res.wallet, { coins: res.coins, item: res.prize });
      const extra = res.prize ? ` · 선물 상자: ${decorItem(res.prize)?.label}` : '';
      shell.setMessage(`<b class="big">${score}점</b><br /><small>${res.coins ? `${CURRENCY} +${res.coins}${extra}` : res.morePaid === 0 ? '오늘 상품을 받을 수 있는 판을 다 했어요' : `${ARCADE_TIERS[0].score}점부터 ${CURRENCY}를 받아요`}</small>`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '점수를 알리지 못했어요');
    }
  }

  function step(now: number, dt: number) {
    const el = (now - started) / 1000;
    if (el >= ARCADE_SEC) return void finish();
    const k = el / ARCADE_SEC;
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = 0.72 - k * 0.32;
      const r = Math.random();
      drops.push({ x: 20 + Math.random() * (w - 40), y: -20, vy: 120 + k * 150 + Math.random() * 40, kind: r < 0.08 ? 'gold' : r < 0.3 ? 'boot' : 'fish', rot: Math.random() * 6 });
    }
    const bx = basket * w;
    const by = h - 34;
    for (const d of drops) {
      d.y += d.vy * dt;
      d.rot += dt * 2;
      if (d.y > by - 12 && d.y < by + 10 && Math.abs(d.x - bx) < BW / 2 + 6) {
        const pts = d.kind === 'gold' ? 3 : d.kind === 'boot' ? -2 : 1;
        score = Math.max(0, score + pts);
        pops.push({ x: d.x, y: by - 20, text: pts > 0 ? `+${pts}` : `${pts}`, t: 0 });
        play(pts > 0 ? (d.kind === 'gold' ? 'like' : 'tap') : 'error');
        d.y = h + 100;
      }
    }
    drops = drops.filter((d) => d.y < h + 30);
    pops = pops.filter((p) => (p.t += dt) < 0.7);
  }

  function drawFish(x: number, y: number, rot: number, color: string) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.sin(rot) * 0.4 + Math.PI / 2);
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2);
    g.moveTo(11, 0);
    g.lineTo(21, -8);
    g.lineTo(21, 8);
    g.fill();
    g.fillStyle = '#3a2e26';
    g.beginPath();
    g.arc(-7, -2, 1.8, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function render(now: number) {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#ffe9c7');
    grd.addColorStop(1, '#ffd2b0');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 5; i++) g.fillRect(((i * 97 + now * 0.01) % (w + 60)) - 60, 30 + i * 60, 50, 10);
    for (const d of drops) {
      if (d.kind === 'boot') {
        g.save();
        g.translate(d.x, d.y);
        g.rotate(Math.sin(d.rot) * 0.5);
        g.fillStyle = '#7b6a5a';
        g.beginPath();
        g.roundRect(-8, -14, 12, 22, 3);
        g.roundRect(-8, 2, 22, 8, 4);
        g.fill();
        g.restore();
      } else drawFish(d.x, d.y, d.rot, d.kind === 'gold' ? '#ffc94a' : '#7cc4f2');
    }
    // 바구니 (고양이 밥그릇)
    const bx = basket * w;
    const by = h - 34;
    g.fillStyle = '#ff8f7a';
    g.beginPath();
    g.moveTo(bx - BW / 2, by - 8);
    g.lineTo(bx + BW / 2, by - 8);
    g.lineTo(bx + BW / 2 - 9, by + 16);
    g.lineTo(bx - BW / 2 + 9, by + 16);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.font = '800 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('냥', bx, by + 9);
    // 점수와 시간
    const left = running ? Math.max(0, ARCADE_SEC - (now - started) / 1000) : ARCADE_SEC;
    g.fillStyle = '#5b4636';
    g.font = '800 18px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`${score}점`, 14, 28);
    g.textAlign = 'right';
    g.fillText(`${Math.ceil(left)}초`, w - 14, 28);
    for (const p of pops) {
      g.globalAlpha = 1 - p.t / 0.7;
      g.textAlign = 'center';
      g.fillStyle = p.text.startsWith('-') ? '#c0503e' : '#3c9a6a';
      g.fillText(p.text, p.x, p.y - p.t * 40);
      g.globalAlpha = 1;
    }
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (running) step(now, dt);
    render(now);
    raf = requestAnimationFrame(frame);
  }
  idle();
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
