// 낚시 미니게임 (연못 가까이 또는 항구 부두 끝에서 "낚시하기").
// 판의 단계에 맞춰 onPose 로 낚시 모습(씬 setFishing, 실시간)을 알린다. 판은 화면 아래쪽에 띄워서 위쪽에 내 고양이가 보이게 한다.
// 던지기 → 찌가 쑥 들어가면 바로 누르기 → 누르고 있으면 초록 칸이 오른쪽으로, 떼면 왼쪽으로. 물고기를 칸 안에 두면 끌려온다.
// 잡은 물고기는 모아 두었다가 그만둘 때(또는 많이 모이면) 한 번에 서버에 알린다 (쓰기 한도 아끼기).
import { CURRENCY, FISH_PER_REPORT, fishDef, isRareFish, rollFish, type FishDef, type FishWhere } from '../../shared/economy';
import type { FishingPose } from '../../shared/types';
import { play } from '../audio/sound';
import { ApiError, reportFish } from '../net/api';
import { fishSvg } from '../screens/quests';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet } from '../wallet';
import { openShell } from './gameShell';

type Phase = 'ready' | 'cast' | 'wait' | 'bite' | 'reel' | 'done';

export interface FishingOptions {
  /** 낚시하는 곳 (기본: 연못) */
  where?: FishWhere;
  /** 낚시 모습 단계가 바뀔 때. 판을 닫으면 null */
  onPose?(pose: FishingPose | null): void;
  onEnd?(): void;
}

