// 배경 음악과 효과음. 음악 파일 없이 Web Audio 로 그 자리에서 만든다 (내려받을 파일 0개, 저작권 걱정 없음).
// - 브라우저는 사용자가 한 번 누른 뒤에만 소리를 낼 수 있어서, 첫 터치에 켠다.
// - 탭이 숨겨지면 멈추고 돌아오면 다시 켠다.
// - 크기는 설정(배경 음악, 효과음 각각 0~1)에서 바꾸고 이 브라우저에 저장한다.
// - 아이폰은 무음 스위치를 켜 두면 웹 소리가 나지 않는다 (브라우저 제한).

export type Sfx = 'tap' | 'open' | 'close' | 'like' | 'place' | 'remove' | 'rotate' | 'save' | 'fanfare' | 'error' | 'meow' | 'ding' | 'jump';

export interface SoundSettings {
  bgm: number;
  sfx: number;
}

const KEY = 'ci_sound';
const DEFAULTS: SoundSettings = { bgm: 0.45, sfx: 0.7 };

function load(): SoundSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SoundSettings> | null;
    return { bgm: clamp(v?.bgm ?? DEFAULTS.bgm), sfx: clamp(v?.sfx ?? DEFAULTS.sfx) };
  } catch {
    return { ...DEFAULTS };
  }
}
const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

let settings = load();
let ctx: AudioContext | null = null;
let master: GainNode;
let bgmGain: GainNode;
let sfxGain: GainNode;
let musicTimer = 0;
let nextBeat = 0;
let step = 0;
let night = false;

// ── 음악 재료: 느긋한 F 장조 5음계, 4마디 진행 (F - Dm - Bb - C) ──
const BPM = 76;
const BEAT = 60 / BPM;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const CHORDS = [
  [53, 57, 60], // F
  [50, 53, 57], // Dm
  [46, 50, 53], // Bb
  [48, 52, 55], // C
];
const SCALE = [65, 67, 69, 72, 74, 77, 79, 81]; // F 5음계 (높은 음)
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  // 소리를 부드럽게 (높은 음을 살짝 깎는다)
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 5200;
  master.connect(soft).connect(ctx.destination);
  bgmGain = ctx.createGain();
  sfxGain = ctx.createGain();
  bgmGain.connect(master);
  sfxGain.connect(master);
  applyVolume();
  return ctx;
}

function applyVolume() {
  if (!ctx) return;
  // 사람 귀에 맞게 제곱으로
  bgmGain.gain.setTargetAtTime(settings.bgm ** 2 * 0.5, ctx.currentTime, 0.1);
  sfxGain.gain.setTargetAtTime(settings.sfx ** 2 * 0.9, ctx.currentTime, 0.05);
}

/** 짧은 음 하나 (모양: 'sine' | 'triangle' ...) */
function tone(out: AudioNode, freq: number, at: number, dur: number, vol: number, type: OscillatorType = 'sine', attack = 0.01, glideTo?: number) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** 짧은 잡음 (나무 두드리는 소리 등) */
function noise(out: AudioNode, at: number, dur: number, vol: number, freq: number) {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 3;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(out);
  src.start(at);
}

// ── 배경 음악: 미리 1초씩 음을 예약한다 ──
function scheduleMusic() {
  if (!ctx || settings.bgm <= 0) return;
  // 소리를 껐다 켜면 밀린 음을 한꺼번에 내지 않게 지금부터 다시 센다
  if (nextBeat < ctx.currentTime - 0.1) nextBeat = ctx.currentTime + 0.1;
  while (nextBeat < ctx.currentTime + 1.2) {
    const bar = Math.floor(step / 4) % CHORDS.length;
    const beat = step % 4;
    const chord = CHORDS[bar];
    const t = nextBeat;
    // 마디 첫 박: 낮은 음과 부드러운 화음 (길게)
    if (beat === 0) {
      tone(bgmGain, midi(chord[0] - 12), t, BEAT * 3.8, 0.16, 'sine', 0.08);
      for (const n of chord) tone(bgmGain, midi(n), t, BEAT * 3.6, 0.045, 'triangle', 0.4);
    }
    // 뜯는 소리 화음 (2, 4박)
    if (beat === 1 || beat === 3) tone(bgmGain, midi(chord[1 + (beat >> 1)]), t, BEAT * 0.9, 0.05, 'triangle', 0.01);
    // 가끔 멜로디 (밤에는 더 드물게)
    if (rnd() < (night ? 0.35 : 0.55)) {
      const n = SCALE[Math.floor(rnd() * SCALE.length)] - (night ? 12 : 0);
      const off = rnd() < 0.3 ? BEAT / 2 : 0;
      tone(bgmGain, midi(n), t + off, BEAT * 1.4, 0.07, 'sine', 0.01);
      tone(bgmGain, midi(n + 12), t + off, BEAT * 0.6, 0.012, 'sine', 0.01); // 반짝임
    }
    // 아주 가끔 풍경 소리
    if (rnd() < 0.04) tone(bgmGain, midi(SCALE[5] + 12), t, 2.5, 0.02, 'sine', 0.005);
    nextBeat += BEAT * (night ? 1.15 : 1);
    step++;
  }
}

