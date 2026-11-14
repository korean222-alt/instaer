import type { RegionId } from '../../shared/types';
import type { RegionStat } from '../net/api';
import { go } from '../router';
import { refreshRegions, regionColor, regionLabel, setHighlightedRegion, state } from '../state';
import { esc } from '../ui/dom';
import type { Screen } from './types';

type Tab = 'total' | 'week';
let tab: Tab = 'total';

function rows(stats: RegionStat[], key: Tab): string {
  const rankKey = key === 'total' ? 'rankTotal' : 'rankWeek';
  const sorted = [...stats].sort((a, b) => a[rankKey] - b[rankKey] || regionLabel(a.id).localeCompare(regionLabel(b.id), 'ko'));
  const max = Math.max(1, ...sorted.map((s) => s[key]));
  const mine = state.me?.region;
  return sorted
    .map((s) => {
      const pct = Math.round((s[key] / max) * 100);
      const on = state.highlightedRegion === s.id;
      return `<li>
        <button class="rank-row${s.id === mine ? ' mine' : ''}${on ? ' on' : ''}" data-region="${s.id}" aria-pressed="${on}">
          <span class="rank-no">${s[rankKey]}</span>
          <span class="rank-name"><i style="background:${regionColor(s.id)}"></i>${esc(regionLabel(s.id))}${s.id === mine ? '<em aria-label="우리 지역">우리</em>' : ''}</span>
          <span class="rank-bar"><b style="width:${pct}%;background:${regionColor(s.id)}"></b></span>
          <span class="rank-n">${s[key].toLocaleString()}</span>
        </button>
      </li>`;
    })
    .join('');
}

function summary(stats: RegionStat[]): string {
  const me = state.me;
  if (!me) return `<div class="region-card soft"><span>입주하면 우리 지역 순위에 한 마리가 더해져요</span><a class="link" href="#/move-in">입주하기</a></div>`;
  const s = stats.find((r) => r.id === me.region);
  if (!s) return '';
  const first = Math.max(...stats.map((r) => r.total));
  return `<div class="region-card"><b>${esc(regionLabel(me.region))} ${s.rankTotal}위</b><span>우리 지역 ${s.total.toLocaleString()}마리${
    s.rankTotal > 1 ? ` · 1위까지 ${(first - s.total).toLocaleString()}마리` : ''
  }</span></div>`;
}

export const rankScreen: Screen = {
  id: 'rank',
  title: '지역 대항전',
  render(root) {
    const draw = () => {
      const r = state.regions;
      if (!r) {
        root.innerHTML = `<p class="empty">${state.offline ? '지금은 순위를 불러올 수 없어요' : '순위를 불러오는 중...'}</p>`;
        return;
      }
      root.innerHTML = `
        ${summary(r.regions)}
        <div class="tabs" role="tablist">
          <button class="tab${tab === 'total' ? ' on' : ''}" role="tab" aria-selected="${tab === 'total'}" data-tab="total">전체 입주</button>
          <button class="tab${tab === 'week' ? ' on' : ''}" role="tab" aria-selected="${tab === 'week'}" data-tab="week">이번 주 신규</button>
        </div>
        <ol class="rank-list">${rows(r.regions, tab)}</ol>
        <p class="note center">지역을 누르면 섬에서 그 지역 집이 밝게 보여요.${tab === 'week' ? '<br />이번 주는 월요일 0시(한국 시간)부터 세요.' : ''}</p>`;
      root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          tab = b.dataset.tab as Tab;
          draw();
        }),
      );
      root.querySelectorAll<HTMLButtonElement>('[data-region]').forEach((b) =>
        b.addEventListener('click', () => {
          const id = b.dataset.region as RegionId;
          const next = state.highlightedRegion === id ? null : id;
          setHighlightedRegion(next);
          if (next) go('map'); // 판을 닫아서 섬을 보여 준다 (위쪽 칩으로 해제)
          else draw();
        }),
      );
    };
    draw();
    let alive = true;
    refreshRegions().then(() => alive && draw());
    return () => {
      alive = false;
    };
  },
};
