// 걷기 모드에서 할 수 있는 것: 집 구경, 집 안 들어가기, 주민 집 들어가기, 주민에게 말 걸기,
// 연못과 항구 부두에서 낚시, 동굴 탐험(광석 캐기, 더 깊이).
// 씬과는 공개 함수(setWalkMode, onNearHouse, onDoor, enterHouse, enterNpcHome, enterCave, setCaveNodes,
// exitHouse, exitCave, onExitHouse, onExitCave, setRemotePlayers, setNpcs, onNpcTap, getLocalState, fishingSpotAt)로만 주고받는다.
import { CAVE_DEEPER, caveMouths, fishingSpotAt, mailboxPos, townSquares, type CaveNode, type IslandScene } from '../../scene';
import { CAVE_LEVELS, CAVE_NODES, oreDef, rollOre, unreadMail, type FishWhere } from '../../shared/economy';
import { hasItem } from '../wallet';
import type { HouseDecor, InteriorItem, RemotePlayer } from '../../shared/types';
import { pinDrawings, setArtCenter, surfaceDrawing } from '../art';
import { play } from '../audio/sound';
import { ApiError, fetchDecor, reportMine, reportVisit } from '../net/api';
import type { Realtime } from '../net/realtime';
import { go } from '../router';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet } from '../wallet';
import { toSceneNpc, townHomes, townNpcs, type Home, type Npc } from './npcs';
import { wanderers } from './wanderers';

export interface ExploreHooks {
  onWalking(on: boolean): void;
  onInside(houseNo: number | null): void;
  /** 주민에게 말 걸기 */
  talk(npc: Npc): void;
  /** 낚시하기 (연못이면 'pond', 항구 부두면 'sea') */
  fish(where: FishWhere): void;
  icon(name: string): string;
}

export interface Explore {
  walking(): boolean;
  /** 들어가 있는 집 번지 (주민 집이면 -(id+1)) */
  inside(): number | null;
  /** 동굴 깊이 (동굴 밖이면 0) */
  caveLevel(): number;
  /** 들어가 있는 집의 꾸미기 (주민 집이면 미리 정한 방) */
  insideDecor(): HouseDecor | null;
  setInsideDecor(d: HouseDecor): void;
  setWalking(on: boolean): void;
  enter(houseNo: number): Promise<void>;
  enterHome(homeId: number): void;
  exit(): void;
  /** 내 집 안으로 (걷기를 켜고 내 집 문 앞에서 들어간다) */
  goInsideMine(): Promise<boolean>;
  /** 실시간이 받은 다른 유저 목록 */
  setNetPlayers(players: RemotePlayer[]): void;
  /** 지금 서 있는 곳의 낚시터 (없으면 null) */
  fishSpot(): FishWhere | null;
  /** 버튼 다시 그리기 (판이 열리고 닫힐 때 등) */
  refresh(): void;
  /** 고양이 자동차: 지금 타는 모습 (null 이면 걷는 중) */
  riding(): 'drive' | 'passenger' | null;
  /** 서버가 자동차 상태를 받아들인 결과 (뒷자리에 못 타면 0) */
  carAck(c: number): void;
}

