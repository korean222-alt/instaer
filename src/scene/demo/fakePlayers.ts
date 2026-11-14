// 확인용 가짜 유저. 서버 없이 setRemotePlayers 를 시험한다.
// 가짜 유저들이 내 고양이 둘레를 무작위로 걷고, 가끔 앉고 점프하고, 접속을 끊었다가 다시 들어온다.
// 실제 서버처럼 1초에 10번, 내 주변 NEARBY_RADIUS 안의 가까운 NEARBY_MAX 명만 넘긴다.
import type { House } from '../../shared/types';
import { mockCat } from '../dev/mockHouses';
import type { IslandScene, RemotePlayer } from '../index';
import { landAt } from '../layout';
import { mulberry32 } from '../util/rand';
import { Walker } from '../walk/Walker';

// CLAUDE.md "공통 설정" 값. src/shared/config.ts 에 생기면 그쪽에서 가져온다
const NEARBY_MAX = 20;
const NEARBY_RADIUS = 40;
const SEND_MS = 100;
const STEP_MS = 50;

const NAMES = ['mochi', 'bori', 'nabi', 'kong', 'dubu', 'coco', 'haru', 'choco', 'bam', 'dal', 'gaeul', 'tori', 'yuja', 'ggomi', 'ruru', 'somi'];
const TAILS = ['_cat', '.nyang', '_meow', '.zip', '_daily', '.log', '_jelly', '_island', '.butler', '_mom'];

interface Bot {
  walker: Walker;
  out: RemotePlayer;
  online: boolean;
  /** 지금 행동이 끝날 때까지 남은 시간 (초) */
  left: number;
  mx: number;
  my: number;
  stuck: number;
  d2: number;
}

export interface FakePlayers {
  stop(): void;
  /** 방금 넘긴 유저 수 */
  sent(): number;
}

/**
 * @param total 가짜 유저 수. 주변에 20명이 차 있으면서 들락거림도 보이게 조금 넉넉히 둔다
 * @param warp  true 면 가끔 한 명이 멀리 순간이동한다 (튄 위치를 미끄러지듯 따라가는지 확인용)
 */
export function startFakePlayers(island: IslandScene, houses: House[], total = 28, warp = false): FakePlayers {
  const rnd = mulberry32(Math.floor(performance.now()) + 7);
  const have = new Set(houses.map((h) => h.houseNo));
  const bots: Bot[] = [];
  let lastSent = 0;

  const spot = (cx: number, cz: number, min: number, max: number) => {
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const r = min + (max - min) * Math.sqrt(rnd());
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      if (landAt(x, z) >= 3) return { x, z };
    }
    return { x: cx, z: cz };
  };

  const me = island.getLocalState();
  for (let i = 0; i < total; i++) {
    const walker = new Walker();
    walker.hasHouse = (n) => have.has(n);
    // 처음 20명은 가까이, 나머지는 바깥쪽에서 시작해서 걸어 들어오게 한다
    const s = i < NEARBY_MAX ? spot(me.x, me.z, 3, 26) : spot(me.x, me.z, 30, 46);
    walker.place(s.x, s.z, rnd() * 6.28);
    bots.push({
      walker,
      out: {
        id: `fake-${i}`,
        houseNo: null,
        handle: `${NAMES[Math.floor(rnd() * NAMES.length)]}${TAILS[Math.floor(rnd() * TAILS.length)]}${Math.floor(rnd() * 90 + 10)}`,
        x: s.x,
        z: s.z,
        rotY: 0,
        anim: 'idle',
        cat: mockCat(rnd),
      },
      online: true,
      left: rnd() * 2,
      mx: 0,
      my: 0,
      stuck: 0,
      d2: 0,
    });
  }

  const step = () => {
    const dt = STEP_MS / 1000;
    const c = island.getLocalState();
    for (const b of bots) {
      const w = b.walker;
      b.left -= dt;
      if (!b.online) {
        // 다시 접속: 내 주변 아무 데서나 나타난다
        if (b.left <= 0) {
          const s = spot(c.x, c.z, 4, 30);
          w.place(s.x, s.z, rnd() * 6.28);
          b.online = true;
          b.left = 0;
        }
        continue;
      }
      if (b.left <= 0) {
        if (rnd() < 0.02) {
          // 접속 끊기
          b.online = false;
          b.left = 3 + rnd() * 6;
          continue;
        }
        if (rnd() < 0.62) {
          // 걷기: 너무 멀어졌으면 내 쪽으로, 아니면 아무 방향으로
          const far = Math.hypot(w.x - c.x, w.z - c.z) > 30 && rnd() < 0.75;
          const a = far ? Math.atan2(c.x - w.x, c.z - w.z) + (rnd() - 0.5) * 1.2 : rnd() * Math.PI * 2;
          const power = 0.3 + rnd() * 0.7;
          // Walker 의 입력은 카메라 기준(x 오른쪽, y 앞)이고 카메라 각도 0 에서 앞은 -z 다
          b.mx = Math.sin(a) * power;
          b.my = -Math.cos(a) * power;
          b.left = 1.5 + rnd() * 4.5;
        } else {
          // 쉬기: 5초 넘게 쉬면 앉는다
          b.mx = b.my = 0;
          b.left = 1 + rnd() * 9;
        }
        b.stuck = 0;
      }
      w.update(dt, b.mx, b.my, 0, rnd() < 0.006);
      // 벽에 막혀 제자리걸음이면 방향을 바꾼다
      if ((b.mx || b.my) && w.speed < 0.2) {
        b.stuck += dt;
        if (b.stuck > 0.5) b.left = 0;
      }
    }
    if (warp && rnd() < 0.008) {
      const b = bots[Math.floor(rnd() * bots.length)];
      const s = spot(c.x, c.z, 6, 22);
      if (b.online) b.walker.place(s.x, s.z, b.walker.yaw);
    }
  };

  const list: RemotePlayer[] = [];
  const near: Bot[] = [];
  const send = () => {
    const c = island.getLocalState();
    near.length = 0;
    for (const b of bots) {
      if (!b.online) continue;
      b.d2 = (b.walker.x - c.x) ** 2 + (b.walker.z - c.z) ** 2;
      if (b.d2 < NEARBY_RADIUS * NEARBY_RADIUS) near.push(b);
    }
    near.sort((a, b) => a.d2 - b.d2);
    list.length = 0;
    for (let i = 0; i < near.length && i < NEARBY_MAX; i++) {
      const b = near[i];
      b.out.x = b.walker.x;
      b.out.z = b.walker.z;
      b.out.rotY = b.walker.yaw;
      b.out.anim = b.walker.anim;
      list.push(b.out);
    }
    lastSent = list.length;
    island.setRemotePlayers(list);
  };

  let acc = 0;
  let stopped = false;
  const timer = window.setInterval(() => {
    step();
    acc += STEP_MS;
    if (acc >= SEND_MS) {
      acc = 0;
      // 실제 통신처럼 도착 시각이 조금씩 들쭉날쭉하게
      window.setTimeout(() => {
        if (!stopped) send();
      }, rnd() * 35);
    }
  }, STEP_MS);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      island.setRemotePlayers([]);
    },
    sent: () => lastSent,
  };
}
