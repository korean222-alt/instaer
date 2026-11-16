// 실시간 방 하나 = Durable Object 하나.
//   'zone:3'    섬 구역 하나. 각 유저에게 가까운 순으로 최대 NEARBY_MAX 명(NEARBY_RADIUS 안)만 보낸다.
//   'room:test' 미니게임 방. 방 안 사람(최대 ROOM_MAX)은 거리와 상관없이 모두 보인다.
// WebSocket Hibernation API 를 쓴다: 아무도 움직이지 않으면 객체가 잠들어 실행 시간(요금/무료 한도)이 쌓이지 않는다.
// 유저 상태는 소켓마다 붙어 있는 attachment 에 둬서 잠들었다 깨어나도 남는다. 별도 공유 저장소는 쓰지 않는다.
import { DurableObject } from 'cloudflare:workers';
import { MOVE_SEND_HZ, NEARBY_MAX, NEARBY_RADIUS, ROOM_MAX } from '../../src/shared/config';
import {
  DAY_MSG_SOFT,
  FISH_POSES,
  MAX_JUMP,
  SEND_MS_MAX,
  SEND_MS_MIN,
  TRAIL_MAX,
  MAX_MSG_PER_SEC,
  MAX_SPEED,
  POS_SCALE,
  RT_PROTOCOL,
  ZONE_CONN_MAX,
  type ClientMsg,
  type PlayerTuple,
  type ServerMsg,
} from '../../src/shared/realtime';
import type { Env } from '../env';
import { CHAT_GAP_MS, CHAT_MAX, DANCES, EMOTES, EMOTE_GAP_MS } from '../../src/shared/social';
import { cleanChat } from '../../src/shared/handle';

/** 연결한 유저 (Worker 가 세션을 확인하고 넘겨준다) */
export interface RtUser {
  uid: string;
  h: string;
  n: number | null;
  c: [string, string, string] | null;
}

/** 소켓마다 붙어 있는 상태. 잠들었다 깨어나도 남는다 */
interface Att extends RtUser {
  id: string;
  room: string;
  /** 위치 (POS_SCALE 정수), 방향, 동작 번호. t=0 이면 아직 위치 없음 */
  x: number;
  z: number;
  r: number;
  a: number;
  /** 낚시 단계 번호 (FISH_POSES, 0 = 낚시 안 함) */
  f: number;
  t: number;
  /** 초당 메시지 수 세기 */
  w: number;
  k: number;
  /** 연속으로 거절한 위치 수 (너무 많으면 다시 맞춘다) */
  bad: number;
  /** 위치 순번, 지난 위치 묶음과 그 간격 */
  q: number;
  p: number[];
  i: number;
  /** 춤 번호 (0 = 안 춤), 마지막 채팅/이모티콘 시각 */
  d?: number;
  cl?: number;
  el?: number;
  /** 자동차: 0 안 탐, 1 운전, 2 뒷자리 / 뒷자리면 운전자 연결 id */
  cr?: number;
  rw?: string;
}

interface Usage {
  day: string;
  messages: number;
  connects: number;
  peak: number;
  broadcasts: number;
}

const R = NEARBY_RADIUS * POS_SCALE;
const BROADCAST_MS = Math.round(1000 / MOVE_SEND_HZ);
const day = () => new Date().toISOString().slice(0, 10);