/** 주민 집 안 (집마다 정해진 모양) */
function homeRoom(homeId: number): HouseDecor {
  const presets: Array<{ wallpaper: string; floor: string; room: Array<Omit<InteriorItem, 'id'>> }> = [
    {
      wallpaper: 'stripe',
      floor: 'wood',
      room: [
        { type: 'bed', x: -3.1, z: -2.8, rotY: 0 },
        { type: 'rug', x: 0, z: 0.4, rotY: 0 },
        { type: 'table', x: 0, z: 0.4, rotY: 0 },
        { type: 'chair', x: 1.1, z: 0.5, rotY: -Math.PI / 2 },
        { type: 'plant', x: 3.3, z: -3.4, rotY: 0 },
        { type: 'window', x: 1.2, z: -4, rotY: 0 },
        { type: 'frame', x: -4, z: 0.2, rotY: Math.PI / 2 },
      ],
    },
    {
      wallpaper: 'dots',
      floor: 'tile',
      room: [
        { type: 'sofa', x: -3.4, z: 0.6, rotY: Math.PI / 2 },
        { type: 'bookshelf', x: -1.2, z: -3.7, rotY: 0 },
        { type: 'floor_lamp', x: 3.4, z: -3.4, rotY: 0 },
        { type: 'cushion', x: 0.4, z: 0.8, rotY: 0 },
        { type: 'cat_tower', x: 3.1, z: 1.4, rotY: -0.4 },
        { type: 'frame', x: 1.6, z: -4, rotY: 0 },
      ],
    },
    {
      wallpaper: 'cream',
      floor: 'carpet',
      room: [
        { type: 'bed', x: 3.1, z: -2.8, rotY: 0 },
        { type: 'fish_rack', x: -2.8, z: -3.5, rotY: 0 },
        { type: 'table', x: -1.2, z: 0.6, rotY: 0.3 },
        { type: 'lantern', x: -3.4, z: 2.6, rotY: 0 },
        { type: 'plant', x: -3.4, z: -1.2, rotY: 0 },
        { type: 'window', x: -4, z: -1.8, rotY: Math.PI / 2 },
      ],
    },
  ];
  const p = presets[homeId % presets.length];
  return { houseNo: -homeId - 1, wallpaper: p.wallpaper, floor: p.floor, roofArt: null, yard: [], room: p.room.map((it, i) => ({ ...it, id: `r${i}` })) };
}

/** 동굴 한 방의 광석 바위 (들어갈 때마다 자리와 종류가 바뀐다) */
interface Ore extends CaveNode {
  ore: string;
}
function caveOres(level: number): Ore[] {
  const out: Ore[] = [];
  let tries = 0;
  while (out.length < CAVE_NODES + level - 1 && tries++ < 200) {
    const x = (Math.random() - 0.5) * 11;
    const z = -8 + Math.random() * 12;
    if (Math.abs(x) < 1.4 && z > -7.5) continue; // 가운데 길은 비운다
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 2.2)) continue;
    const ore = rollOre(level);
    const def = oreDef(ore)!;
    const size = def.rarity === 'legend' ? 1.35 : def.rarity === 'rare' ? 1.15 : def.rarity === 'junk' ? 0.8 : 1;
    out.push({ id: `o${out.length}-${Math.floor(Math.random() * 1e6)}`, x, z, color: def.color, size, ore });
  }
  return out;
}

/** 캐기 버튼을 이만큼 꾹 누르고 있으면 캐진다 (ms). 2026-11-16 사용자: 세 번 누르기 → 꾹 누르기 */
const HOLD_MS = 1100;
/** 이 안이면 우편함 열기, 남의 차 뒷자리 타기 */
const MAIL_REACH = 1.9;
const RIDE_REACH = 2.8;

