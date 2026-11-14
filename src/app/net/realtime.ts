// 실시간: 내 주변 최대 NEARBY_MAX 명의 고양이를 보여 준다.
// - 씬과는 onLocalMove / getLocalState / setRemotePlayers 로만 주고받는다.
// - 걷기 모드에서만 연결한다 (무료 한도 아끼기). 탭이 숨겨지면 보내지 않고, 30초 넘게 숨겨지면 끊는다.
// - 연결이 끊기면 점점 길게 기다리며 다시 붙는다. 계속 실패하면 "혼자 둘러보는 중"(단독 모드)으로 두고 1분마다 다시 해 본다.
// - 구역(섬)을 넘어가면 새 구역에 먼저 붙은 다음 이전 연결을 닫는다 (끊김 없이).
// - 미니게임 방에 들어가면 방 안 사람은 거리와 상관없이 모두 보인다.
import { houseSlot, neighborhoodArea, neighborhoodAt, type IslandScene } from '../../scene';
import { MOVE_SEND_HZ } from '../../shared/config';
import {
  ANIMS,
  gameRoomName,
  POS_SCALE,
  ROOM_ID_RE,
  ROT_SCALE,
  RT_PROTOCOL,
  zoneRoomName,
  type ClientMsg,
  type ServerMsg,
} from '../../shared/realtime';
import type { CatPattern, LocalState, RemotePlayer } from '../../shared/types';
import { loadToken } from './api';

export interface RealtimeHooks {
  /** 단독 모드로 바뀌거나 돌아왔을 때 */
  onSolo?(solo: boolean): void;
  /** 방 안 메시지 */
  onRoomMessage?(from: string, data: unknown): void;
  /** 내 고양이가 움직일 때 (씬은 onLocalMove 를 하나만 받으므로 여기서 나눠 준다) */
  onLocalMove?(s: LocalState): void;
}

export interface Realtime {
  start(): void;
  stop(): void;
  joinRoom(roomId: string): void;
  leaveRoom(): void;
  sendRoom(data: unknown): void;
  /** 확인용 */
  debug(): { room: string | null; open: boolean; solo: boolean; players: number; sent: number; received: number };
}

interface Conn {
  ws: WebSocket;
  room: string;
  open: boolean;
}

const HIDDEN_CLOSE_MS = 30_000;
const SOLO_AFTER_FAILS = 4;
const SOLO_RETRY_MS = 60_000;

function zoneOf(x: number, z: number): number | null {
  const n = neighborhoodAt(x, z);
  return n < 0 ? null : neighborhoodArea(n).zone;
}

