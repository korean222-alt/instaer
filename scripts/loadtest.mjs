// 실시간 부하 시험: 가짜 접속자 N명이 한 구역에서 1초에 8번씩 움직인다.
// 로컬에서만 쓴다 (.dev.vars 에 LOADTEST_KEY 가 있어야 가짜 유저로 접속할 수 있다).
//   npm run preview:cf            # 다른 터미널
//   node scripts/loadtest.mjs [접속자 수=100] [초=20] [주소=ws://127.0.0.1:8787]
// 결과: 지연(서버 시각 → 받은 시각), 보낸/받은 메시지 수, 1인당 보이는 수, 무료 한도 환산.
// 같은 컴퓨터에서 서버와 시험을 같이 돌리므로 지연은 "서버 처리 + 로컬 전달" 값이다 (실제 인터넷 지연은 빠져 있다).
import { readFileSync } from 'node:fs';

const N = Number(process.argv[2] ?? 100);
const SECONDS = Number(process.argv[3] ?? 20);
const BASE = process.argv[4] ?? 'ws://127.0.0.1:8787';
const KEY = (readFileSync('.dev.vars', 'utf8').match(/LOADTEST_KEY="?([^"\n]+)"?/) ?? [])[1];
if (!KEY) throw new Error('.dev.vars 에 LOADTEST_KEY 가 없어요');
const HZ = 8;
const POS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((arr.length * p) / 100))] : NaN);

