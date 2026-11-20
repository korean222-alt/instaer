// 배경 음악과 효과음. 음악 파일 없이 Web Audio 로 그 자리에서 만든다 (내려받을 파일 0개, 저작권 걱정 없음).
// - 브라우저는 사용자가 한 번 누른 뒤에만 소리를 낼 수 있어서, 첫 터치에 켠다.
// - 탭이 숨겨지면 멈추고 돌아오면 다시 켠다.
// - 크기는 설정(배경 음악, 효과음 각각 0~1)에서 바꾸고 이 브라우저에 저장한다.
// - 아이폰은 무음 스위치를 켜 두면 웹 소리가 나지 않는다 (브라우저 제한).

export type Sfx = 'tap' | 'open' | 'close' | 'like' | 'place' | 'remove' | 'rotate' | 'save' | 'fanfare' | 'error' | 'meow' | 'mew' | 'purr' | 'ding' | 'jump';

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
/** 효과음+음악이 스피커로 나가기 직전 (자동 녹화가 여기서 소리를 받는다) */
let mixOut: AudioNode | null = null;
/** 자동 녹화 중이면 녹화로 가는 소리 출구 */
let recDest: MediaStreamAudioDestinationNode | null = null;
let bgmGain: GainNode;
let sfxGain: GainNode;
let musicTimer = 0;
let nextBeat = 0;
let step = 0;
let night = false;

// ── 음악 재료 (2026-11-18 다시 씀): 직접 지은 잔잔한 16마디 곡. 무작위 음 대신 정해진 가락을 오르골 소리로 ──
// 화음(패드) + 낮은 음 + 8분음 아르페지오 + 가락. 세 바퀴에 한 번은 가락 없이 쉬어 가는 간주. 잔향을 걸고 아주 작은 파도 소리를 깐다.
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
type ChordQ = 'M' | 'm' | '7';
/** 16마디: F Am Bb F | Dm Gm C C | F Am Bb Gm | F C7 F F (근음은 F3=53 근처) */
const PROG: Array<[number, ChordQ]> = [
  [53, 'M'], [57, 'm'], [58, 'M'], [53, 'M'],
  [50, 'm'], [55, 'm'], [48, 'M'], [48, 'M'],
  [53, 'M'], [57, 'm'], [58, 'M'], [55, 'm'],
  [53, 'M'], [48, '7'], [53, 'M'], [53, 'M'],
];
const THIRD: Record<ChordQ, number> = { M: 4, m: 3, '7': 4 };
const ARP: Record<ChordQ, number[]> = {
  M: [0, 7, 12, 16, 19, 16, 12, 7],
  m: [0, 7, 12, 15, 19, 15, 12, 7],
  '7': [0, 7, 10, 16, 19, 16, 10, 7],
};
/** 가락: [음(0 이면 쉼), 박] 마디마다 4박 */
const MELODY: Array<[number, number]> = [
  [72, 1], [69, 1], [72, 1], [77, 1],
  [76, 2], [72, 1], [69, 1],
  [74, 1.5], [72, 0.5], [70, 1], [74, 1],
  [72, 3], [0, 1],
  [69, 1], [74, 1], [77, 1], [76, 1],
  [74, 2], [70, 1], [67, 1],
  [72, 1], [76, 1], [79, 1], [76, 1],
  [74, 3], [0, 1],
  [72, 1], [69, 1], [72, 1], [77, 1],
  [76, 1.5], [77, 0.5], [76, 1], [72, 1],
  [74, 1], [77, 1], [81, 1], [79, 1],
  [77, 1.5], [74, 0.5], [70, 1], [74, 1],
  [72, 2], [69, 1], [77, 1],
  [76, 1], [74, 1], [72, 1], [70, 1],
  [69, 2], [67, 1], [69, 1],
  [65, 3], [0, 1],
];
/** 8분음 칸 → 그 칸에서 시작하는 가락 음 */
const MELODY_AT = new Map<number, { n: number; beats: number }>();
{
  let at = 0;
  for (const [n, b] of MELODY) {
    if (n) MELODY_AT.set(at, { n, beats: b });
    at += Math.round(b * 2);
  }
}
const CYCLE = PROG.length * 8;
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let musicBus: GainNode | null = null;
let waves: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

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
  // 2026-11-20: 음악을 키우면서 여러 소리가 겹쳐도 찢어지지 않게 마지막에 살짝 눌러 준다
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -6;
  limit.knee.value = 6;
  limit.ratio.value = 8;
  limit.attack.value = 0.003;
  limit.release.value = 0.25;
  master.connect(soft).connect(limit).connect(ctx.destination);
  mixOut = limit;
  bgmGain = ctx.createGain();
  sfxGain = ctx.createGain();
  bgmGain.connect(master);
  sfxGain.connect(master);
  // 음악 잔향: 짧게 만든 잔향 소리(2.4초)를 섞는다
  musicBus = ctx.createGain();
  // 2026-11-20 사용자: "브금이 안 들린다" → 고양이 울음보다 30dB 가까이 작아 폰 스피커로는 안 들렸다. 음악 전체를 키운다
  musicBus.gain.value = 3.2;
  const dry = ctx.createGain();
  dry.gain.value = 0.8;
  const wet = ctx.createGain();
  wet.gain.value = 0.38;
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 2.4);
  const warm = ctx.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 3200;
  musicBus.connect(warm);
  warm.connect(dry).connect(bgmGain);
  warm.connect(verb).connect(wet).connect(bgmGain);
  applyVolume();
  return ctx;
}