export function createRealtime(scene: IslandScene, hooks: RealtimeHooks = {}): Realtime {
  let running = false;
  let conn: Conn | null = null;
  /** 구역을 넘어갈 때 새로 붙는 중인 연결 */
  let pending: Conn | null = null;
  let gameRoom: string | null = null;
  let fails = 0;
  let solo = false;
  let retryTimer = 0;
  let sendTimer = 0;
  let hiddenTimer = 0;
  let zoneTimer = 0;
  let latest: LocalState | null = null;
  let lastSent: LocalState | null = null;
  let sent = 0;
  let received = 0;
  const info = new Map<string, { handle: string; houseNo: number | null; cat: RemotePlayer['cat'] }>();
  let players: RemotePlayer[] = [];

  const setSolo = (v: boolean) => {
    if (solo === v) return;
    solo = v;
    hooks.onSolo?.(v);
  };

  scene.onLocalMove((s) => {
    hooks.onLocalMove?.(s);
    latest = s;
    if (!running || gameRoom) return;
    // 구역이 바뀌었으면 잠깐(0.6초) 그대로인지 보고 옮긴다
    const z = zoneOf(s.x, s.z);
    const cur = conn ? Number(conn.room.split(':')[1]) : null;
    if (z !== null && cur !== null && z !== cur && !pending) {
      clearTimeout(zoneTimer);
      zoneTimer = window.setTimeout(() => {
        const st = latest && zoneOf(latest.x, latest.z);
        if (running && !gameRoom && st === z) handoff(zoneRoomName(z));
      }, 600);
    }
  });

  function currentRoomName(): string {
    if (gameRoom) return gameRoomName(gameRoom);
    const s = latest ?? scene.getLocalState();
    const z = zoneOf(s.x, s.z);
    if (z !== null) return zoneRoomName(z);
    // 바다/다리 위면 내 집 구역
    return zoneRoomName(0);
  }

  function url(room: string): string {
    const [kind, id] = room.split(':');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/api/rt/${kind}/${encodeURIComponent(id)}`;
  }

  function open(room: string): Conn {
    // 토큰은 주소가 아니라 하위 프로토콜에 실어 보낸다 (주소 로그에 남지 않게)
    const token = loadToken();
    const protocols = [RT_PROTOCOL, ...(token ? [`tok.${token}`] : [])];
    const ws = new WebSocket(url(room), protocols);
    const c: Conn = { ws, room, open: false };
    ws.onopen = () => {
      c.open = true;
    };
    ws.onmessage = (ev) => onMessage(c, ev.data);
    ws.onclose = () => onClose(c);
    ws.onerror = () => {
      /* onclose 에서 처리 */
    };
    return c;
  }

  function connect() {
    clearTimeout(retryTimer);
    if (!running || document.visibilityState === 'hidden') return;
    conn = open(currentRoomName());
  }

  function handoff(room: string) {
    if (!conn || conn.room === room) return;
    pending?.ws.close();
    pending = open(room);
  }

  function onMessage(c: Conn, data: unknown) {
    if (typeof data !== 'string' || data === 'pong') return;
    received++;
    let msg: ServerMsg;
    try {
      msg = JSON.parse(data) as ServerMsg;
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      fails = 0;
      setSolo(false);
      if (c === pending) {
        // 새 구역에 붙었으니 이전 연결을 닫는다
        const old = conn;
        conn = pending;
        pending = null;
        old?.ws.close(1000, 'moved');
      }
      sendNow(true);
      return;
    }
    if (c !== conn) return; // 옮기는 중인 연결의 위치는 아직 쓰지 않는다
    if (msg.t === 'u') {
      for (const u of msg.u)
        info.set(u.id, {
          handle: u.h,
          houseNo: u.n,
          cat: u.c ? { fur: u.c[0], pattern: u.c[1] as CatPattern, eyeColor: u.c[2] } : null,
        });
    } else if (msg.t === 's') {
      players = [];
      for (const [id, x, z, r, a] of msg.p) {
        const meta = info.get(id);
        if (!meta) continue;
        players.push({ id, houseNo: meta.houseNo, handle: meta.handle, x: x / POS_SCALE, z: z / POS_SCALE, rotY: r / ROT_SCALE, anim: ANIMS[a] ?? 'idle', cat: meta.cat });
      }
      scene.setRemotePlayers(players);
    } else if (msg.t === 'room') {
      hooks.onRoomMessage?.(msg.from, msg.d);
    } else if (msg.t === 'bye') {
      if (msg.reason === 'full' || msg.reason === 'limit') fails = SOLO_AFTER_FAILS; // 바로 단독 모드
    }
    // 'fix' 는 지금은 무시한다: 씬에 위치를 되돌리는 공개 함수가 없다. 서버는 그 위치를 다른 유저에게 보내지 않는다.
  }

  function onClose(c: Conn) {
    if (c === pending) {
      pending = null;
      return;
    }
    if (c !== conn) return;
    const wasOpen = c.open;
    conn = null;
    players = [];
    scene.setRemotePlayers([]);
    if (!running) return;
    if (!wasOpen) fails++;
    else fails = Math.max(0, fails - 1);
    if (fails >= SOLO_AFTER_FAILS) {
      setSolo(true);
      retryTimer = window.setTimeout(connect, SOLO_RETRY_MS);
      return;
    }
    // 1초, 2초, 4초 ... 최대 30초 (+ 조금씩 흩어서 한꺼번에 몰리지 않게)
    const delay = Math.min(30_000, 1000 * 2 ** fails) * (0.8 + Math.random() * 0.4);
    retryTimer = window.setTimeout(connect, delay);
  }

  let lastWire = 0;
  function send(msg: ClientMsg): boolean {
    if (!conn?.open || conn.ws.readyState !== WebSocket.OPEN) return false;
    conn.ws.send(JSON.stringify(msg));
    sent++;
    lastWire = Date.now();
    return true;
  }

  /** 가만히 서 있어도 연결이 끊기지 않게 25초마다 짧은 신호 (서버가 자동으로 'pong' 답장) */
  function keepAlive() {
    if (conn?.open && conn.ws.readyState === WebSocket.OPEN && Date.now() - lastWire > 25_000) {
      conn.ws.send('ping');
      lastWire = Date.now();
    }
  }

  /** 움직임이 있을 때만 보낸다 */
  function sendNow(force = false) {
    if (document.visibilityState === 'hidden') return;
    const s = latest ?? scene.getLocalState();
    if (!force && lastSent) {
      const moved = Math.abs(s.x - lastSent.x) > 0.05 || Math.abs(s.z - lastSent.z) > 0.05;
      const turned = Math.abs(s.rotY - lastSent.rotY) > 0.08;
      if (!moved && !turned && s.anim === lastSent.anim) return;
    }
    const ok = send({ t: 'm', x: Math.round(s.x * POS_SCALE), z: Math.round(s.z * POS_SCALE), r: Math.round(s.rotY * ROT_SCALE), a: Math.max(0, ANIMS.indexOf(s.anim)) });
    if (ok) lastSent = { ...s };
  }

  function onVisibility() {
    if (!running) return;
    if (document.visibilityState === 'hidden') {
      hiddenTimer = window.setTimeout(() => {
        conn?.ws.close(1000, 'hidden');
        pending?.ws.close(1000, 'hidden');
      }, HIDDEN_CLOSE_MS);
    } else {
      clearTimeout(hiddenTimer);
      if (!conn) {
        fails = 0;
        connect();
      }
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    start() {
      if (running) return;
      running = true;
      fails = 0;
      latest = scene.getLocalState();
      lastSent = null;
      connect();
      sendTimer = window.setInterval(() => {
        sendNow();
        keepAlive();
      }, Math.round(1000 / MOVE_SEND_HZ));
    },
    stop() {
      running = false;
      clearInterval(sendTimer);
      clearTimeout(retryTimer);
      clearTimeout(hiddenTimer);
      clearTimeout(zoneTimer);
      conn?.ws.close(1000, 'stop');
      pending?.ws.close(1000, 'stop');
      conn = pending = null;
      players = [];
      scene.setRemotePlayers([]);
      setSolo(false);
    },
    joinRoom(roomId) {
      if (!ROOM_ID_RE.test(roomId)) return;
      gameRoom = roomId;
      if (running) conn ? handoff(gameRoomName(roomId)) : connect();
    },
    leaveRoom() {
      gameRoom = null;
      if (running) conn ? handoff(currentRoomName()) : connect();
    },
    sendRoom(data) {
      if (gameRoom) send({ t: 'room', d: data });
    },
    debug() {
      return { room: conn?.room ?? null, open: !!conn?.open, solo, players: players.length, sent, received };
    },
  };
}

/** 내 집이 있는 구역 (처음 접속할 구역을 정할 때 참고) */
export const zoneOfHouse = (houseNo: number) => houseSlot(houseNo).zone;
