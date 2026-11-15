// 걷기 모드에서 할 수 있는 것: 집 구경, 집 안 들어가기, 주민에게 말 걸기, 연못과 항구 부두에서 낚시.
// 씬과는 공개 함수(setWalkMode, onNearHouse, onDoor, enterHouse, exitHouse, onExitHouse, setRemotePlayers,
// setNpcs, onNpcTap, getLocalState, fishingSpotAt)로만 주고받는다.
import { fishingSpotAt, type IslandScene } from '../../scene';
import type { FishWhere } from '../../shared/economy';
import type { HouseDecor, InteriorItem, RemotePlayer } from '../../shared/types';
import { pinDrawings, setArtCenter, surfaceDrawing } from '../art';
import { play } from '../audio/sound';
import { fetchDecor, reportVisit } from '../net/api';
import type { Realtime } from '../net/realtime';
import { go } from '../router';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet } from '../wallet';
import { residentNpc, toSceneNpc, townNpcs, type Npc } from './npcs';

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
  inside(): number | null;
  /** 들어가 있는 집의 꾸미기 (주민 집이면 미리 정한 방) */
  insideDecor(): HouseDecor | null;
  setInsideDecor(d: HouseDecor): void;
  setWalking(on: boolean): void;
  enter(houseNo: number): Promise<void>;
  exit(): void;
  /** 내 집 안으로 (걷기를 켜고 내 집 문 앞에서 들어간다) */
  goInsideMine(): Promise<boolean>;
  /** 실시간이 받은 다른 유저 목록 */
  setNetPlayers(players: RemotePlayer[]): void;
  /** 지금 서 있는 곳의 낚시터 (없으면 null) */
  fishSpot(): FishWhere | null;
  /** 버튼 다시 그리기 (판이 열리고 닫힐 때 등) */
  refresh(): void;
}

/** 주민 집 안 (번지마다 정해진 모양) */
function residentRoom(houseNo: number): HouseDecor {
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
  const p = presets[houseNo % presets.length];
  return { houseNo, wallpaper: p.wallpaper, floor: p.floor, roofArt: null, yard: [], room: p.room.map((it, i) => ({ ...it, id: `r${i}` })) };
}