/** 촬영 모드 나레이션 중에는 배경 음악을 낮춘다 (1 = 그대로) */
let musicDuck = 1;

function applyVolume() {
  if (!ctx) return;
  // 사람 귀에 맞게 제곱으로
  bgmGain.gain.setTargetAtTime(settings.bgm ** 1.6 * 0.95 * musicDuck, ctx.currentTime, musicDuck < 1 ? 0.35 : 0.1);
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

/** 잔향용 소리: 점점 작아지는 잡음 (양쪽 귀를 조금 다르게) */
function impulse(c: AudioContext, sec: number): AudioBuffer {
  const len = Math.ceil(c.sampleRate * sec);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
  }
  return buf;
}

/** 오르골 소리 (가락) */
function bell(out: AudioNode, freq: number, at: number, dur: number, vol: number) {
  tone(out, freq, at, Math.max(1.2, dur), vol, 'sine', 0.004);
  tone(out, freq * 2, at, 0.5, vol * 0.28, 'sine', 0.003);
  tone(out, freq * 3.01, at, 0.18, vol * 0.08, 'sine', 0.002);
}

/** 부드러운 전자 피아노 (아르페지오) */
function keys(out: AudioNode, freq: number, at: number, vol: number) {
  tone(out, freq, at, 0.9, vol, 'triangle', 0.006);
  tone(out, freq * 2, at, 0.25, vol * 0.2, 'sine', 0.003);
}

/** 멀리서 들리는 파도 (잡음을 아주 천천히 키웠다 줄인다) */
function startWaves() {
  if (!ctx || !musicBus || waves) return;
  const c = ctx;
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // 갈색 잡음 (낮은 소리 위주) + 앞뒤를 맞춰 끊김 없이 돈다
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.2;
  }
  const fade = Math.floor(c.sampleRate * 0.2);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const gain = c.createGain();
  gain.gain.value = 0.12;
  // 9초에 한 번 밀려왔다 빠지는 느낌
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.11;
  const depth = c.createGain();
  depth.gain.value = 0.08;
  lfo.connect(depth).connect(gain.gain);
  src.connect(lp).connect(gain).connect(bgmGain);
  src.start();
  lfo.start();
  waves = { src, gain };
}

