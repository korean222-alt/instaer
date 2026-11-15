// 꾸미기 모드: 섬 화면 위쪽에 도구 줄을 띄우고, 아이템은 씬에서 손가락으로 끌어서 놓는다.
// 씬과는 startPlacing / stopPlacing / rotatePlacing / onPlace / onPick / setYardItemsFree / setInteriorItems 로만 주고받는다.
import type { IslandScene } from '../../scene';
import { DECOR_ITEMS, decorItem, FLOORS, FREE_ROOM_MAX, FREE_YARD_MAX, ROOM_COLORS, WALLPAPERS } from '../../shared/config';
import { CURRENCY } from '../../shared/economy';
import type { Drawing, HouseDecor, PlacedItem } from '../../shared/types';
import { loadMyDrawings, myDrawingList, pinDrawings, surfaceDrawing } from '../art';
import { play } from '../audio/sound';
import { ApiError, saveDecor } from '../net/api';
import { go } from '../router';
import { state } from '../state';
import { drawingThumb } from '../ui/drawingThumb';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, hasItem } from '../wallet';
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

  // 위: 제목, 저장/취소, 고른 아이템 할 일 / 아래: 아이템 그림 줄 (2026-11-15, 엄지로 고르기 쉽게)
  const bar = document.createElement('div');
  bar.className = 'decor-bar';
  bar.hidden = true;
  document.getElementById('app')!.appendChild(bar);
  const dock = document.createElement('div');
  dock.className = 'decor-dock';
  dock.hidden = true;
  document.getElementById('app')!.appendChild(dock);
  /** 아이템 그림 (씬이 찍은 것) */
  const pic = (type: string) => {
    try {
      const url = scene.renderItemPreview(type, 96);
      return url ? `<img src="${url}" alt="" width="48" height="48" draggable="false" />` : '';
    } catch {
      return '';
    }
  };

  const max = () => (where === 'room' ? FREE_ROOM_MAX : FREE_YARD_MAX);
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
    play('place');
    draw();
  });
  scene.onPick((id) => {
    if (!where) return;
    picked = id;
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
    if (!where) {
      bar.hidden = true;
      dock.hidden = true;
      return;
    }
    bar.hidden = false;
    dock.hidden = false;
    const it = picked ? items.find((i) => i.id === picked) : null;
    const def = it ? decorItem(it.type) : null;
    const shown = DECOR_ITEMS.filter((d) => where === 'room' || d.mount !== 'wall');
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
              <button class="pill btn-pill" data-act="remove">치우기</button>
              <button class="pill btn-pill primary" data-act="done">다 놓았어요</button></div>`
          : `<div class="decor-sel hint-line">아래에서 아이템을 고르고, 섬에서 놓을 곳을 눌러요. 놓인 아이템을 누르면 다시 골라요</div>`
      }
      ${
        where === 'room'
          ? `<div class="decor-sel"><button class="pill btn-pill${panel === 'wallpaper' ? ' on' : ''}" data-act="wallpaper">벽지</button><button class="pill btn-pill${panel === 'floor' ? ' on' : ''}" data-act="floor">바닥</button></div>`
          : ''
      }
      ${panelHtml}`;
    dock.innerHTML = `<div class="decor-strip">
        ${shown
          .map((d) => {
            const own = hasItem(d.type);
            const on = it?.type === d.type;
            return `<button class="strip-item${own ? '' : ' locked'}${on ? ' on' : ''}" data-type="${d.type}">${pic(d.type)}<span>${esc(d.label)}</span>${own ? '' : `<small>${d.price} ${CURRENCY}</small>`}</button>`;
          })
          .join('')}
      </div>`;
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
    panel = null;
    draw();
    explore.refresh();
  }

  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || !where) return;
    const it = picked ? items.find((i) => i.id === picked) : null;
    if (t.dataset.type) {
      const type = t.dataset.type;
      if (!hasItem(type)) {
        play('tap');
        toast(`${decorItem(type)?.label} 은(는) 상점이나 퀘스트로 얻어요`);
        go('shop');
        return;
      }
      if (items.length >= max()) {
        play('error');
        toast(`${max()}개까지 놓을 수 있어요`);
        return;
      }
      panel = null;
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
      } else if (act === 'done') {
        picked = null;
        panel = null;
        play('place');
        scene.startPlacing(null, where === 'yard' ? houseNo : undefined);
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
      panel = null;
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