export function createExplore(scene: IslandScene, realtime: Realtime, hooks: ExploreHooks): Explore {
  let walking = false;
  let inside: number | null = null;
  let decor: HouseDecor | null = null;
  let doorNo: number | null = null;
  let nearNo: number | null = null;
  let nearNpc: Npc | null = null;
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
    if (inside !== null) list = state.houses.has(inside) ? [] : [residentNpc(inside)];
    else
      list = townNpcs(state.unlockedZones)
        .map((n) => ({ n, d: Math.hypot(n.x - me.x, n.z - me.z) }))
        .filter((e) => e.d < 40)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
        .map((e) => e.n);
    const changed = list.length !== shownNpcs.length || list.some((n, i) => shownNpcs[i]?.id !== n.id);
    shownNpcs = list;
    if (changed || force) pushNpcs();

    // 가까운 주민, 낚시터 (연못, 항구 부두)
    let best: Npc | null = null;
    let bestD = 2.4;
    for (const n of list) {
      const d = Math.hypot(n.x - me.x, n.z - me.z);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    const spot = inside === null ? fishingSpotAt(me.x, me.z) : null;
    const fishHere: FishWhere | null = spot ? (spot.kind === 'pier' ? 'sea' : 'pond') : null;
    if (best?.id !== nearNpc?.id || fishHere !== nearFish) {
      if ((best && !nearNpc) || (fishHere && !nearFish)) play('ding');
      nearNpc = best;
      nearFish = fishHere;
      draw();
    }
    if (inside === null) setArtCenter(me.x, me.z);
  }

  function draw() {
    const sheetOpen = document.getElementById('sheet')?.classList.contains('open');
    const btns: string[] = [];
    if (walking && !sheetOpen && !document.body.classList.contains('playing')) {
      if (nearNpc) btns.push(`<button class="act-btn primary" data-act="talk">${hooks.icon('chat')}<span>${esc(nearNpc.name)}에게 말 걸기</span></button>`);
      if (nearFish && !nearNpc) btns.push(`<button class="act-btn primary" data-act="fish">${hooks.icon('fish')}<span>${nearFish === 'sea' ? '바다 낚시하기' : '낚시하기'}</span></button>`);
      if (inside === null && doorNo !== null) {
        const h = state.houses.get(doorNo);
        const label = state.me?.houseNo === doorNo ? '내 집 들어가기' : h?.igHandle ? `@${h.igHandle} 집 들어가기` : '주민 집 들어가기';
        btns.push(`<button class="act-btn" data-act="enter">${hooks.icon('door')}<span>${esc(label)}</span></button>`);
      } else if (inside === null && nearNo !== null) {
        const h = state.houses.get(nearNo);
        btns.push(`<button class="act-btn" data-act="look">${hooks.icon('eye')}<span>${esc(h?.igHandle ? `@${h.igHandle} 집 구경하기` : '이 집 구경하기')}</span></button>`);
      }
    }
    bar.innerHTML = btns.slice(0, 2).join('');

    insideBar.hidden = inside === null || !!sheetOpen || document.body.classList.contains('decorating') || document.body.classList.contains('playing');
    if (inside !== null) {
      const h = state.houses.get(inside);
      const mine = state.me?.houseNo === inside;
      const who = mine ? '내 집' : h?.igHandle ? `@${h.igHandle} 집` : `주민 ${residentNpc(inside).name}네 집`;
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
    } else if (act === 'fish' && nearFish) hooks.fish(nearFish);
    else if (act === 'enter' && doorNo !== null) void api.enter(doorNo);
    else if (act === 'look' && nearNo !== null) go('house', nearNo);
    else if (act === 'exit') api.exit();
    else if (act === 'decorate') go('decorate', 'room');
  };
  bar.addEventListener('click', onClick);
  insideBar.addEventListener('click', onClick);

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
    insideDecor: () => decor,
    setInsideDecor(d) {
      if (inside !== d.houseNo) return;
      decor = d;
      pinFor(d);
      scene.enterHouse(d.houseNo, d.room, d.wallpaper, d.floor);
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
        if (inside !== null) leftHouse();
        scene.setWalkMode(false);
        realtime.stop();
        clearInterval(tick);
        nearNo = doorNo = null;
        nearNpc = null;
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
      const lived = state.houses.get(houseNo);
      let d: HouseDecor;
      if (lived) {
        try {
          const res = await fetchDecor(houseNo);
          d = { houseNo, yard: res.yard, room: res.room, wallpaper: res.wallpaper, floor: res.floor, roofArt: res.roofArt };
        } catch {
          d = { houseNo, yard: state.yards.get(houseNo) ?? [], room: [], wallpaper: 'cream', floor: 'wood', roofArt: null };
        }
      } else d = residentRoom(houseNo);
      inside = houseNo;
      decor = d;
      pinFor(d);
      scene.enterHouse(houseNo, d.room, d.wallpaper, d.floor);
      play('open');
      realtime.joinRoom(`house-${houseNo}`);
      hooks.onInside(houseNo);
      updateNpcs(true);
      draw();
      if (!lived && state.me) {
        try {
          const res = await reportVisit(houseNo);
          if (res.coins) applyWallet(res.wallet, { coins: res.coins });
          else applyWallet(res.wallet);
        } catch {
          /* 방문 보상은 없어도 된다 */
        }
      }
    },
    exit() {
      if (inside === null) return;
      scene.exitHouse();
      play('close');
      leftHouse();
    },
    async goInsideMine() {
      if (!state.me) return false;
      if (inside === state.me.houseNo) return true;
      if (!walking) api.setWalking(true);
      else if (inside !== null) api.exit();
      await api.enter(state.me.houseNo);
      return true;
    },
    setNetPlayers(players) {
      net = players;
      pushPlayers();
    },
    fishSpot: () => nearFish,
    refresh: draw,
  };
  return api;
}