function bot(path, name, onMsg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}${path}?u=${name}`, ['ci.v1', `lt.${KEY}`]);
    const s = { ws, name, sent: 0, recv: 0, bytes: 0, lat: [], visibleMax: 0, visible: [], fixes: 0, hello: false };
    ws.onmessage = (ev) => {
      s.recv++;
      s.bytes += ev.data.length;
      const m = JSON.parse(ev.data);
      if (m.t === 'hello') {
        s.hello = true;
        resolve(s);
      }
      if (m.t === 's') {
        s.lat.push(Date.now() - m.st);
        s.visibleMax = Math.max(s.visibleMax, m.p.length);
        s.visible.push(m.p.length);
      }
      if (m.t === 'fix') s.fixes++;
      if (m.t === 'bye') {
        s.bye = m.reason;
        resolve(s);
      }
      onMsg?.(s, m);
    };
    ws.onerror = () => reject(new Error(`connect failed: ${name}`));
    setTimeout(() => reject(new Error(`timeout: ${name}`)), 10_000);
  });
}

function send(s, x, z, r, a = 1) {
  if (s.ws.readyState !== WebSocket.OPEN) return;
  s.ws.send(JSON.stringify({ t: 'm', x: Math.round(x * POS), z: Math.round(z * POS), r: Math.round(r * 100), a }));
  s.sent++;
}

async function zoneTest() {
  console.log(`\n[구역 시험] 접속자 ${N}명, ${SECONDS}초, 1초 ${HZ}번`);
  const t0 = Date.now();
  const bots = [];
  for (let i = 0; i < N; i += 10) bots.push(...(await Promise.all(Array.from({ length: Math.min(10, N - i) }, (_, k) => bot('/api/rt/zone/0', `z${i + k}`)))));
  console.log(`  접속 완료 ${bots.length}명 (${Date.now() - t0}ms)`);
  // 각자 반지름 3~60 의 원을 걷는다 (서로 많이 겹치게 섬 가운데 근처)
  const paths = bots.map((_, i) => ({ cx: ((i * 37) % 100) - 50, cz: ((i * 53) % 100) - 50, rad: 3 + (i % 7), sp: 0.6 + (i % 5) * 0.15, ph: i }));
  const start = Date.now();
  while (Date.now() - start < SECONDS * 1000) {
    const t = (Date.now() - start) / 1000;
    bots.forEach((b, i) => {
      const p = paths[i];
      const ang = p.ph + t * p.sp;
      send(b, p.cx + Math.cos(ang) * p.rad, p.cz + Math.sin(ang) * p.rad, ang);
    });
    await sleep(1000 / HZ);
  }
  await sleep(500);
  const lat = bots.flatMap((b) => b.lat);
  const sent = bots.reduce((n, b) => n + b.sent, 0);
  const recv = bots.reduce((n, b) => n + b.recv, 0);
  const bytes = bots.reduce((n, b) => n + b.bytes, 0);
  const vis = bots.flatMap((b) => b.visible);
  const maxVis = Math.max(...bots.map((b) => b.visibleMax));
  const fixes = bots.reduce((n, b) => n + b.fixes, 0);
  console.log(`  지연 ms: 중앙값 ${pct(lat, 50)}, 95% ${pct(lat, 95)}, 99% ${pct(lat, 99)}, 최대 ${Math.max(...lat)}`);
  console.log(`  보낸 메시지 ${sent} (초당 ${(sent / SECONDS).toFixed(0)}), 받은 메시지 ${recv} (초당 ${(recv / SECONDS).toFixed(0)}), 받은 양 ${(bytes / 1024 / SECONDS).toFixed(0)} KB/s`);
  console.log(`  1인당 보이는 수: 평균 ${(vis.reduce((a, b) => a + b, 0) / vis.length).toFixed(1)}, 최대 ${maxVis} (상한 20)`);
  console.log(`  위치 거절(fix): ${fixes}`);
  const perUserHour = HZ * 3600;
  console.log(`  무료 한도 환산: 들어오는 메시지 20개 = 요청 1건 → 1명이 1시간 계속 걸으면 약 ${Math.round(perUserHour / 20).toLocaleString()}건.`);
  console.log(`    하루 100,000건이면 "계속 걷는 사람 x 시간" 으로 약 ${(100_000 / (perUserHour / 20)).toFixed(0)}시간 (예: 70명이 1시간씩).`);
  bots.forEach((b) => b.ws.close());
  return { maxVis, p50: pct(lat, 50), p95: pct(lat, 95) };
}

async function roomTest() {
  console.log('\n[미니게임 방 시험] 12명이 서로 멀리 떨어져서 방 test 에 들어간다');
  const bots = [];
  for (let i = 0; i < 12; i++) bots.push(await bot('/api/rt/room/test', `r${i}`));
  bots.forEach((b, i) => send(b, i * 300, i * 300, 0, 0)); // 서로 300 이상 떨어짐
  await sleep(800);
  bots.forEach((b, i) => send(b, i * 300 + 0.5, i * 300, 0.1, 1));
  await sleep(800);
  const seen = bots.map((b) => b.visibleMax);
  console.log(`  각자 보이는 수: ${seen.join(', ')} (모두 11 이어야 함)`);
  const extra = await bot('/api/rt/room/test', 'r12').catch(() => null);
  const full = extra?.bye === 'full';
  console.log(`  13번째 접속: ${full ? '꽉 차서 거절됨 (정상)' : '들어감 (문제)'}`);
  // 방 메시지
  let got = 0;
  bots.slice(1).forEach((b) => b.ws.addEventListener('message', (ev) => JSON.parse(ev.data).t === 'room' && got++));
  bots[0].ws.send(JSON.stringify({ t: 'room', d: { hi: 1 } }));
  await sleep(500);
  console.log(`  방 메시지: 11명 중 ${got}명이 받음`);
  bots.forEach((b) => b.ws.close());
  return seen.every((n) => n === 11) && full && got === 11;
}

async function cheatTest() {
  console.log('\n[이상 속도 시험] 한 번에 100칸 순간이동');
  const b = await bot('/api/rt/zone/0', 'cheat');
  send(b, 0, 0, 0);
  await sleep(300);
  send(b, 100, 0, 0);
  await sleep(300);
  console.log(`  서버가 되돌림(fix): ${b.fixes > 0 ? '예 (정상)' : '아니오 (문제)'}`);
  b.ws.close();
  return b.fixes > 0;
}

const z = await zoneTest();
const r = await roomTest();
const c = await cheatTest();
console.log(`\n요약: 구역 최대 보이는 수 ${z.maxVis}/20, 지연 중앙값 ${z.p50}ms / 95% ${z.p95}ms, 방 시험 ${r ? '통과' : '실패'}, 속도 검사 ${c ? '통과' : '실패'}`);
process.exit(0);