function startMusic() {
  if (!ctx || musicTimer) return;
  nextBeat = ctx.currentTime + 0.1;
  musicTimer = window.setInterval(scheduleMusic, 250);
  scheduleMusic();
}
function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = 0;
}

// ── 효과음 ──
const SFX: Record<Sfx, (t: number) => void> = {
  tap: (t) => tone(sfxGain, 880, t, 0.07, 0.12, 'sine', 0.003, 660),
  open: (t) => tone(sfxGain, 520, t, 0.14, 0.12, 'sine', 0.005, 780),
  close: (t) => tone(sfxGain, 700, t, 0.12, 0.1, 'sine', 0.005, 470),
  like: (t) => {
    tone(sfxGain, midi(84), t, 0.18, 0.14, 'sine');
    tone(sfxGain, midi(88), t + 0.08, 0.22, 0.14, 'sine');
    tone(sfxGain, midi(91), t + 0.16, 0.35, 0.12, 'sine');
  },
  place: (t) => {
    noise(sfxGain, t, 0.08, 0.5, 900);
    tone(sfxGain, 220, t, 0.1, 0.12, 'triangle', 0.002, 150);
  },
  remove: (t) => tone(sfxGain, 500, t, 0.15, 0.12, 'triangle', 0.003, 200),
  rotate: (t) => noise(sfxGain, t, 0.06, 0.35, 1800),
  save: (t) => [72, 76, 79, 84].forEach((n, i) => tone(sfxGain, midi(n), t + i * 0.07, 0.3, 0.1, 'triangle')),
  fanfare: (t) => {
    [67, 72, 76, 79].forEach((n, i) => tone(sfxGain, midi(n), t + i * 0.1, 0.35, 0.12, 'triangle'));
    [72, 76, 79, 84].forEach((n) => tone(sfxGain, midi(n), t + 0.45, 0.9, 0.07, 'sine', 0.02));
  },
  error: (t) => {
    tone(sfxGain, 220, t, 0.14, 0.12, 'triangle');
    tone(sfxGain, 185, t + 0.12, 0.2, 0.12, 'triangle');
  },
  meow: (t) => {
    // 고양이 "냥": 높이가 올라갔다 내려가는 소리 두 겹
    tone(sfxGain, 520, t, 0.32, 0.1, 'sawtooth', 0.04, 380);
    tone(sfxGain, 760, t, 0.28, 0.05, 'triangle', 0.03, 600);
  },
  ding: (t) => tone(sfxGain, midi(88), t, 0.5, 0.08, 'sine', 0.003),
  jump: (t) => tone(sfxGain, 300, t, 0.18, 0.1, 'sine', 0.005, 620),
};

export function play(name: Sfx) {
  if (!ctx || settings.sfx <= 0 || ctx.state !== 'running') return;
  SFX[name](ctx.currentTime + 0.01);
}

export function getSoundSettings(): SoundSettings {
  return { ...settings };
}

export function setSoundSettings(next: Partial<SoundSettings>) {
  settings = { bgm: clamp(next.bgm ?? settings.bgm), sfx: clamp(next.sfx ?? settings.sfx) };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 저장이 막힌 브라우저 */
  }
  applyVolume();
  if (settings.bgm > 0) startMusic();
}

export function setMusicMood(isNight: boolean) {
  night = isNight;
}

/** 첫 터치에 소리를 켜고, 탭이 숨겨지면 멈춘다 */
export function initSound() {
  const unlock = () => {
    const c = ensure();
    if (!c) return;
    c.resume().then(() => startMusic());
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') {
      stopMusic();
      ctx.suspend();
    } else {
      ctx.resume().then(() => startMusic());
    }
  });
}