export function createExplore(scene: IslandScene, realtime: Realtime, hooks: ExploreHooks): Explore {
  let walking = false;
  /** 들어가 있는 집 (주민 집이면 -(id+1)) */
  let inside: number | null = null;
  let decor: HouseDecor | null = null;
  let doorNo: number | null = null;
  let nearNo: number | null = null;
  let nearNpc: Npc | null = null;
  let nearHome: Home | null = null;
  let nearCave = false;
  /** 마을 게시판 앞 */
  let nearBoard = false;
  /** 동굴 깊이 (0 = 밖) */
  let cave = 0;
  let ores: Ore[] = [];
  let nearOre: Ore | null = null;
  let nearDeeper = false;
  /** 캐기 버튼을 누르기 시작한 시각 (0 = 안 누름) */
  let holdAt = 0;
  let holdRaf = 0;
  /** 내 우편함 앞 */
  let nearMail = false;
  /** 고양이 자동차 */
  let riding: 'drive' | 'passenger' | null = null;
  let rideId: string | null = null;
  /** 가까이 있는, 뒷자리가 빈 남의 차 */
  let nearDriver: RemotePlayer | null = null;
  let mined: Array<{ id: string; level: number }> = [];
  /** 서 있는 곳의 낚시터 */
  let nearFish: FishWhere | null = null;
  let net: RemotePlayer[] = [];
  let shownNpcs: Npc[] = [];
  let tick = 0;

  const app = document.getElementById('app')!;
  const bar = document.createElement('div');
  bar.className = 'actions';
  app.appendChild(bar);
  const insideBar = document.createElement('div');
  insideBar.className = 'inside-bar';
  insideBar.hidden = true;
  app.appendChild(insideBar);

  const carBtn = document.createElement('button');
  carBtn.className = 'car-btn';
  carBtn.hidden = true;
  carBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15.5V12l2-4.5h9l2.5 4.5H20v3.5z"/><path d="M6.5 7.5 6 4.5l2.5 2M13.5 7.5l.5-3-2.5 2"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/></svg><span>타기</span>`;
  app.appendChild(carBtn);
  carBtn.addEventListener('click', () => {
    play('tap');
    setCar(riding === 'drive' ? null : 'drive');
  });

  /** 자동차 타고 내리기. passenger 면 driver 의 뒷자리 */
  function setCar(mode: 'drive' | 'passenger' | null, driver?: string) {
    if (mode === riding && (mode !== 'passenger' || driver === rideId)) return;
    const wasPassenger = riding === 'passenger';
    riding = mode;
    rideId = mode === 'passenger' ? (driver ?? null) : null;
    scene.setRiding(mode, rideId ?? undefined);
    realtime.setCar(mode === 'drive' ? 1 : mode === 'passenger' ? 2 : 0, rideId ?? undefined);
    if (wasPassenger && !mode) {
      // 차 옆으로 내린다
      const me = scene.getLocalState();
      scene.setLocalPosition(me.x + Math.cos(me.rotY) * 1.1, me.z - Math.sin(me.rotY) * 1.1, me.rotY);
    }
    if (mode === 'drive') toast('부릉! 고양이 자동차를 탔어요. 뒤에 한 명 더 탈 수 있어요', 2200);
    play(mode ? 'open' : 'close');
    draw();
  }

  const pushPlayers = () => scene.setRemotePlayers(net);
  const pushNpcs = () => scene.setNpcs(shownNpcs.map(toSceneNpc));

  /** force: 집 안팎을 오갈 때 (씬이 주민을 모두 지우므로 목록이 같아도 다시 넘긴다) */
  function updateNpcs(force = false) {
    if (!walking) {
      if (shownNpcs.length) {
        shownNpcs = [];
        pushNpcs();
      }
      return;
    }
    const me = scene.getLocalState();
    let list: Npc[];
    if (cave) list = [];
    else if (inside !== null) list = [];
    else
      list = [...townNpcs(state.unlockedZones), ...wanderers(me)]
        .map((n) => ({ n, d: Math.hypot(n.x - me.x, n.z - me.z) }))
        .filter((e) => e.d < 45)
        .sort((a, b) => a.d - b.d)
        .slice(0, 8)
        .map((e) => e.n);
    const changed = list.length !== shownNpcs.length || list.some((n, i) => shownNpcs[i]?.id !== n.id);
    shownNpcs = list;
    // 산책냥은 자리가 계속 바뀌므로 보이는 동안 매번 넘긴다
    if (changed || force || list.some((n) => n.moving !== undefined)) pushNpcs();

    // 가까운 주민, 주민 집 문, 동굴 입구, 낚시터, 광석
    let best: Npc | null = null;
    let bestD = 2.6;
    for (const n of list) {
      const d = Math.hypot(n.x - me.x, n.z - me.z);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    let home: Home | null = null;
    let caveHere = false;
    if (inside === null && !cave) {
      for (const h of townHomes(state.unlockedZones)) if (Math.hypot(h.door.x - me.x, h.door.z - me.z) < 1.7) home = h;
      caveHere = caveMouths(state.unlockedZones).some((m) => Math.hypot(m.x - me.x, m.z - me.z) < 2.6);
    }
    const boardHere =
      inside === null && !cave && townSquares(state.unlockedZones).some((q) => Math.abs(me.x - q.board.x) < 2.6 && me.z - q.board.z > 0 && me.z - q.board.z < 3.4);
    let ore: Ore | null = null;
    let deeper = false;
    if (cave) {
      const id = scene.caveNodeNear(1.15);
      ore = id ? (ores.find((o) => o.id === id) ?? null) : null;
      deeper = cave < CAVE_LEVELS && Math.hypot(CAVE_DEEPER.x - me.x, CAVE_DEEPER.z - me.z) < 1.9;
    }
    // 우편함, 남의 차 뒷자리
    let mailHere = false;
    let driver: RemotePlayer | null = null;
    if (inside === null && !cave && state.me) {
      const mb = mailboxPos(state.me.houseNo);
      mailHere = Math.hypot(mb.x - me.x, mb.z - me.z) < MAIL_REACH;
    }
    if (inside === null && !cave && !riding && state.me) {
      let bd = RIDE_REACH;
      for (const p of net) {
        if (p.car !== 'drive' || net.some((o) => o.car === 'ride' && o.rideWith === p.id)) continue;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < bd) {
          bd = d;
          driver = p;
        }
      }
    }
    if (riding === 'passenger' && rideId && !net.some((p) => p.id === rideId && p.car === 'drive')) {
      toast('운전하던 고양이가 차에서 내렸어요');
      setCar(null);
    }
    if (mailHere !== nearMail || driver?.id !== nearDriver?.id) {
      if ((mailHere && !nearMail) || (driver && !nearDriver)) play('ding');
      nearMail = mailHere;
      nearDriver = driver;
      draw();
    }
    const spot = inside === null && !cave ? fishingSpotAt(me.x, me.z) : null;
    const fishHere: FishWhere | null = spot ? (spot.kind === 'pier' ? 'sea' : 'pond') : null;
    if (best?.id !== nearNpc?.id || fishHere !== nearFish || home?.id !== nearHome?.id || caveHere !== nearCave || ore?.id !== nearOre?.id || deeper !== nearDeeper || boardHere !== nearBoard) {
      if ((best && !nearNpc) || (fishHere && !nearFish) || (home && !nearHome) || (caveHere && !nearCave) || (ore && !nearOre)) play('ding');
      if (ore?.id !== nearOre?.id) stopHold();
      nearNpc = best;
      nearFish = fishHere;
      nearHome = home;
      nearCave = caveHere;
      nearOre = ore;
      nearDeeper = deeper;
      nearBoard = boardHere;
      draw();
    }
    if (inside === null && !cave) setArtCenter(me.x, me.z);
  }

  function draw() {
    const sheetOpen = document.getElementById('sheet')?.classList.contains('open');
    const btns: string[] = [];
    if (walking && !sheetOpen && !document.body.classList.contains('playing')) {
      if (riding === 'passenger') btns.push(`<button class="act-btn primary" data-act="getoff">${hooks.icon('close')}<span>차에서 내리기</span></button>`);
      if (nearOre) btns.push(`<button class="act-btn primary hold" data-act="mine"><i class="hold-fill"></i>${hooks.icon('pick')}<span>꾹 눌러 캐기</span></button>`);
      if (nearDriver && !riding) btns.push(`<button class="act-btn primary" data-act="ride">${hooks.icon('cat')}<span>${esc(nearDriver.handle)} 차 뒷자리 타기</span></button>`);
      if (nearMail && !riding) {
        const n = state.wallet ? unreadMail(state.wallet.data) : 0;
        btns.push(`<button class="act-btn${n ? ' primary' : ''}" data-act="mail">${hooks.icon('mail')}<span>우편함 열기${n ? ` (${n})` : ''}</span></button>`);
      }
      if (nearDeeper) btns.push(`<button class="act-btn" data-act="deeper">${hooks.icon('door')}<span>더 깊이 들어가기 (${cave + 1}층)</span></button>`);
      if (nearNpc) btns.push(`<button class="act-btn primary" data-act="talk">${hooks.icon('chat')}<span>${esc(nearNpc.name)}에게 말 걸기</span></button>`);
      if (nearFish && !nearNpc) btns.push(`<button class="act-btn primary" data-act="fish">${hooks.icon('fish')}<span>${nearFish === 'sea' ? '바다 낚시하기' : '낚시하기'}</span></button>`);
      if (nearBoard && !nearNpc) btns.push(`<button class="act-btn primary" data-act="board">${hooks.icon('board')}<span>마을 게시판 보기</span></button>`);
      if (nearCave) btns.push(`<button class="act-btn primary" data-act="cave">${hooks.icon('door')}<span>동굴 들어가기</span></button>`);
      if (nearHome) btns.push(`<button class="act-btn" data-act="home">${hooks.icon('door')}<span>${esc(nearHome.label)} 들어가기</span></button>`);
      if (inside === null && !cave && doorNo !== null && state.houses.has(doorNo)) {
        const h = state.houses.get(doorNo);
        const label = state.me?.houseNo === doorNo ? '내 집 들어가기' : `${h?.igHandle ?? ''} 집 들어가기`;
        btns.push(`<button class="act-btn" data-act="enter">${hooks.icon('door')}<span>${esc(label)}</span></button>`);
      } else if (inside === null && !cave && nearNo !== null) {
        const h = state.houses.get(nearNo);
        btns.push(`<button class="act-btn" data-act="look">${hooks.icon('eye')}<span>${esc(h?.igHandle ? `${h.igHandle} 집 구경하기` : '빈 집 보기')}</span></button>`);
      }
    }
    bar.innerHTML = btns.slice(0, 2).join('');
    carBtn.hidden = !(walking && inside === null && !cave && state.me && hasItem('cat_car') && riding !== 'passenger' && !sheetOpen);
    carBtn.classList.toggle('on', riding === 'drive');
    carBtn.querySelector('span')!.textContent = riding === 'drive' ? '내리기' : '자동차';

    const roomish = inside !== null || cave > 0;
    insideBar.hidden = !roomish || !!sheetOpen || document.body.classList.contains('decorating') || document.body.classList.contains('playing');
    if (cave) {
      insideBar.innerHTML = `
        <span class="pill">동굴 ${cave}층 · 광석 ${ores.length}개</span>
        <button class="pill btn-pill" data-act="exit">${hooks.icon('door')}<span>나가기</span></button>`;
    } else if (inside !== null) {
      const mine = state.me?.houseNo === inside;
      const h = inside > 0 ? state.houses.get(inside) : null;
      const home = inside < 0 ? townHomes(state.unlockedZones).find((x) => x.id === -inside! - 1) : null;
      const who = mine ? '내 집' : home ? home.label : `${h?.igHandle ?? ''} 집`;
      insideBar.innerHTML = `
        <span class="pill">${esc(who)} 안</span>
        ${mine ? `<button class="pill btn-pill" data-act="decorate">${hooks.icon('decorate')}<span>집 안 꾸미기</span></button>` : ''}
        <button class="pill btn-pill" data-act="exit">${hooks.icon('door')}<span>나가기</span></button>`;
    }
  }

  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'talk' && nearNpc) {
      play('meow');
      hooks.talk(nearNpc);
    } else if (act === 'fish' && nearFish) {
      setCar(null);
      hooks.fish(nearFish);
    }
    else if (act === 'enter' && doorNo !== null) void api.enter(doorNo);
    else if (act === 'home' && nearHome) api.enterHome(nearHome.id);
    else if (act === 'cave') enterCave(1);
    else if (act === 'board') go('board');
    else if (act === 'deeper' && cave < CAVE_LEVELS) enterCave(cave + 1);
    else if (act === 'mail') go('mail');
    else if (act === 'ride' && nearDriver) setCar('passenger', nearDriver.id);
    else if (act === 'getoff') setCar(null);
    else if (act === 'look' && nearNo !== null) go('house', nearNo);
    else if (act === 'exit') api.exit();
    else if (act === 'decorate') go('decorate', 'room');
  };
  bar.addEventListener('click', onClick);
  // 캐기: 버튼을 꾹 누르고 있으면 채워지고, 다 차면 캐진다. 손을 떼면 처음부터
  bar.addEventListener('pointerdown', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act="mine"]');
    if (!t || !nearOre) return;
    e.preventDefault();
    stopHold();
    holdAt = performance.now();
    play('tap');
    const step = () => {
      if (!holdAt) return;
      const k = Math.min(1, (performance.now() - holdAt) / HOLD_MS);
      const fill = bar.querySelector<HTMLElement>('.hold-fill');
      if (fill) fill.style.width = `${k * 100}%`;
      if (k >= 1) {
        stopHold();
        mineHit();
        return;
      }
      holdRaf = requestAnimationFrame(step);
    };
    holdRaf = requestAnimationFrame(step);
  });
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => holdAt && stopHold());
  bar.addEventListener('contextmenu', (e) => e.preventDefault());
  insideBar.addEventListener('click', onClick);

  function stopHold() {
    holdAt = 0;
    cancelAnimationFrame(holdRaf);
    const fill = bar.querySelector<HTMLElement>('.hold-fill');
    if (fill) fill.style.width = '0';
  }

  // ── 동굴 ──
  function enterCave(level: number) {
    if (!walking) api.setWalking(true);
    if (inside !== null) api.exit();
    const first = cave === 0;
    cave = level;
    ores = caveOres(level);
    nearOre = null;
    stopHold();
    setCar(null);
    scene.enterCave(level, ores);
    play('open');
    realtime.joinRoom(`cave-${level}`);
    if (first) {
      toast(level === 1 ? '동굴에 들어왔어요. 반짝이는 바위 옆에서 "캐기"를 꾹 누르고 있어요!' : `${level}층: 더 귀한 광석이 있어요`, 2400);
    } else toast(`${level}층: 더 귀한 광석이 있어요`, 2000);
    hooks.onInside(null);
    updateNpcs(true);
    draw();
  }

  function mineHit() {
    const o = nearOre;
    if (!o) return;
    play('place');
    ores = ores.filter((x) => x.id !== o.id);
    scene.setCaveNodes(ores);
    nearOre = null;
    const def = oreDef(o.ore)!;
    play(def.rarity === 'rare' || def.rarity === 'legend' ? 'fanfare' : 'save');
    toast(`${def.label} 획득!${state.me ? ' 가방에 넣었어요' : ' (입주하면 가방에 모여요)'}`, 1800);
    if (state.me) {
      mined.push({ id: o.ore, level: cave });
      if (mined.length >= 6) void flushMine();
    }
    draw();
  }

  async function flushMine() {
    if (!mined.length || !state.me) return;
    const list = mined.splice(0, mined.length);
    try {
      const res = await reportMine(list);
      applyWallet(res.wallet, { silent: true });
      if (res.full) toast('가방이 가득 찼어요. 잡화점에 팔아 주세요', 2600);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '광석을 알리지 못했어요');
    }
  }

  function leftCave() {
    if (!cave) return;
    cave = 0;
    ores = [];
    nearOre = null;
    nearDeeper = false;
    realtime.leaveRoom();
    void flushMine();
    hooks.onInside(null);
    updateNpcs(true);
    draw();
  }

  scene.onNearHouse((no) => {
    if (no !== null && nearNo === null && walking && inside === null) play('ding');
    nearNo = no;
    draw();
  });
  scene.onDoor((no) => {
    doorNo = no;
    draw();
  });
  scene.onExitHouse(() => leftHouse());
  scene.onExitCave(() => leftCave());
  // 주민을 누르면 바로 말 걸기 (가까이 가지 않아도 된다)
  scene.onNpcTap((id) => {
    const npc = shownNpcs.find((n) => n.id === id);
    if (!npc || !walking || document.body.classList.contains('playing') || document.body.classList.contains('decorating')) return;
    play('meow');
    hooks.talk(npc);
  });

  function leftHouse() {
    if (inside === null) return;
    inside = null;
    decor = null;
    nearNpc = null;
    realtime.leaveRoom();
    pinDrawings([]);
    hooks.onInside(null);
    updateNpcs(true);
    draw();
  }

  function pinFor(d: HouseDecor) {
    pinDrawings([...d.room.map((i) => i.drawingId), surfaceDrawing(d.wallpaper), surfaceDrawing(d.floor)]);
  }

  const api: Explore = {
    walking: () => walking,
    inside: () => inside,
    caveLevel: () => cave,
    insideDecor: () => decor,
    setInsideDecor(d) {
      if (inside !== d.houseNo) return;
      decor = d;
      pinFor(d);
      scene.enterHouse(d.houseNo, d.room, d.wallpaper, d.floor, !!d.big);
    },
    setWalking(on) {
      if (walking === on) return;
      walking = on;
      play('tap');
      document.body.classList.toggle('walking', on);
      if (on) {
        scene.setWalkMode(true, state.me?.houseNo);
        if (state.me) realtime.start();
        else toast('입주하면 다른 고양이들도 보여요');
        clearInterval(tick);
        tick = window.setInterval(updateNpcs, 200);
      } else {
        setCar(null);
        if (inside !== null) leftHouse();
        if (cave) leftCave();
        scene.setWalkMode(false);
        realtime.stop();
        clearInterval(tick);
        nearNo = doorNo = null;
        nearNpc = null;
        nearHome = null;
        nearCave = false;
        nearBoard = false;
        nearFish = null;
        net = [];
        shownNpcs = [];
        scene.setNpcs([]);
      }
      hooks.onWalking(on);
      updateNpcs();
      draw();
    },
    async enter(houseNo) {
      if (!walking) api.setWalking(true);
      if (cave) {
        scene.exitCave();
        leftCave();
      }
      const lived = state.houses.get(houseNo);
      if (!lived) return;
      setCar(null);
      let d: HouseDecor;
      try {
        const res = await fetchDecor(houseNo);
        d = { houseNo, yard: res.yard, room: res.room, wallpaper: res.wallpaper, floor: res.floor, roofArt: res.roofArt, roofArtBack: res.roofArtBack ?? null, big: !!res.big };
      } catch {
        d = { houseNo, yard: state.yards.get(houseNo) ?? [], room: [], wallpaper: 'cream', floor: 'wood', roofArt: null };
      }
      inside = houseNo;
      decor = d;
      pinFor(d);
      scene.enterHouse(houseNo, d.room, d.wallpaper, d.floor, !!d.big);
      play('open');
      realtime.joinRoom(`house-${houseNo}`);
      hooks.onInside(houseNo);
      updateNpcs(true);
      draw();
    },
    enterHome(homeId) {
      if (!walking) api.setWalking(true);
      setCar(null);
      const d = homeRoom(homeId);
      inside = -homeId - 1;
      decor = d;
      pinFor(d);
      scene.enterNpcHome(homeId, d.room, d.wallpaper, d.floor);
      play('open');
      realtime.joinRoom(`home-${homeId}`);
      hooks.onInside(inside);
      updateNpcs(true);
      draw();
      if (state.me)
        void reportVisit(homeId)
          .then((res) => applyWallet(res.wallet, res.coins ? { coins: res.coins } : { silent: true }))
          .catch(() => {
            /* 방문 보상은 없어도 된다 */
          });
    },
    exit() {
      if (cave) {
        scene.exitCave();
        play('close');
        leftCave();
        return;
      }
      if (inside === null) return;
      scene.exitHouse();
      play('close');
      leftHouse();
    },
    async goInsideMine() {
      if (!state.me) return false;
      if (inside === state.me.houseNo) return true;
      if (!walking) api.setWalking(true);
      else if (inside !== null || cave) api.exit();
      await api.enter(state.me.houseNo);
      return true;
    },
    setNetPlayers(players) {
      net = players;
      pushPlayers();
    },
    fishSpot: () => nearFish,
    refresh: draw,
    riding: () => riding,
    carAck(c) {
      if (riding === 'passenger' && c !== 2) {
        toast('뒷자리에 탈 수 없어요 (이미 누가 탔어요)');
        riding = null;
        rideId = null;
        scene.setRiding(null);
        draw();
      }
    },
  };
  return api;
}
