// 걷는 동안 받은 퀘스트 보기 (2026-11-16 사용자 요청). 오른쪽 위 "퀘스트" 버튼 → 받은 부탁과 진행도를 작게 띄운다.
import { dailyQuest, kstDay, normalizeWallet, NPC_INFO, parseWanderId, questValue, storyQuest } from '../../shared/economy';
import { wanderName } from './wanderers';
import { play } from '../audio/sound';
import { go } from '../router';
import { state } from '../state';
import { esc } from '../ui/dom';
import { claimableCount } from '../wallet';

export function createWalkQuests(icon: (name: string) => string) {
  const app = document.getElementById('app')!;
  const btn = document.createElement('button');
  btn.className = 'walk-quest';
  btn.innerHTML = `${icon('quests')}<span>퀘스트</span><em hidden></em>`;
  app.appendChild(btn);
  const peek = document.createElement('div');
  peek.className = 'quest-peek';
  peek.hidden = true;
  app.appendChild(peek);

  const bar = (v: number, t: number) =>
    `<div class="q-prog"><span class="q-bar"><b style="width:${Math.min(100, (v / t) * 100)}%"></b></span><span class="q-n">${Math.min(v, t)}/${t}</span></div>`;

  function rows(): string[] {
    const w = state.wallet;
    if (!w) return [];
    const data = normalizeWallet(w.data, kstDay());
    const out: string[] = [];
    for (const id of Object.keys(data.daily.accepted)) {
      const q = dailyQuest(id);
      if (!q || data.daily.claimed.includes(id)) continue;
      const v = questValue(data, q);
      out.push(`<li><b>${esc(q.label)}</b><small>${esc(NPC_INFO[q.npc].title)} ${esc(NPC_INFO[q.npc].name)} · ${esc(q.hint)}</small>${v >= q.target ? '<span class="ok">다 했어요! 퀘스트에서 받기</span>' : bar(v, q.target)}</li>`);
    }
    for (const id of Object.keys(data.daily.accepted)) {
      const p = parseWanderId(id);
      if (!p || p.def.kind !== 'count' || data.daily.claimed.includes(id)) continue;
      const v = questValue(data, { id, key: p.def.key! });
      const t = p.def.target!;
      out.push(`<li><b>${esc(p.def.label)}</b><small>${esc(wanderName(p.walker))} · ${esc(p.def.hint)}</small>${v >= t ? '<span class="ok">다 했어요! 퀘스트에서 받기</span>' : bar(v, t)}</li>`);
    }
    for (const id of data.storyTaken) {
      const q = storyQuest(id);
      if (!q) continue;
      const v = data.life[q.key];
      out.push(`<li><b>${esc(q.label)} (특별)</b><small>${esc(NPC_INFO[q.npc].title)} ${esc(NPC_INFO[q.npc].name)}</small>${v >= q.target ? '<span class="ok">다 했어요! 퀘스트에서 받기</span>' : bar(v, q.target)}</li>`);
    }
    return out;
  }

  function refresh() {
    const list = rows();
    const em = btn.querySelector('em')!;
    const ready = claimableCount();
    em.hidden = list.length === 0 && ready === 0;
    em.textContent = String(ready || list.length);
    em.classList.toggle('done', ready > 0);
    btn.hidden = !state.me;
    if (!peek.hidden) draw(list);
  }
  function draw(list = rows()) {
    peek.innerHTML = `<h4>받은 퀘스트</h4>${
      list.length ? `<ul>${list.join('')}</ul>` : '<p class="empty">받은 부탁이 없어요. 주민에게 말을 걸거나 머리 위에 ! 가 뜬 산책냥 옆을 지나가 보세요.</p>'
    }<button class="btn small" data-all>퀘스트 전체 보기</button>`;
  }
  btn.addEventListener('click', () => {
    play('tap');
    peek.hidden = !peek.hidden;
    if (!peek.hidden) draw();
  });
  peek.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-all]')) {
      peek.hidden = true;
      go('quests');
    }
  });
  refresh();
  return { refresh };
}
