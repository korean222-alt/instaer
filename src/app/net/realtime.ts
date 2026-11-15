// 실시간: 내 주변 최대 NEARBY_MAX 명의 고양이를 보여 준다.
// - 씬과는 onLocalMove / getLocalState / setRemotePlayers 로만 주고받는다.
// - 걷기 모드에서만 연결한다 (무료 한도 아끼기). 탭이 숨겨지면 보내지 않고, 30초 넘게 숨겨지면 끊는다.
// - 연결이 끊기면 점점 길게 기다리며 다시 붙는다. 계속 실패하면 "혼자 둘러보는 중"(단독 모드)으로 두고 1분마다 다시 해 본다.
// - 구역(섬)을 넘어가면 새 구역에 먼저 붙은 다음 이전 연결을 닫는다 (끊김 없이).
// - 미니게임 방에 들어가면 방 안 사람은 거리와 상관없이 모두 보인다.
import { houseSlot, neighborhoodArea, neighborhoodAt, type IslandScene } from '../../scene';
import {
  ANIMS,
  FISH_POSES,
  SAMPLE_MS,
  SEND_MS_MIN,
  TRAIL_MAX,
  gameRoomName,
  POS_SCALE,
  ROOM_ID_RE,
  ROT_SCALE,
  RT_PROTOCOL,
  zoneRoomName,
  type ClientMsg,
  type ServerMsg,
} from '../../shared/realtime';
import type { CatPattern, FishingPose, LocalState, RemotePlayer } from '../../shared/types';
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
  /** 내 낚시 단계 (다른 유저에게 낚시하는 모습이 보이게). null 이면 낚시 끝 */
  setFishing(pose: FishingPose | null): void;
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
  let hiddenTimer = 0;
  let zoneTimer = 0;
  let latest: LocalState | null = null;
  let lastSent: LocalState | null = null;
  /** 내 낚시 단계 번호 (FISH_POSES), 마지막으로 보낸 값 */
  let fishPose = 0;
  let sentPose = 0;
  let sent = 0;
  let received = 0;
  const info = new Map<string, { handle: string; houseNo: number | null; cat: RemotePlayer['cat'] }>();
  let players: RemotePlayer[] = [];
  /** 서버가 정한 보내기 간격 (ms) */
  let sendMs = SEND_MS_MIN;
  /** 보내려고 찍어 둔 내 위치 (SAMPLE_MS 간격) */
  let trail: Array<[number, number, number]> = [];
  let lastFlush = 0;
  let sampleTimer = 0;
  let playTimer = 0;
  /** 다른 유저마다 받은 위치 묶음 (시각, x, z, r) 과 마지막 순번, 동작, 낚시 */
  interface Track {
    q: number;
    pts: Array<{ t: number; x: number; z: number; r: number }>;
    a: number;
    f: number;
  }
  const tracks = new Map<string, Track>();
  let visibleIds: string[] = [];

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
    // 집 안 ↔ 섬을 옮기는 중이면 이전 방의 위치는 좌표 기준이 달라서 그리지 않는다
    if (msg.t === 's' && c.room !== currentRoomName()) return;
    if (msg.t === 'u') {
      for (const u of msg.u)
        info.set(u.id, {
          handle: u.h,
          houseNo: u.n,
          cat: u.c ? { fur: u.c[0], pattern: u.c[1] as CatPattern, eyeColor: u.c[2] } : null,
        });
    } else if (msg.t === 's') {
      // 받은 위치 묶음을 유저마다 쌓아 두고, 화면에는 sendMs 만큼 늦게 되감아 보여 준다 (playback)
      const now = performance.now();
      visibleIds = [];
      for (const tup of msg.p) {
        const [id, x, z, r, a] = tup;
        const f = (tup[5] as number | undefined) ?? 0;
        const q = (tup[6] as number | undefined) ?? -1;
        const step = (tup[7] as number | undefined) ?? 0;
        const p = (tup[8] as number[] | undefined) ?? [];
        if (!info.has(id)) continue;
        visibleIds.push(id);
        let tr = tracks.get(id);
        if (!tr) tracks.set(id, (tr = { q: -2, pts: [], a, f }));
        tr.a = a;
        tr.f = f;
        if (q === tr.q) continue;
        tr.q = q;
        const n = step ? Math.floor(p.length / 3) : 0;
        // 처음 보는 유저는 지난 묶음 없이 지금 자리에서 시작
        const fresh = tr.pts.length === 0;
        for (let k = 0; k < n && !fresh; k++) tr.pts.push({ t: now - (n - k) * step, x: p[k * 3], z: p[k * 3 + 1], r: p[k * 3 + 2] });
        tr.pts.push({ t: now, x, z, r });
        tr.pts.sort((u, v) => u.t - v.t);
        if (tr.pts.length > 40) tr.pts.splice(0, tr.pts.length - 40);
      }
      for (const id of [...tracks.keys()]) if (!visibleIds.includes(id)) tracks.delete(id);
      playback();
    } else if (msg.t === 'room') {
      hooks.onRoomMessage?.(msg.from, msg.d);
    } else if (msg.t === 'cfg') {
      if (Number.isFinite(msg.si)) sendMs = Math.max(500, Math.min(5000, msg.si));
    } else if (msg.t === 'bye') {
      if (msg.reason === 'full' || msg.reason === 'limit') fails = SOLO_AFTER_FAILS; // 바로 단독 모드
    } else if (msg.t === 'fix') {
      // 서버가 받아들이지 않은 위치(순간이동 등). 내 고양이를 서버가 아는 자리로 되돌린다.
      // 방을 옮기는 중(집 안 ↔ 섬)에는 좌표 기준이 달라서 엉뚱한 곳으로 갈 수 있으니 무시한다.
      if (pending || c.room !== currentRoomName() || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
      scene.setLocalPosition(msg.x / POS_SCALE, msg.z / POS_SCALE);
    }
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
    tracks.clear();
    visibleIds = [];
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

  /** 방을 옮길 때: 이전 방 유저는 좌표 기준이 다를 수 있으니 바로 지운다 */
  function clearPlayers() {
    tracks.clear();
    visibleIds = [];
    if (!players.length) return;
    players = [];
    scene.setRemotePlayers([]);
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

  /** 되감기: 지금보다 (보내기 간격 + 여유) 만큼 앞선 때의 자리를 계산해서 씬에 넘긴다 */
  function playback() {
    const at = performance.now() - (sendMs + 350);
    const list: RemotePlayer[] = [];
    for (const id of visibleIds) {
      const tr = tracks.get(id);
      const meta = info.get(id);
      if (!tr || !meta || !tr.pts.length) continue;
      const pts = tr.pts;
      // 다 지난 점은 하나만 남기고 버린다
      while (pts.length > 2 && pts[1].t < at) pts.shift();
      let x = pts[0].x;
      let z = pts[0].z;
      let r = pts[0].r;
      let moving = false;
      if (pts.length > 1 && at > pts[0].t) {
        const b = pts[1];
        const k = Math.min(1, (at - pts[0].t) / Math.max(1, b.t - pts[0].t));
        x = pts[0].x + (b.x - pts[0].x) * k;
        z = pts[0].z + (b.z - pts[0].z) * k;
        let dr = b.r - pts[0].r;
        const full = Math.PI * 2 * ROT_SCALE;
        dr -= full * Math.round(dr / full);
        r = pts[0].r + dr * k;
        moving = k < 1 && Math.hypot(b.x - pts[0].x, b.z - pts[0].z) > 0.5;
      }
      const last = pts[pts.length - 1];
      const done = at >= last.t;
      const fishing = (tr.f && FISH_POSES[tr.f]) || null;
      list.push({
        id,
        houseNo: meta.houseNo,
        handle: meta.handle,
        x: x / POS_SCALE,
        z: z / POS_SCALE,
        rotY: r / ROT_SCALE,
        anim: fishing ? 'sit' : moving ? 'walk' : done ? (ANIMS[tr.a] ?? 'idle') : 'idle',
        cat: meta.cat,
        fishing,
      });
    }
    players = list;
    scene.setRemotePlayers(players);
  }

  /** SAMPLE_MS 마다 내 위치를 찍어 둔다 (움직이는 동안만) */
  function sample() {
    if (document.visibilityState === 'hidden') return;
    const s = latest ?? scene.getLocalState();
    const cur: [number, number, number] = [Math.round(s.x * POS_SCALE), Math.round(s.z * POS_SCALE), Math.round(s.rotY * ROT_SCALE)];
    const prev = trail[trail.length - 1] ?? (lastSent ? [Math.round(lastSent.x * POS_SCALE), Math.round(lastSent.z * POS_SCALE), Math.round(lastSent.rotY * ROT_SCALE)] : null);
    const moved = !prev || Math.abs(cur[0] - prev[0]) > 0 || Math.abs(cur[1] - prev[1]) > 0 || Math.abs(cur[2] - prev[2]) > 8;
    if (moved || trail.length) trail.push(cur);
    if (trail.length > TRAIL_MAX + 1) trail.shift();
    const animChanged = lastSent !== null && s.anim !== lastSent.anim && (s.anim === 'sit' || lastSent.anim === 'jump');
    if (fishPose !== sentPose || animChanged) sendNow(true);
    else if (trail.length && performance.now() - lastFlush >= sendMs) sendNow();
  }

  /** 찍어 둔 위치를 한 번에 보낸다. force: 움직임이 없어도 지금 상태를 보낸다 */
  function sendNow(force = false) {
    if (document.visibilityState === 'hidden') return;
    const s = latest ?? scene.getLocalState();
    if (!force && !trail.length) return;
    const last: [number, number, number] = [Math.round(s.x * POS_SCALE), Math.round(s.z * POS_SCALE), Math.round(s.rotY * ROT_SCALE)];
    // 마지막 찍은 점이 지금 자리와 같으면 빼고, 그 앞의 점들만 묶음으로 보낸다
    const before = trail.slice(0, -1);
    const ok = send({
      t: 'm',
      x: last[0],
      z: last[1],
      r: last[2],
      a: Math.max(0, ANIMS.indexOf(s.anim)),
      ...(fishPose ? { f: fishPose } : {}),
      ...(before.length ? { p: before.flat(), i: SAMPLE_MS } : {}),
    });
    if (ok) {
      lastSent = { ...s };
      sentPose = fishPose;
      trail = [];
      lastFlush = performance.now();
    }
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
      sampleTimer = window.setInterval(() => {
        sample();
        keepAlive();
      }, SAMPLE_MS);
      playTimer = window.setInterval(() => {
        if (visibleIds.length) playback();
      }, 100);
    },
    stop() {
      running = false;
      clearInterval(sampleTimer);
      clearInterval(playTimer);
      tracks.clear();
      visibleIds = [];
      trail = [];
      clearTimeout(retryTimer);
      clearTimeout(hiddenTimer);
      clearTimeout(zoneTimer);
      conn?.ws.close(1000, 'stop');
      pending?.ws.close(1000, 'stop');
      conn = pending = null;
      players = [];
      fishPose = sentPose = 0;
      scene.setRemotePlayers([]);
      setSolo(false);
    },
    joinRoom(roomId) {
      if (!ROOM_ID_RE.test(roomId)) return;
      gameRoom = roomId;
      clearPlayers();
      if (running) conn ? handoff(gameRoomName(roomId)) : connect();
    },
    leaveRoom() {
      gameRoom = null;
      clearPlayers();
      if (running) conn ? handoff(currentRoomName()) : connect();
    },
    sendRoom(data) {
      if (gameRoom) send({ t: 'room', d: data });
    },
    setFishing(pose) {
      const n = pose ? Math.max(0, FISH_POSES.indexOf(pose)) : 0;
      if (n === fishPose) return;
      fishPose = n;
      if (running) sendNow(true);
    },
    debug() {
      return { room: conn?.room ?? null, open: !!conn?.open, solo, players: players.length, sent, received };
    },
  };
}

/** 내 집이 있는 구역 (처음 접속할 구역을 정할 때 참고) */
export const zoneOfHouse = (houseNo: number) => houseSlot(houseNo).zone;
