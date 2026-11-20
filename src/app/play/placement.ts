// 꾸미기 모드: 섬 화면 위쪽에 도구 줄을 띄우고, 아이템은 씬에서 손가락으로 끌어서 놓는다.
// 씬과는 startPlacing / stopPlacing / rotatePlacing / onPlace / onPick / setYardItemsFree / setInteriorItems 로만 주고받는다.
import type { IslandScene } from '../../scene';
import { DECOR_ITEMS, decorItem, FLOORS, FREE_ROOM_MAX, FREE_YARD_MAX, GIFT_ITEMS, ROOM_COLORS, WALLPAPERS, YARD_ONLY_ITEMS } from '../../shared/config';
import { CURRENCY, FREE_ROOM_MAX_BIG } from '../../shared/economy';
import type { Drawing, HouseDecor, PlacedItem } from '../../shared/types';
import { loadMyDrawings, myDrawingList, pinDrawings, surfaceDrawing } from '../art';
import { play } from '../audio/sound';
import { ApiError, buyItem, saveDecor } from '../net/api';
import { markGuide } from './guide';
import { go } from '../router';
import { state } from '../state';
import { drawingThumb } from '../ui/drawingThumb';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, coins, hasItem } from '../wallet';
import { openDrawEditor } from '../screens/draw';
import type { Explore } from './explore';

type Where = 'yard' | 'room';
type Panel = null | 'art' | 'wallpaper' | 'floor';