export function startFishing(opts: FishingOptions = {}) {
  const where: FishWhere = opts.where ?? 'pond';
  let pose: FishingPose | null = null;
  const setPose = (p: FishingPose | null) => {
    if (p === pose) return;
    pose = p;
    opts.onPose?.(p);
  };
  let phase: Phase = 'ready';
  let t = 0;
  let waitFor = 0;
  let nibbleAt = 0;
  let fish: { def: FishDef; cm: number } | null = null;
  let biteWindow = 0.9;
  // 줄다리기
  let zone = 0.3;
  let zoneV = 0;
  let pos = 0.5;
  let target = 0.5;
  let progress = 0.3;
  let holding = false;
  const catches: Array<{ id: string; cm: number }> = [];
  let raf = 0;
  let last = performance.now();

  const shell = openShell(where === 'sea' ? '바다 낚시' : '낚시', {
    aspect: 0.52,
    low: true,
    onClose() {
      cancelAnimationFrame(raf);
      setPose(null);
      void flush();
      opts.onEnd?.();
    },
    onAction(act) {
      if (act === 'again') reset();
      else if (act === 'stop') shell.close();
    },
  });
  const { g, w, h, canvas } = shell;
  const bob = { x: w * 0.5, y: h * 0.46 };

  function reset() {
    phase = 'ready';
    fish = null;
    shell.setMessage('물을 누르면 낚싯줄을 던져요');
    shell.setButtons(catches.length ? `<button class="btn" data-act="stop">그만하기 (${catches.length}마리)</button>` : '');
  }

  async function flush() {
    if (!catches.length || !state.me) return;
    const list = catches.splice(0, catches.length);
    try {
      const res = await reportFish(list);
      applyWallet(res.wallet, { silent: true });
      toast(`물고기 ${res.counted}마리를 가방에 넣었어요. 잡화점 보리에게 팔면 ${CURRENCY}가 돼요`, 2800);
      if (res.full) toast('가방이 가득 찼어요. 잡화점에 팔아 주세요', 3000);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '물고기를 알리지 못했어요');
    }
  }

  function press() {
    if (phase === 'ready') {
      phase = 'cast';
      t = 0;
      // 다시 던질 때는 낚시 모습을 처음부터 (씬이 찌를 새로 던지게)
      if (pose !== null) setPose(null);
      setPose('cast');
      play('jump');
      shell.setMessage('찌를 지켜보세요...');
      shell.setButtons('');
    } else if (phase === 'wait') {
      phase = 'ready';
      play('error');
      reset();
      shell.setMessage('너무 일렀어요. 물고기가 도망갔어요. 다시 던져 보세요');
    } else if (phase === 'bite') {
      phase = 'reel';
      setPose('reel');
      play('ding');
      zone = 0.3;
      zoneV = 0;
      pos = 0.5;
      target = 0.5;
      progress = 0.3;
      shell.setMessage('누르고 있으면 초록 칸이 오른쪽으로! 물고기를 칸 안에 두세요');
    }
    if (phase === 'reel') holding = true;
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 손가락이 이미 떨어짐 */
    }
    press();
  });
  const release = () => (holding = false);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  function caught() {
    phase = 'done';
    setPose('caught');
    const f = fish!;
    catches.push({ id: f.def.id, cm: f.cm });
    play(isRareFish(f.def.id) ? 'fanfare' : 'save');
    shell.setMessage(`
      <div class="catch">${fishSvg(f.def.color, 64)}<div><b>${esc(f.def.label)}</b> ${f.cm}cm
      <small>${f.def.rarity === 'legend' ? '전설!' : f.def.rarity === 'rare' ? '희귀한 물고기!' : f.def.rarity === 'junk' ? '...물고기가 아니네' : ''} ${state.me ? `팔면 ${f.def.price} ${CURRENCY}` : '(입주하면 가방에 모여요)'}</small></div></div>`);
    shell.setButtons(`<button class="btn" data-act="stop">그만하기 (${catches.length}마리)</button><button class="btn primary" data-act="again">한 번 더</button>`);
    if (catches.length >= FISH_PER_REPORT) void flush();
  }
  function escaped(why: string) {
    phase = 'done';
    setPose('wait');
    play('remove');
    shell.setMessage(why);
    shell.setButtons(`<button class="btn" data-act="stop">그만하기${catches.length ? ` (${catches.length}마리)` : ''}</button><button class="btn primary" data-act="again">다시 던지기</button>`);
  }

  function step(dt: number) {
    t += dt;
    if (phase === 'cast' && t > 0.6) {
      phase = 'wait';
      setPose('wait');
      t = 0;
      waitFor = 1.6 + Math.random() * 3.6;
      nibbleAt = Math.random() < 0.6 ? waitFor * (0.3 + Math.random() * 0.4) : -1;
    } else if (phase === 'wait' && t >= waitFor) {
      const r = rollFish(Math.random, where);
      fish = { def: fishDef(r.id)!, cm: r.cm };
      biteWindow = 0.95 - fish.def.pull * 0.3;
      phase = 'bite';
      setPose('bite');
      t = 0;
      play('like');
      shell.setMessage('<b class="big">지금!</b>');
    } else if (phase === 'bite' && t > biteWindow) {
      escaped('앗, 놓쳤어요. 찌가 들어가면 바로 눌러요');
    } else if (phase === 'reel' && fish) {
      const pull = fish.def.pull;
      // 물고기는 가끔 새 목표로 확 움직인다 (힘센 물고기일수록 자주, 멀리)
      if (Math.random() < dt * (0.8 + pull * 2.2)) target = Math.max(0.04, Math.min(0.96, pos + (Math.random() - 0.5) * (0.5 + pull)));
      pos += (target - pos) * Math.min(1, dt * (1.5 + pull * 3));
      zoneV += (holding ? 1.9 : -1.6) * dt;
      zoneV *= 0.92;
      zone += zoneV * dt * 1.6;
      const zw = 0.3 - pull * 0.1;
      if (zone < zw / 2) {
        zone = zw / 2;
        zoneV = Math.max(0, zoneV);
      }
      if (zone > 1 - zw / 2) {
        zone = 1 - zw / 2;
        zoneV = Math.min(0, zoneV);
      }
      const inside = Math.abs(pos - zone) < zw / 2;
      progress += (inside ? 0.32 : -(0.16 + pull * 0.2)) * dt;
      if (progress >= 1) caught();
      else if (progress <= 0) escaped(`${fish.def.rarity === 'common' || fish.def.rarity === 'junk' ? '물고기' : '큰 물고기'}가 줄을 끊고 도망갔어요`);
    }
  }

  function render(now: number) {
    // 물
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, where === 'sea' ? '#8fcde6' : '#9fdcd6');
    grd.addColorStop(1, where === 'sea' ? '#3f8fb8' : '#5fb8c4');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const y = ((i * h) / 6 + now * 0.012) % h;
      g.beginPath();
      g.moveTo(20 + ((i * 53) % 80), y);
      g.quadraticCurveTo(w / 2, y + 6 * Math.sin(now / 700 + i), w - 30, y);
      g.stroke();
    }
    // 물풀과 연잎 (바다는 거품)
    g.fillStyle = where === 'sea' ? 'rgba(255,255,255,0.45)' : '#7cc48a';
    g.beginPath();
    g.ellipse(w * 0.15, h * 0.2, 24, 12, 0.3, 0, Math.PI * 2);
    g.ellipse(w * 0.85, h * 0.7, 28, 13, -0.4, 0, Math.PI * 2);
    g.fill();
    // 줄
    const showBob = phase !== 'ready' && !(phase === 'done' && !fish);
    const castK = phase === 'cast' ? Math.min(1, t / 0.6) : 1;
    let by = bob.y + Math.sin(now / 400) * 3;
    if (phase === 'wait' && nibbleAt > 0 && Math.abs(t - nibbleAt) < 0.18) by += 5;
    if (phase === 'bite') by += 12;
    const bx = w * 0.85 + (bob.x - w * 0.85) * castK;
    const byy = h + (by - h) * castK - Math.sin(castK * Math.PI) * 80;
    if (phase !== 'ready') {
      g.strokeStyle = 'rgba(60,45,35,0.6)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(w * 0.92, h + 4);
      g.quadraticCurveTo(w * 0.8, byy - 60, bx, byy);
      g.stroke();
    }
    if (showBob && phase !== 'reel') {
      if (phase === 'bite') {
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 2;
        for (let k = 1; k <= 3; k++) {
          g.beginPath();
          g.ellipse(bx, by + 4, 10 * k + (t * 30) % 10, 4 * k, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.fillStyle = '#ff6b5b';
      g.beginPath();
      g.arc(bx, byy - (phase === 'bite' ? 0 : 4), 7, Math.PI, 0);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(bx, byy - (phase === 'bite' ? 0 : 4), 7, 0, Math.PI);
      g.fill();
      if (phase === 'bite') {
        g.fillStyle = '#5b4636';
        g.font = '800 34px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('!', bx, byy - 22);
      }
    }
    // 줄다리기 막대
    if (phase === 'reel' && fish) {
      const pad = 22;
      const bw = w - pad * 2;
      const y0 = h - 70;
      const zw = 0.3 - fish.def.pull * 0.1;
      g.fillStyle = 'rgba(255,252,245,0.92)';
      roundRect(g, pad - 6, y0 - 16, bw + 12, 62, 14);
      g.fill();
      g.fillStyle = '#e8dfd0';
      roundRect(g, pad, y0, bw, 18, 9);
      g.fill();
      g.fillStyle = '#7fd8b0';
      roundRect(g, pad + (zone - zw / 2) * bw, y0, zw * bw, 18, 9);
      g.fill();
      // 물고기
      g.save();
      g.translate(pad + pos * bw, y0 + 9);
      g.fillStyle = fish.def.rarity === 'junk' ? '#7b6a5a' : '#3d6f86';
      g.beginPath();
      g.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
      g.moveTo(9, 0);
      g.lineTo(17, -6);
      g.lineTo(17, 6);
      g.fill();
      g.restore();
      // 끌어오기 진행
      g.fillStyle = '#e8dfd0';
      roundRect(g, pad, y0 + 26, bw, 8, 4);
      g.fill();
      g.fillStyle = '#ff8f7a';
      roundRect(g, pad, y0 + 26, Math.max(8, progress * bw), 8, 4);
      g.fill();
      // 물속 그림자
      g.fillStyle = 'rgba(30,60,80,0.25)';
      g.beginPath();
      g.ellipse(w * 0.3 + pos * w * 0.4, h * 0.42 + Math.sin(now / 200) * 6, 26 + fish.def.pull * 20, 10, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    render(now);
    raf = requestAnimationFrame(frame);
  }
  reset();
  raf = requestAnimationFrame(frame);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}