export class RealtimeRoom extends DurableObject<Env> {
  /** 소켓 → 이미 정보를 보낸 유저 id (잠들면 비워지고, 그러면 다시 보낸다) */
  private known = new Map<WebSocket, Set<string>>();
  /** 소켓 → 마지막으로 보낸 목록 (같으면 다시 보내지 않는다) */
  private lastSig = new Map<WebSocket, string>();
  private lastBroadcast = 0;
  private trailing: ReturnType<typeof setTimeout> | null = null;
  private usage: Usage = { day: day(), messages: 0, connects: 0, peak: 0, broadcasts: 0 };
  private lastFlush = Date.now();
  /** 오늘 받은 메시지 (저장된 값 + 아직 안 저장한 값). 보내기 간격을 정할 때 쓴다 */
  private savedToday = -1;
  /** 지금 보내기 간격 (ms) */
  private sendMs = SEND_MS_MIN;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 'ping' 에는 객체를 깨우지 않고 'pong' 으로 바로 답한다
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('x-ci-usage') === '1') {
      await this.flush(true);
      const saved = (await this.ctx.storage.get<Usage>(`usage:${day()}`)) ?? this.usage;
      return Response.json({ ...saved, connected: this.ctx.getWebSockets().length });
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket only', { status: 426 });

    const user = JSON.parse(request.headers.get('x-ci-user') ?? 'null') as RtUser | null;
    const room = request.headers.get('x-ci-room') ?? '';
    if (!user || !room) return new Response('bad', { status: 400 });
    const isGame = room.startsWith('room:');

    // 같은 유저가 다른 창에서 다시 들어오면 예전 연결을 끊는다
    for (const old of this.ctx.getWebSockets(user.uid)) {
      this.sendTo(old, { t: 'bye', reason: 'replaced' });
      old.close(4001, 'replaced');
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const headers = { 'Sec-WebSocket-Protocol': RT_PROTOCOL };
    const live = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).length;
    if (live >= (isGame ? ROOM_MAX : ZONE_CONN_MAX)) {
      server.accept();
      server.send(JSON.stringify({ t: 'bye', reason: 'full' } satisfies ServerMsg));
      server.close(4002, 'full');
      return new Response(null, { status: 101, webSocket: client, headers });
    }

    const att: Att = { ...user, id: crypto.randomUUID().slice(0, 8), room, x: 0, z: 0, r: 0, a: 0, f: 0, t: 0, w: 0, k: 0, bad: 0, q: 0, p: [], i: 0 };
    this.ctx.acceptWebSocket(server, [user.uid]);
    server.serializeAttachment(att);
    this.sendTo(server, { t: 'hello', id: att.id, room, st: Date.now() });
    if (this.savedToday < 0) this.savedToday = (await this.ctx.storage.get<Usage>(`usage:${day()}`))?.messages ?? 0;
    this.sendMs = this.pickSendMs(live + 1);
    this.sendTo(server, { t: 'cfg', si: this.sendMs });
    this.count('connects');
    this.usage.peak = Math.max(this.usage.peak, live + 1);
    // 방에서는 위치가 오기 전에도 서로 정보를 알 수 있게 바로 한 번 돌린다
    if (isGame) this.schedule();
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > 2048) return;
    this.count('messages');
    const att = ws.deserializeAttachment() as Att;
    const now = Date.now();

    // 너무 많이 보내면 무시하고, 계속되면 끊는다
    const sec = Math.floor(now / 1000);
    if (att.w !== sec) {
      att.w = sec;
      att.k = 0;
    }
    att.k++;
    if (att.k > MAX_MSG_PER_SEC * 3) {
      this.sendTo(ws, { t: 'bye', reason: 'limit' });
      ws.close(4003, 'limit');
      return;
    }
    if (att.k > MAX_MSG_PER_SEC) {
      ws.serializeAttachment(att);
      return;
    }

    let msg: ClientMsg;
    try {
      msg = JSON.parse(message) as ClientMsg;
    } catch {
      return;
    }

    if (msg.t === 'm') {
      const { x, z, r, a } = msg;
      const f = msg.f ?? 0;
      if (![x, z, r, a, f].every(Number.isFinite) || Math.abs(x) > 200_000 || Math.abs(z) > 200_000 || a < 0 || a > 3 || f < 0 || f >= FISH_POSES.length) {
        ws.serializeAttachment(att);
        return;
      }
      // 순간이동이나 비정상 속도는 받지 않는다. 다만 계속 어긋나면(클라이언트가 되돌리지 못하는 경우) 다시 맞춘다
      if (att.t > 0) {
        const dt = Math.max(0.05, (now - att.t) / 1000);
        const dist = Math.hypot(x - att.x, z - att.z) / POS_SCALE;
        if (dist > MAX_SPEED * dt + MAX_JUMP && att.bad < 8) {
          att.bad++;
          ws.serializeAttachment(att);
          this.sendTo(ws, { t: 'fix', x: att.x, z: att.z });
          return;
        }
      }
      // 지난 위치 묶음: 마지막 위치에서 그 시간 안에 갈 수 있는 거리만 받는다 (아니면 버린다)
      let trail: number[] = [];
      const step = typeof msg.i === 'number' ? Math.max(100, Math.min(1000, Math.round(msg.i))) : 0;
      if (Array.isArray(msg.p) && step && msg.p.length % 3 === 0 && msg.p.length <= TRAIL_MAX * 3) {
        const n = msg.p.length / 3;
        let ok = msg.p.every(Number.isFinite);
        for (let k = 0; ok && k < n; k++) {
          const secs = ((n - k) * step) / 1000;
          if (Math.hypot(msg.p[k * 3] - x, msg.p[k * 3 + 1] - z) / POS_SCALE > MAX_SPEED * secs + MAX_JUMP) ok = false;
        }
        if (ok) trail = msg.p.map((v) => Math.round(v));
      }
      att.x = Math.round(x);
      att.z = Math.round(z);
      att.r = Math.round(r);
      att.a = a | 0;
      att.f = f | 0;
      att.t = now;
      att.bad = 0;
      att.q = (att.q + 1) % 1_000_000;
      att.p = trail;
      att.i = trail.length ? step : 0;
      ws.serializeAttachment(att);
      this.schedule();
    } else if (msg.t === 'c' || msg.t === 'e') {
      // 주변 채팅, 이모티콘: 너무 잦으면 버린다. 둘레 NEARBY_RADIUS 안(방이면 방 안 모두)에만 보낸다
      let out: string | null = null;
      if (msg.t === 'c') {
        if (typeof msg.s === 'string' && now - (att.cl ?? 0) >= CHAT_GAP_MS) {
          const text = cleanChat(msg.s, CHAT_MAX);
          if (text) {
            att.cl = now;
            out = JSON.stringify({ t: 'c', from: att.id, s: text } satisfies ServerMsg);
          }
        }
      } else if (Number.isInteger(msg.e) && msg.e >= 0 && msg.e < EMOTES.length && now - (att.el ?? 0) >= EMOTE_GAP_MS) {
        att.el = now;
        out = JSON.stringify({ t: 'e', from: att.id, e: msg.e } satisfies ServerMsg);
      }
      ws.serializeAttachment(att);
      if (out) this.relayNear(ws, att, out);
    } else if (msg.t === 'd') {
      const d = Number.isInteger(msg.d) && msg.d >= 0 && msg.d <= DANCES.length ? msg.d : 0;
      att.d = d;
      ws.serializeAttachment(att);
      this.schedule();
    } else if (msg.t === 'car') {
      // 고양이 자동차. 뒷자리는 그 방에서 운전 중이고 뒷자리가 빈 사람에게만 탈 수 있다
      let c = msg.c === 1 || msg.c === 2 ? msg.c : 0;
      let w: string | undefined;
      if (c === 2) {
        const all = this.ctx.getWebSockets().filter((o) => o !== ws && o.readyState === WebSocket.OPEN).map((o) => o.deserializeAttachment() as Att);
        const drv = typeof msg.w === 'string' ? all.find((o) => o.id === msg.w && o.cr === 1) : undefined;
        const taken = drv && all.some((o) => o.cr === 2 && o.rw === drv.id);
        if (drv && !taken) w = drv.id;
        else c = 0;
      }
      att.cr = c;
      att.rw = w;
      ws.serializeAttachment(att);
      this.sendTo(ws, { t: 'car', c });
      this.schedule();
    } else if (msg.t === 'room') {
      ws.serializeAttachment(att);
      if (!att.room.startsWith('room:')) return;
      const d = JSON.stringify(msg.d ?? null);
      if (d.length > 1024) return;
      const out = JSON.stringify({ t: 'room', from: att.id, d: msg.d } satisfies ServerMsg);
      for (const other of this.ctx.getWebSockets()) if (other !== ws && other.readyState === WebSocket.OPEN) other.send(out);
    }
    await this.flush();
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.forget(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* 이미 닫힘 */
    }
    this.schedule();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.forget(ws);
    this.schedule();
  }

  /** 보낸 사람 둘레 NEARBY_RADIUS 안의 사람에게만 (방이면 방 안 모두) */
  private relayNear(from: WebSocket, att: Att, out: string) {
    const isGame = att.room.startsWith('room:');
    for (const other of this.ctx.getWebSockets()) {
      if (other === from || other.readyState !== WebSocket.OPEN) continue;
      if (!isGame) {
        const o = other.deserializeAttachment() as Att;
        if (!o.t || (o.x - att.x) ** 2 + (o.z - att.z) ** 2 > R * R) continue;
      }
      try {
        other.send(out);
      } catch {
        /* 닫히는 중 */
      }
    }
  }

  private forget(ws: WebSocket) {
    this.known.delete(ws);
    this.lastSig.delete(ws);
  }

  private sendTo(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 닫히는 중 */
    }
  }

  /** 1초에 MOVE_SEND_HZ 번까지만 돌리고, 마지막 움직임은 놓치지 않게 한 번 더 돌린다 */
  private schedule() {
    const now = Date.now();
    const wait = BROADCAST_MS - (now - this.lastBroadcast);
    if (wait <= 0) {
      this.broadcast();
      return;
    }
    if (!this.trailing)
      this.trailing = setTimeout(() => {
        this.trailing = null;
        this.broadcast();
      }, wait);
  }

  private broadcast() {
    this.lastBroadcast = Date.now();
    this.count('broadcasts');
    const sockets = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
    const all = sockets.map((ws) => ({ ws, a: ws.deserializeAttachment() as Att }));
    if (!all.length) return;
    const isGame = all[0].a.room.startsWith('room:');
    // 보내기 간격이 바뀌었으면 모두에게 알린다
    const si = this.pickSendMs(all.length);
    if (si !== this.sendMs) {
      this.sendMs = si;
      const cfg = JSON.stringify({ t: 'cfg', si } satisfies ServerMsg);
      for (const { ws } of all) {
        try {
          ws.send(cfg);
        } catch {
          /* 닫히는 중 */
        }
      }
    }

    // 구역: 격자 칸에 나눠 담고 주변 9칸만 본다
    const grid = new Map<string, typeof all>();
    const cell = (v: number) => Math.floor(v / R);
    if (!isGame)
      for (const e of all) {
        if (!e.a.t) continue;
        const k = `${cell(e.a.x)},${cell(e.a.z)}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(e);
      }

    for (const me of all) {
      let near: Array<{ e: (typeof all)[number]; d: number }> = [];
      if (isGame) {
        near = all.filter((o) => o !== me && o.a.uid !== me.a.uid).map((e) => ({ e, d: 0 }));
      } else {
        if (!me.a.t) continue;
        const cx = cell(me.a.x);
        const cz = cell(me.a.z);
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++)
            for (const o of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
              if (o === me || o.a.uid === me.a.uid) continue;
              const d = (o.a.x - me.a.x) ** 2 + (o.a.z - me.a.z) ** 2;
              if (d <= R * R) near.push({ e: o, d });
            }
        near.sort((p, q) => p.d - q.d);
        near = near.slice(0, NEARBY_MAX);
      }

      let known = this.known.get(me.ws);
      if (!known) this.known.set(me.ws, (known = new Set()));
      const fresh = near.filter(({ e }) => !known.has(e.a.id));
      if (fresh.length) {
        for (const { e } of fresh) known.add(e.a.id);
        this.sendTo(me.ws, { t: 'u', u: fresh.map(({ e }) => ({ id: e.a.id, h: e.a.h, n: e.a.n, c: e.a.c })) });
      }
      const p = near
        .filter(({ e }) => e.a.t > 0 || isGame)
        .map(({ e }): PlayerTuple =>
          e.a.cr
            ? [e.a.id, e.a.x, e.a.z, e.a.r, e.a.a, e.a.f, e.a.q ?? 0, e.a.i ?? 0, e.a.p ?? [], e.a.d ?? 0, e.a.cr, e.a.rw ?? '']
            : [e.a.id, e.a.x, e.a.z, e.a.r, e.a.a, e.a.f, e.a.q ?? 0, e.a.i ?? 0, e.a.p ?? [], e.a.d ?? 0],
        );
      const sig = JSON.stringify(p);
      if (sig === this.lastSig.get(me.ws)) continue;
      this.lastSig.set(me.ws, sig);
      this.sendTo(me.ws, { t: 's', st: Date.now(), p });
    }
  }

  /**
   * 보내기 간격 (ms). 사람이 많을수록, 오늘 이 객체가 메시지를 많이 받았을수록 길게 (무료 하루 요청 10만 건 = 메시지 200만 개).
   * README "동접 500명 계산" 참고.
   */
  private pickSendMs(live: number): number {
    let ms = live <= 30 ? 1000 : live <= 100 ? 1500 : live <= 250 ? 2000 : 2500;
    const today = Math.max(0, this.savedToday) + this.usage.messages;
    if (today > DAY_MSG_SOFT * 1.5) ms *= 2;
    else if (today > DAY_MSG_SOFT) ms *= 1.5;
    return Math.max(SEND_MS_MIN, Math.min(SEND_MS_MAX, Math.round(ms / 250) * 250));
  }

  private count(key: 'messages' | 'connects' | 'broadcasts') {
    const today = day();
    if (this.usage.day !== today) {
      this.usage = { day: today, messages: 0, connects: 0, peak: 0, broadcasts: 0 };
      this.savedToday = 0;
    }
    this.usage[key]++;
  }

  /** 하루 사용량을 1분에 한 번 저장하고 로그로 남긴다 (저장 쓰기 한도 아끼기) */
  private async flush(force = false) {
    if (!force && Date.now() - this.lastFlush < 60_000) return;
    this.lastFlush = Date.now();
    const key = `usage:${this.usage.day}`;
    const saved = (await this.ctx.storage.get<Usage>(key)) ?? { day: this.usage.day, messages: 0, connects: 0, peak: 0, broadcasts: 0 };
    const merged: Usage = {
      day: this.usage.day,
      messages: saved.messages + this.usage.messages,
      connects: saved.connects + this.usage.connects,
      broadcasts: saved.broadcasts + this.usage.broadcasts,
      peak: Math.max(saved.peak, this.usage.peak),
    };
    await this.ctx.storage.put(key, merged);
    this.savedToday = merged.messages;
    console.log(JSON.stringify({ rt_usage: merged, approxRequests: Math.ceil(merged.messages / 20) + merged.connects }));
    this.usage = { day: this.usage.day, messages: 0, connects: 0, peak: 0, broadcasts: 0 };
  }
}