export interface Placement {
  active(): boolean;
  start(where: Where): Promise<void>;
  /** 저장하지 않고 끝낸다 (되돌림) */
  cancel(): void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// (2026-11-20 사용자: "상점 버튼이 누르는 버튼인 걸 알려주고 싶다") 상점 탭은 장바구니 그림 + 테두리 + ›,
// 한 번도 안 눌러 봤으면 살짝 통통 튀고 "눌러서 가구 사기" 말풍선을 단다 (한 번 누르면 이 브라우저에서는 그만)
const SHOP_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="19.5" r="1.6" fill="currentColor"/><circle cx="17" cy="19.5" r="1.6" fill="currentColor"/></svg>';
const SHOP_SEEN_KEY = 'ci_shoptab_seen';
let shopSeen: boolean | null = null;
function shopTabSeen(): boolean {
  if (shopSeen === null) {
    try {
      shopSeen = localStorage.getItem(SHOP_SEEN_KEY) === '1';
    } catch {
      shopSeen = false;
    }
  }
  return shopSeen;
}
function markShopTabSeen() {
  shopSeen = true;
  try {
    localStorage.setItem(SHOP_SEEN_KEY, '1');
  } catch {
    /* 저장이 막힌 브라우저 */
  }
}

export function createPlacement(scene: IslandScene, explore: Explore): Placement {
  let where: Where | null = null;
  let houseNo = 0;
  let items: PlacedItem[] = [];
  let saved: PlacedItem[] = [];
  let wallpaper = 'cream';
  let floor = 'wood';
  let savedSurf = { wallpaper, floor };
  let picked: string | null = null;
  let panel: Panel = null;
  let saving = false;
  /** 아래 줄: 내 가구 / 상점 (2026-11-19 사용자: "가구가 많아져서 한 줄은 어렵다, 가진 것과 살 것을 따로") */
  let dockTab: 'mine' | 'shop' = 'mine';
  /** 상점 줄에서 누른, 살지 묻는 아이템 */
  let buyType: string | null = null;
  let buying = false;
  let drawnTab: 'mine' | 'shop' | null = null;

  // 위: 제목, 저장/취소, 고른 아이템 할 일 / 아래: 아이템 그림 줄 (2026-11-15, 엄지로 고르기 쉽게)
  const bar = document.createElement('div');
  bar.className = 'decor-bar';
  bar.hidden = true;
  document.getElementById('app')!.appendChild(bar);
  const dock = document.createElement('div');
  dock.className = 'decor-dock';
  dock.hidden = true;
  document.getElementById('app')!.appendChild(dock);
  // 2026-11-18 사용자: "집 화면도 돌리면서 배치하고 싶다". 오른쪽에 화면 돌리기/위에서 보기 버튼
  const viewPad = document.createElement('div');
  viewPad.className = 'view-pad';
  viewPad.hidden = true;
  viewPad.innerHTML = `
    <button type="button" data-view="left" aria-label="화면 왼쪽으로 돌리기">↺</button>
    <button type="button" data-view="right" aria-label="화면 오른쪽으로 돌리기">↻</button>
    <button type="button" data-view="top" aria-label="위에서 보기">위</button>
    <button type="button" data-view="reset" aria-label="처음 시점">처음</button>`;
  document.getElementById('app')!.appendChild(viewPad);
  const drawPad = () => {
    viewPad.hidden = !where;
    viewPad.querySelector('[data-view="top"]')!.classList.toggle('on', !!where && scene.getTopView());
  };
  viewPad.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || !where) return;
    const v = b.dataset.view;
    if (v === 'left') scene.rotateView(-Math.PI / 4);
    else if (v === 'right') scene.rotateView(Math.PI / 4);
    else if (v === 'top') scene.setTopView(!scene.getTopView());
    else if (v === 'reset') scene.resetView();
    play('tap');
    drawPad();
  });
  /** 아이템 그림 (씬이 찍은 것) */
  const pic = (type: string) => {
    try {
      const url = scene.renderItemPreview(type, 96);
      return url ? `<img src="${url}" alt="" width="48" height="48" draggable="false" />` : '';
    } catch {
      return '';
    }
  };

  const max = () => (where === 'room' ? (explore.insideDecor()?.big ? FREE_ROOM_MAX_BIG : FREE_ROOM_MAX) : FREE_YARD_MAX);
  /** 아래 줄에서 골랐지만 아직 놓을 곳을 누르지 않은 아이템 종류 (2026-11-16) */
  let pendingType: string | null = null;
  const dirty = () => !same(items, saved) || (where === 'room' && (wallpaper !== savedSurf.wallpaper || floor !== savedSurf.floor));

  function pushScene() {
    if (where === 'room') scene.setInteriorItems(items);
    else scene.setYardItemsFree(houseNo, items);
    pinDrawings([...items.map((i) => i.drawingId), surfaceDrawing(wallpaper), surfaceDrawing(floor)]);
  }
  function pushSurface() {
    const d = explore.insideDecor();
    if (where === 'room' && d) scene.enterHouse(houseNo, items, wallpaper, floor);
    pushScene();
  }

  scene.onPlace((item) => {
    if (!where) return;
    const i = items.findIndex((it) => it.id === item.id);
    if (i >= 0) items[i] = { ...item, drawingId: items[i].drawingId };
    else items.push(item);
    picked = item.id;
    pendingType = null;
    play('place');
    draw();
  });
  scene.onPick((id) => {
    if (!where) return;
    picked = id;
    pendingType = null;
    panel = null;
    play('tap');
    scene.startPlacing(id, where === 'yard' ? houseNo : undefined);
    draw();
  });

  function thumbs(list: Drawing[], current: string | null | undefined, act: string) {
    return `
      <button class="art-pick${!current ? ' on' : ''}" data-${act}="">없음</button>
      ${list.map((d) => `<button class="art-pick${current === d.id ? ' on' : ''}" data-${act}="${esc(d.id)}">${drawingThumb(d, 40)}</button>`).join('')}
      <button class="art-pick new" data-act="new-art">+ 새 그림</button>`;
  }

  function draw() {
    drawPad();
    if (!where) {
      bar.hidden = true;
      dock.hidden = true;
      return;
    }
    bar.hidden = false;
    dock.hidden = false;
    const it = picked ? items.find((i) => i.id === picked) : null;
    const def = it ? decorItem(it.type) : null;
    // 집 안에는 마당 전용(눈사람)을 빼고, 마당에는 벽걸이를 뺀다. 선물로만 받는 것은 가졌을 때만 보인다
    const shown = DECOR_ITEMS.filter(
      (d) => (where === 'room' ? !YARD_ONLY_ITEMS.includes(d.type) : d.mount !== 'wall') && (!GIFT_ITEMS.includes(d.type) || hasItem(d.type)),
    );
    let panelHtml = '';
    if (panel === 'art' && it) panelHtml = `<div class="decor-panel"><b>${esc(def?.label ?? '')}에 붙일 그림</b><div class="art-row">${thumbs(myDrawingList(), it.drawingId, 'art')}</div></div>`;
    if (panel === 'wallpaper' || panel === 'floor') {
      const cur = panel === 'wallpaper' ? wallpaper : floor;
      const presets = panel === 'wallpaper' ? WALLPAPERS : FLOORS;
      panelHtml = `<div class="decor-panel"><b>${panel === 'wallpaper' ? '벽지' : '바닥'}</b>
        <div class="art-row">
          ${presets.map((p) => `<button class="art-pick${cur === p.id ? ' on' : ''}" data-surf="${p.id}">${p.label}</button>`).join('')}
          ${ROOM_COLORS.map((c) => `<button class="art-pick color${cur === c ? ' on' : ''}" data-surf="${c}" style="background:${c}" aria-label="단색 ${c}"></button>`).join('')}
          ${myDrawingList().map((d) => `<button class="art-pick${cur === `drawing:${d.id}` ? ' on' : ''}" data-surf="drawing:${esc(d.id)}">${drawingThumb(d, 40)}</button>`).join('')}
          <button class="art-pick new" data-act="new-art">+ 새 그림</button>
        </div></div>`;
    }
    bar.innerHTML = `
      <div class="decor-top">
        <b>${where === 'room' ? '집 안 꾸미기' : '마당 꾸미기'}</b>
        <span class="count">${items.length}/${max()}</span>
        <button class="pill btn-pill" data-act="cancel">취소</button>
        <button class="pill btn-pill primary" data-act="save" ${dirty() && !saving ? '' : 'disabled'}>${saving ? '저장 중' : '저장'}</button>
      </div>
      ${
        it && def
          ? `<div class="decor-sel picked"><b>${esc(def.label)} 고름</b><span class="hint-line">놓을 곳을 누르거나 끌어서 옮겨요</span></div>
             <div class="decor-sel">
              ${def.mount !== 'wall' ? '<button class="pill btn-pill" data-act="rotate">돌리기</button>' : ''}
              ${def.art ? `<button class="pill btn-pill${panel === 'art' ? ' on' : ''}" data-act="art">그림</button>` : ''}
              <button class="pill btn-pill" data-act="again">하나 더</button>
              <button class="pill btn-pill" data-act="remove">치우기</button>
              <button class="pill btn-pill primary" data-act="done">다 놓았어요</button></div>`
          : pendingType
            ? `<div class="decor-sel picked"><b>${esc(decorItem(pendingType)?.label ?? '')} 고름</b><span class="hint-line">${decorItem(pendingType)?.mount === 'wall' ? '걸 벽을 눌러요' : '놓을 곳을 눌러요'}</span></div>
               <div class="decor-sel"><button class="pill btn-pill" data-act="unpick">안 놓을래요</button></div>`
            : `<div class="decor-sel hint-line">아래에서 아이템을 고르고 놓을 곳을 눌러요. 놓인 아이템은 누르면 다시 골라요. ${
                where === 'room' || explore.walking() ? '빈 곳을 끌면 화면이 돌고, 두 손가락으로 확대해요' : '두 손가락을 비틀면 화면이 돌아요'
              }</div>`
      }
      ${
        where === 'room'
          ? `<div class="decor-sel"><button class="pill btn-pill${panel === 'wallpaper' ? ' on' : ''}" data-act="wallpaper">벽지</button><button class="pill btn-pill${panel === 'floor' ? ' on' : ''}" data-act="floor">바닥</button></div>`
          : ''
      }
      ${panelHtml}`;
    const mine = shown.filter((d) => hasItem(d.type));
    const forSale = shown.filter((d) => !hasItem(d.type) && d.price !== null);
    const buyDef = buyType ? decorItem(buyType) : null;
    const strip =
      dockTab === 'mine'
        ? mine.length
          ? mine
              .map((d) => {
                const on = it?.type === d.type || pendingType === d.type;
                return `<button class="strip-item${on ? ' on' : ''}" data-type="${d.type}">${pic(d.type)}<span>${esc(d.label)}</span></button>`;
              })
              .join('')
          : '<p class="strip-empty">아직 놓을 가구가 없어요. <button class="strip-go-shop" data-tab="shop">상점 열기 ›</button></p>'
        : forSale.length
          ? forSale
              .map((d) => `<button class="strip-item shop${buyType === d.type ? ' on' : ''}" data-buy="${d.type}">${pic(d.type)}<span>${esc(d.label)}</span><small>${d.price} ${CURRENCY}</small></button>`)
              .join('')
          : '<p class="strip-empty">상점 가구를 다 가졌어요!</p>';
    // 다시 그려도 보던 자리를 지킨다 (같은 탭일 때)
    const keepScroll = drawnTab === dockTab ? (dock.querySelector('.decor-strip')?.scrollLeft ?? 0) : 0;
    drawnTab = dockTab;
    dock.innerHTML = `
      ${
        buyDef && dockTab === 'shop'
          ? `<div class="decor-buy">${pic(buyDef.type)}<div>${esc(buyDef.label)}<small>${buyDef.price} ${CURRENCY} · 사면 바로 놓을 수 있어요</small></div>
              <button class="pill btn-pill primary" data-act="buy" ${buying || coins() < (buyDef.price ?? 0) ? 'disabled' : ''}>${buying ? '사는 중' : coins() < (buyDef.price ?? 0) ? `${(buyDef.price ?? 0) - coins()} 모자라요` : '사기'}</button>
              <button class="pill btn-pill" data-act="nobuy">닫기</button></div>`
          : ''
      }
      <div class="dock-tabs">
        <button data-tab="mine" class="${dockTab === 'mine' ? 'on' : ''}">내 가구 ${mine.length}</button>
        <button data-tab="shop" class="shop-tab${dockTab === 'shop' ? ' on' : ''}${!shopTabSeen() && dockTab !== 'shop' ? ' hint' : ''}">${SHOP_ICON}<span>상점 ${forSale.length}</span>${dockTab === 'shop' ? '' : '<i class="chev">›</i>'}${!shopTabSeen() && dockTab !== 'shop' ? '<em class="tap-hint">눌러서 가구 사기</em>' : ''}</button>
        <span class="coins">${coins().toLocaleString()} ${CURRENCY}</span>
      </div>
      <div class="decor-strip">${strip}</div>`;
    dock.querySelector('.decor-strip')!.scrollLeft = keepScroll;
  }

  /** 꾸미는 자리에서 바로 사고, 산 가구를 바로 놓을 준비를 한다 */
  async function buyHere(type: string) {
    if (buying || !where) return;
    buying = true;
    draw();
    try {
      const res = await buyItem(type);
      applyWallet(res.wallet, { item: res.bought });
      buyType = null;
      dockTab = 'mine';
      if (where && items.length < max()) {
        picked = null;
        panel = null;
        pendingType = type;
        scene.startPlacing(type, where === 'yard' ? houseNo : undefined);
        toast(`${decorItem(type)?.label ?? ''} 구입! 놓을 곳을 눌러요`);
      }
    } catch (e) {
      play('error');
      toast(e instanceof ApiError ? e.message : '사지 못했어요');
    }
    buying = false;
    draw();
  }

  async function save() {
    if (!where || saving) return;
    saving = true;
    draw();
    try {
      const res = await saveDecor(houseNo, where === 'room' ? { room: items, wallpaper, floor } : { yard: items });
      applyWallet(res.wallet, { silent: true });
      const d: HouseDecor = res.decor;
      if (where === 'yard') state.yards.set(houseNo, d.yard);
      else explore.setInsideDecor(d);
      play('save');
      markGuide('decorate');
      toast(where === 'room' ? '집 안을 저장했어요' : '마당을 저장했어요');
      finish();
    } catch (e) {
      play('error');
      toast(e instanceof ApiError ? e.message : '저장하지 못했어요');
    }
    saving = false;
    draw();
  }

  function finish() {
    scene.stopPlacing();
    document.body.classList.remove('decorating');
    state.editingYard = null;
    if (where === 'yard') pinDrawings([]);
    where = null;
    picked = null;
    pendingType = null;
    panel = null;
    draw();
    explore.refresh();
  }

  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || !where) return;
    const it = picked ? items.find((i) => i.id === picked) : null;
    if (t.dataset.tab) {
      dockTab = t.dataset.tab === 'shop' ? 'shop' : 'mine';
      if (dockTab === 'shop') markShopTabSeen();
      buyType = null;
      play('tap');
      draw();
      return;
    }
    if (t.dataset.buy) {
      buyType = buyType === t.dataset.buy ? null : t.dataset.buy;
      play('tap');
      draw();
      return;
    }
    if (t.dataset.act === 'nobuy') {
      buyType = null;
      play('close');
      draw();
      return;
    }
    if (t.dataset.act === 'buy' && buyType) {
      void buyHere(buyType);
      return;
    }
    if (t.dataset.type) {
      const type = t.dataset.type;
      if (!hasItem(type)) {
        play('tap');
        go('shop');
        return;
      }
      if (items.length >= max()) {
        play('error');
        toast(`${max()}개까지 놓을 수 있어요`);
        return;
      }
      panel = null;
      picked = null;
      pendingType = type;
      play('tap');
      scene.startPlacing(type, where === 'yard' ? houseNo : undefined);
    } else if (t.dataset.art !== undefined && it) {
      it.drawingId = t.dataset.art || undefined;
      if (!it.drawingId) delete it.drawingId;
      play('place');
      pushScene();
    } else if (t.dataset.surf !== undefined) {
      if (panel === 'wallpaper') wallpaper = t.dataset.surf;
      else floor = t.dataset.surf;
      play('tap');
      pushSurface();
    } else {
      const act = t.dataset.act;
      if (act === 'cancel') api.cancel();
      else if (act === 'save') void save();
      else if (act === 'rotate') {
        scene.rotatePlacing();
        play('rotate');
      } else if (act === 'unpick') {
        pendingType = null;
        play('tap');
        scene.startPlacing(null, where === 'yard' ? houseNo : undefined);
      } else if (act === 'done') {
        picked = null;
        panel = null;
        play('place');
        scene.startPlacing(null, where === 'yard' ? houseNo : undefined);
      } else if (act === 'again' && it) {
        // 같은 가구를 하나 더 (2026-11-18)
        if (items.length >= max()) {
          play('error');
          toast(`${max()}개까지 놓을 수 있어요`);
          return;
        }
        picked = null;
        panel = null;
        pendingType = it.type;
        play('tap');
        scene.startPlacing(it.type, where === 'yard' ? houseNo : undefined);
      } else if (act === 'remove' && it) {
        items = items.filter((i) => i.id !== it.id);
        picked = null;
        panel = null;
        play('remove');
        pushScene();
      } else if (act === 'art' || act === 'wallpaper' || act === 'floor') {
        panel = panel === act ? null : act;
        play('tap');
        void loadMyDrawings().then(draw);
      } else if (act === 'new-art') {
        const target = panel;
        const targetId = picked;
        openDrawEditor((d) => {
          if (!where) return;
          if (target === 'art' && targetId) {
            const x = items.find((i) => i.id === targetId);
            if (x) x.drawingId = d.id;
          } else if (target === 'wallpaper') wallpaper = `drawing:${d.id}`;
          else if (target === 'floor') floor = `drawing:${d.id}`;
          pushSurface();
          draw();
        });
        return;
      }
    }
    draw();
  };
  bar.addEventListener('click', onClick);
  dock.addEventListener('click', onClick);

  const api: Placement = {
    active: () => where !== null,
    async start(w) {
      if (!state.me) return;
      if (where) api.cancel();
      houseNo = state.me.houseNo;
      if (w === 'room') {
        await explore.goInsideMine();
        const d = explore.insideDecor();
        if (!d || explore.inside() !== houseNo) return;
        items = d.room.map((i) => ({ ...i }));
        wallpaper = d.wallpaper;
        floor = d.floor;
      } else {
        if (explore.inside() !== null) explore.exit();
        items = (state.yards.get(houseNo) ?? []).map((i) => ({ ...i }));
        state.editingYard = houseNo;
      }
      saved = items.map((i) => ({ ...i }));
      savedSurf = { wallpaper, floor };
      where = w;
      picked = null;
      pendingType = null;
      panel = null;
      buyType = null;
      dockTab = 'mine';
      document.body.classList.add('decorating');
      scene.startPlacing(null, w === 'yard' ? houseNo : undefined);
      pushScene();
      void loadMyDrawings();
      draw();
      explore.refresh();
    },
    cancel() {
      if (!where) return;
      items = saved;
      wallpaper = savedSurf.wallpaper;
      floor = savedSurf.floor;
      if (where === 'room') pushSurface();
      else pushScene();
      play('close');
      finish();
    },
  };
  return api;
}