// ── 배경 음악: 8분음 단위로 미리 1초씩 음을 예약한다 ──
function scheduleMusic() {
  if (!ctx || !musicBus || settings.bgm <= 0) return;
  const out = musicBus;
  const bpm = night ? 62 : 70;
  const eighth = 60 / bpm / 2;
  // 소리를 껐다 켜면 밀린 음을 한꺼번에 내지 않게 지금부터 다시 센다
  if (nextBeat < ctx.currentTime - 0.1) nextBeat = ctx.currentTime + 0.1;
  while (nextBeat < ctx.currentTime + 1.2) {
    const pos = step % CYCLE;
    const cycle = Math.floor(step / CYCLE);
    const bar = Math.floor(pos / 8);
    const e = pos % 8;
    const [root, q] = PROG[bar];
    const t = nextBeat;
    const human = () => 0.85 + rnd() * 0.3;
    // 마디 첫 박: 길게 깔리는 화음과 낮은 음
    if (e === 0) {
      for (const iv of [0, THIRD[q], 7]) {
        tone(out, midi(root + 12 + iv), t, eighth * 8.6, 0.022, 'sine', 0.5);
        tone(out, midi(root + 12 + iv) * 1.003, t, eighth * 8.6, 0.012, 'triangle', 0.7);
      }
      tone(out, midi(root - 12), t, eighth * 3.6, 0.1, 'sine', 0.03);
      // 폰 스피커는 아주 낮은 음(80Hz 쯤)을 못 내서, 한 옥타브 위 부드러운 음을 겹쳐 낮은 음이 들리게
      tone(out, midi(root), t, eighth * 3.6, 0.05, 'triangle', 0.03);
    }
    if (e === 4) tone(out, midi(root - 12 + 7), t, eighth * 3.4, 0.08, 'sine', 0.03);
    // 아르페지오: 낮에는 8분음 전부, 밤에는 4분음만
    if (!night || e % 2 === 0) keys(out, midi(root + ARP[q][e]), t, 0.032 * human());
    // 가락: 세 바퀴에 한 번은 쉰다. 밤에는 한 옥타브 낮고 작게
    const m = cycle % 3 === 2 ? undefined : MELODY_AT.get(pos);
    if (m) bell(out, midi(m.n - (night ? 12 : 0)), t, m.beats * eighth * 2, (night ? 0.05 : 0.065) * human());
    // 쉬는 바퀴에는 가끔 높은 풍경 소리
    if (cycle % 3 === 2 && e % 4 === 2 && rnd() < 0.3) bell(out, midi(root + 24 + ARP[q][Math.floor(rnd() * 5)]), t, 2, 0.02);
    nextBeat += eighth;
    step++;
  }
}

function startMusic() {
  if (!ctx || musicTimer) return;
  nextBeat = ctx.currentTime + 0.1;
  startWaves();
  if (waves) waves.gain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.5);
  musicTimer = window.setInterval(scheduleMusic, 250);
  scheduleMusic();
}
function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = 0;
  if (ctx && waves) waves.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
}

/** 가르릉: 낮은 떨림(초당 25번)을 숨 들이쉬고 내쉬듯 두 번 */
function purr(out: AudioNode, at: number, vol: number) {
  const c = ctx!;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 24 + Math.random() * 4;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  // 폰 스피커는 아주 낮은 소리를 못 내서, 떨림의 배음(수백 Hz)이 들리게 조금 열어 둔다
  lp.frequency.value = 650;
  lp.Q.value = 1.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  const breaths = [0, 1.25, 2.5];
  for (const b of breaths) {
    const v = b === 1.25 ? vol * 0.7 : vol;
    g.gain.exponentialRampToValueAtTime(v, at + b + 0.35);
    g.gain.exponentialRampToValueAtTime(vol * 0.12, at + b + 1.15);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, at + 3.7);
  o.connect(lp).connect(g).connect(out);
  o.start(at);
  o.stop(at + 3.8);
}

const vary = (a: number, b: number) => a + Math.random() * (b - a);

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
  // 2026-11-19 사용자: 만든 울음 소리가 기괴하다 → 진짜 녹음 파일(public/sfx/meow.mp3)이 있을 때만 울고, 없으면 조용히
  meow: (t) => meowFile(t, vary(0.96, 1.05), 0.9, 0),
  mew: (t) => meowFile(t, vary(1.02, 1.12), 0.8, 0, true),
  purr: (t) => purr(sfxGain, t, 0.3),
  ding: (t) => tone(sfxGain, midi(88), t, 0.5, 0.08, 'sine', 0.003),
  jump: (t) => tone(sfxGain, 300, t, 0.18, 0.1, 'sine', 0.005, 620),
};

