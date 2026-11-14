import { HOUSE_CELLS, ROOF_COLORS, YARD_ITEM_MAX, YARD_ITEMS, YARD_SIZE } from '../../shared/config';
import type { YardItem, YardItemType } from '../../shared/types';
import { ApiError, saveYard } from '../net/api';
import { pushHousesToScene, setMe, state } from '../state';
import { toast } from '../ui/toast';
import type { Screen } from './types';

const ITEM_STYLE: Record<YardItemType, { short: string; color: string }> = {
  cat_tower: { short: '캣타워', color: '#d9a37e' },
  hammock: { short: '해먹', color: '#7cc4f2' },
  plant: { short: '화분', color: '#7fd8b0' },
  sign: { short: '간판', color: '#f6a55c' },
  fish_rack: { short: '건조대', color: '#9fa8f0' },
  cushion: { short: '방석', color: '#ff9ec2' },
  lantern: { short: '등불', color: '#ffd166' },
  bench: { short: '벤치', color: '#c5a27e' },
};
const label = (t: YardItemType) => YARD_ITEMS.find((i) => i.type === t)?.label ?? t;
const inHouse = (x: number, y: number) => x >= HOUSE_CELLS.x0 && x <= HOUSE_CELLS.x1 && y >= HOUSE_CELLS.y0 && y <= HOUSE_CELLS.y1;
const same = (a: YardItem[], b: YardItem[]) => JSON.stringify(a) === JSON.stringify(b);