export function play(name: Sfx) {
  if (!ctx || settings.sfx <= 0 || ctx.state !== 'running') return;
  SFX[name](ctx.currentTime + 0.01);
}

/** 멀리 있는 고양이 울음 (걷는 동안 가끔). distance 는 미터: 멀수록 작고 먹먹하다 */
export function playAmbientMeow(distance: number) {
  if (!ctx || settings.sfx <= 0 || ctx.state !== 'running') return;
  const far = Math.min(1, Math.max(0, (distance - 3) / 20));
  const kitten = Math.random() < 0.3;
  meowFile(ctx.currentTime + 0.01, vary(0.94, 1.06), 0.6 * (1 - far * 0.8), far, kitten);
}

// ── 진짜 고양이 울음 (녹음 파일, 2026-11-19 사용자가 올린 Pixabay 울음 5개) ──
// public/sfx/meow1~5.mp3 를 처음 소리가 켜질 때 받아 둔다. 울 때마다 하나를 고른다(아기 울음은 2번 귀여운 울음 위주).
// 못 받은 파일은 빼고, 하나도 없으면 울음은 그냥 나지 않는다.
const MEOW_URLS = [1, 2, 3, 4, 5].map((n) => `/sfx/meow${n}.mp3`);
const KITTEN = new Set([1, 3, 4]);
const meowBufs: Array<AudioBuffer | null> = MEOW_URLS.map(() => null);
let meowLoading = false;
let lastMeow = -1;
function loadMeow() {
  if (!ctx || meowLoading) return;
  meowLoading = true;
  const c = ctx;
  MEOW_URLS.forEach((url, i) =>
    fetch(url)
      .then((r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') ? r.arrayBuffer() : Promise.reject(new Error('no file'))))
      .then((b) => c.decodeAudioData(b))
      .then((buf) => {
        meowBufs[i] = buf;
      })
      .catch(() => {
        /* 파일 없음: 그 울음만 뺀다 */
      }),
  );
}
/** rate: 높이(빠르기), far: 0~1 멀수록 먹먹하게, kitten: 아기 고양이 울음 쪽에서 고른다 */
function meowFile(at: number, rate: number, vol: number, far: number, kitten = false) {
  if (!ctx) return;
  loadMeow();
  let pool = meowBufs.map((b, i) => (b && KITTEN.has(i) === kitten ? i : -1)).filter((i) => i >= 0);
  if (!pool.length) pool = meowBufs.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  if (!pool.length) return;
  // 같은 울음이 연달아 나지 않게
  if (pool.length > 1) pool = pool.filter((i) => i !== lastMeow);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastMeow = pick;
  const buf = meowBufs[pick]!;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  let node: AudioNode = src;
  if (far > 0) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000 - far * 3800;
    node.connect(lp);
    node = lp;
  }
  node.connect(g);
  g.connect(sfxGain);
  src.start(at);
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
    c.resume().then(() => {
      startMusic();
      loadMeow();
    });
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

// ── 촬영 모드 효과음 (2026-11-17) ──
// 영상용이라 효과음 크기 설정이 0 이어도 조금은 들리게 한다 (촬영할 때 소리를 끄고 찍지 않도록).

/** 바람 가르는 소리: 잡음이 높아졌다 낮아진다 */
function whoosh(out: AudioNode, at: number, dur: number, vol: number, from: number, to: number) {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.05);
}

export type CineSfx = 'whoosh' | 'whooshDown' | 'pop' | 'riser' | 'chime' | 'boom' | 'sparkle' | 'tick';

let cineOut: GainNode | null = null;
function cineGain(): GainNode | null {
  const c = ensure();
  if (!c) return null;
  if (!cineOut) {
    cineOut = c.createGain();
    cineOut.connect(master);
  }
  cineOut.gain.value = Math.max(0.35, settings.sfx) ** 2 * 0.9;
  return cineOut;
}

/** 촬영 모드 효과음. pitch 는 0~1 (팝 소리를 점점 높게 낼 때) */
export function playCine(name: CineSfx, pitch = 0) {
  const out = cineGain();
  if (!ctx || !out || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  switch (name) {
    case 'whoosh':
      whoosh(out, t, 0.9, 0.5, 300, 2600);
      break;
    case 'whooshDown':
      whoosh(out, t, 1.1, 0.45, 2400, 220);
      break;
    case 'pop': {
      // 동글동글한 "뽁": 짧은 사인파가 위로 튄다
      const base = 420 * 2 ** (pitch * 1.6);
      tone(out, base, t, 0.11, 0.16, 'sine', 0.002, base * 1.9);
      tone(out, base * 2, t, 0.05, 0.04, 'triangle', 0.002);
      break;
    }
    case 'riser': {
      whoosh(out, t, 2.4, 0.28, 200, 5200);
      tone(out, 220, t, 2.4, 0.05, 'triangle', 1.6, 660);
      break;
    }
    case 'chime':
      [76, 79, 84, 88, 91].forEach((n, i) => tone(out, midi(n), t + i * 0.085, 1.2, 0.09, 'sine', 0.004));
      [64, 72].forEach((n) => tone(out, midi(n), t, 1.8, 0.07, 'triangle', 0.02));
      break;
    case 'boom':
      tone(out, 110, t, 0.9, 0.35, 'sine', 0.004, 42);
      noise(out, t, 0.25, 0.25, 180);
      break;
    case 'sparkle':
      [96, 100, 103].forEach((n, i) => tone(out, midi(n), t + i * 0.045, 0.35, 0.03, 'sine', 0.002));
      break;
    case 'tick':
      tone(out, 1800, t, 0.03, 0.05, 'square', 0.001);
      break;
  }
}

/** 촬영 모드: 소리를 확실히 켠다 (화면을 누른 직후에 부른다) */
export function unlockSound(): Promise<void> {
  const c = ensure();
  if (!c) return Promise.resolve();
  return c.resume().then(() => startMusic());
}

// ── 촬영 모드 나레이션 (2026-11-18): 미리 만든 목소리 파일(ElevenLabs)을 영상 시간에 맞춰 튼다 ──

/** 나레이션 파일을 미리 받아 풀어 둔다 (실패하면 null: 목소리 없이 찍는다) */
export async function loadCineVoice(url: string): Promise<AudioBuffer | null> {
  try {
    const c = ensure();
    if (!c) return null;
    const data = await (await fetch(url)).arrayBuffer();
    return await new Promise<AudioBuffer>((ok, fail) => c.decodeAudioData(data, ok, fail));
  } catch {
    return null;
  }
}

/** delay 초 뒤에 나레이션을 튼다. 도는 동안 배경 음악을 낮춘다. 돌려준 함수로 멈춘다 */
export function playCineVoice(buf: AudioBuffer, delay: number): () => void {
  const c = ensure();
  if (!c) return () => {};
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = 1;
  // 목소리는 음악용 부드럽게 깎는 필터를 거치지 않고 바로 낸다 (또렷하게)
  src.connect(g).connect(c.destination);
  if (recDest) g.connect(recDest);
  const at = c.currentTime + Math.max(0, delay);
  src.start(at);
  musicDuck = 0.4;
  applyVolume();
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    musicDuck = 1;
    applyVolume();
  };
  src.onended = end;
  return () => {
    try {
      src.stop();
    } catch {
      /* 이미 멈춤 */
    }
    end();
  };
}

/** (2026-11-19 촬영 자동 녹화) 지금 나는 소리(음악, 효과음, 나레이션)를 녹화용 스트림으로도 보낸다. 소리를 못 쓰면 null */
export function startRecordAudio(): MediaStream | null {
  const c = ensure();
  if (!c || !mixOut || typeof c.createMediaStreamDestination !== 'function') return null;
  if (!recDest) {
    recDest = c.createMediaStreamDestination();
    mixOut.connect(recDest);
  }
  return recDest.stream;
}

export function stopRecordAudio() {
  if (!recDest) return;
  try {
    mixOut?.disconnect(recDest);
  } catch {
    /* 이미 끊김 */
  }
  recDest = null;
}