export const decorateScreen: Screen = {
  id: 'decorate',
  title: '마당 꾸미기',
  render(root) {
    const me = state.me;
    if (!me) {
      root.innerHTML = `
        <p class="empty">입주하면 내 마당(6x6 칸)에 캣타워, 해먹, 화분 같은<br />꾸미기 아이템을 놓을 수 있어요.</p>
        <a class="btn primary" href="#/move-in">입주하러 가기</a>`;
      return;
    }
    const houseNo = me.houseNo;
    state.scene.focusHouse(houseNo);

    const savedItems: YardItem[] = (state.yards.get(houseNo) ?? []).map((i) => ({ ...i }));
    /** 저장된 지붕 색 (되돌리기, 닫을 때 기준) */
    const savedRoofRef = { value: me.roofColor };
    let items: YardItem[] = savedItems.map((i) => ({ ...i }));
    let roof = savedRoofRef.value;
    /** 놓을 아이템 (팔레트에서 고른 것) */
    let placing: YardItemType | null = null;
    /** 고른 아이템 (마당에 놓인 것) */
    let selected: number | null = null;
    let saving = false;

    const preview = () => {
      state.scene.setYardItems(houseNo, items);
      const h = state.houses.get(houseNo);
      if (h && h.roofColor !== roof) {
        h.roofColor = roof;
        pushHousesToScene();
      }
    };

    const draw = () => {
      const dirty = !same(items, savedItems) || roof !== savedRoofRef.value;
      const cells: string[] = [];
      for (let y = 0; y < YARD_SIZE; y++) {
        for (let x = 0; x < YARD_SIZE; x++) {
          if (inHouse(x, y)) {
            // 집 몸체는 한 덩어리로 그린다 (맨 왼쪽 위 칸에서만)
            if (x === HOUSE_CELLS.x0 && y === HOUSE_CELLS.y0)
              cells.push(`<div class="yard-house" style="grid-column:${x + 1}/span ${HOUSE_CELLS.x1 - HOUSE_CELLS.x0 + 1};grid-row:${y + 1}/span ${HOUSE_CELLS.y1 - HOUSE_CELLS.y0 + 1};--roof:${roof}"><span>내 집</span></div>`);
            continue;
          }
          const idx = items.findIndex((i) => i.x === x && i.y === y);
          const it = idx >= 0 ? items[idx] : null;
          const st = it ? ITEM_STYLE[it.type] : null;
          cells.push(`<button class="yard-cell${it ? ' has' : ''}${idx === selected ? ' sel' : ''}${!it && (placing || selected !== null) ? ' target' : ''}"
            style="grid-column:${x + 1};grid-row:${y + 1};${st ? `--item:${st.color}` : ''}" data-x="${x}" data-y="${y}"
            aria-label="${it ? `${label(it.type)}, ${it.rotation}도` : `빈 칸 ${x + 1}, ${y + 1}`}">
            ${it ? `<span class="item-name">${st!.short}</span><i class="item-dir" style="transform:rotate(${it.rotation}deg)"></i>` : ''}
          </button>`);
        }
      }
      const sel = selected !== null ? items[selected] : null;
      root.innerHTML = `
        <p class="note">${
          sel
            ? `<b>${label(sel.type)}</b>를 골랐어요. 빈 칸을 누르면 옮겨요.`
            : placing
              ? `<b>${label(placing)}</b>를 놓을 빈 칸을 눌러 주세요.`
              : '아래에서 아이템을 고르고 마당 칸을 눌러 놓아요. 위쪽이 집, 아래쪽이 길이에요.'
        }</p>
        <div class="yard" role="grid" aria-label="내 마당 6x6">${cells.join('')}</div>
        <div class="yard-tools">
          <button class="btn small" data-act="rotate" ${sel ? '' : 'disabled'}>돌리기</button>
          <button class="btn small" data-act="remove" ${sel ? '' : 'disabled'}>빼기</button>
          <span class="count">${items.length} / ${YARD_ITEM_MAX}</span>
        </div>
        <div class="palette" role="listbox" aria-label="꾸미기 아이템">
          ${YARD_ITEMS.map(
            (i) => `<button class="pal${placing === i.type ? ' on' : ''}" data-type="${i.type}" style="--item:${ITEM_STYLE[i.type].color}" role="option" aria-selected="${placing === i.type}"><i></i>${i.label}</button>`,
          ).join('')}
        </div>
        <div class="field"><span>지붕 색</span></div>
        <div class="swatches">
          ${ROOF_COLORS.map((c) => `<button class="swatch${c === roof ? ' on' : ''}" data-roof="${c}" style="background:${c}" aria-label="지붕 색 ${c}" aria-pressed="${c === roof}"></button>`).join('')}
        </div>
        <div class="row two sticky-actions">
          <button class="btn" data-act="reset" ${dirty ? '' : 'disabled'}>되돌리기</button>
          <button class="btn primary" data-act="save" ${dirty && !saving ? '' : 'disabled'}>${saving ? '저장하는 중...' : '저장하기'}</button>
        </div>`;
    };

    root.addEventListener('click', async (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t || !root.contains(t)) return;
      if (t.dataset.type) {
        const type = t.dataset.type as YardItemType;
        placing = placing === type ? null : type;
        selected = null;
      } else if (t.dataset.x !== undefined) {
        const x = Number(t.dataset.x);
        const y = Number(t.dataset.y);
        const idx = items.findIndex((i) => i.x === x && i.y === y);
        if (idx >= 0) {
          selected = selected === idx ? null : idx;
          placing = null;
        } else if (selected !== null) {
          items[selected] = { ...items[selected], x, y };
        } else if (placing) {
          if (items.length >= YARD_ITEM_MAX) toast(`아이템은 ${YARD_ITEM_MAX}개까지 놓을 수 있어요`);
          else items = [...items, { type: placing, x, y, rotation: 0 }];
        }
        preview();
      } else if (t.dataset.roof) {
        roof = t.dataset.roof;
        preview();
      } else if (t.dataset.act === 'rotate' && selected !== null) {
        const it = items[selected];
        items[selected] = { ...it, rotation: (((it.rotation + 90) % 360) as YardItem['rotation']) };
        preview();
      } else if (t.dataset.act === 'remove' && selected !== null) {
        items = items.filter((_, i) => i !== selected);
        selected = null;
        preview();
      } else if (t.dataset.act === 'reset') {
        items = savedItems.map((i) => ({ ...i }));
        roof = savedRoofRef.value;
        selected = null;
        placing = null;
        preview();
      } else if (t.dataset.act === 'save') {
        saving = true;
        draw();
        try {
          const res = await saveYard(houseNo, items, roof);
          savedItems.splice(0, savedItems.length, ...res.items.map((i) => ({ ...i })));
          state.yards.set(houseNo, res.items);
          setMe({ ...state.me!, roofColor: res.roofColor });
          savedRoofRef.value = res.roofColor;
          toast('마당을 저장했어요');
        } catch (err) {
          toast(err instanceof ApiError ? err.message : '저장하지 못했어요');
        }
        saving = false;
      }
      draw();
    });

    draw();
    preview();

    // 저장하지 않고 닫으면 씬을 저장된 모습으로 되돌린다
    return () => {
      const keptItems = state.yards.get(houseNo) ?? [];
      state.scene.setYardItems(houseNo, keptItems);
      const h = state.houses.get(houseNo);
      if (h && h.roofColor !== savedRoofRef.value) {
        h.roofColor = savedRoofRef.value;
        pushHousesToScene();
      }
    };
  },
};
