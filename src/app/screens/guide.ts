// 처음 할 일 판 (#/guide, 2026-11-18). 단계 목록, 진행도, 바로 하기(길 안내) 버튼, 매일 해 볼 것.
import { play } from '../audio/sound';
import { doGuideStep, GUIDE_DAILY, GUIDE_STEPS, guideHidden, guideProgress, setGuideHidden, type GuideStepId } from '../play/guide';
import { onChange, state } from '../state';
import { esc } from '../ui/dom';
import type { Screen } from './types';

export const guideScreen: Screen = {
  id: 'guide',
  title: '처음 할 일',
  render(root) {
    const draw = () => {
      if (!state.me) {
        root.innerHTML = '<p class="note">입주하면 섬에서 해 볼 일을 하나씩 알려 드려요.</p><a class="btn primary" href="#/move-in">입주하러 가기</a>';
        return;
      }
      const pr = guideProgress();
      if (!pr) {
        root.innerHTML = '<p class="note">불러오는 중...</p>';
        return;
      }
      const nextId = pr.next?.id;
      root.innerHTML = `
        <p class="lead">${pr.next ? '고양이섬에서 할 수 있는 걸 하나씩 해 봐요. 버튼을 누르면 길을 알려 줘요.' : '<b>다 했어요!</b> 이제 섬 생활 준비 끝이에요.'}</p>
        <div class="guide-prog"><span class="q-bar"><b style="width:${(pr.count / pr.total) * 100}%"></b></span><span>${pr.count}/${pr.total}</span></div>
        <ol class="guide-list">
          ${GUIDE_STEPS.map((s) => {
            const done = pr.done[s.id];
            const cur = s.id === nextId;
            return `<li class="${done ? 'done' : cur ? 'cur' : ''}">
              <i class="guide-check" aria-hidden="true">${done ? '✓' : s.emoji}</i>
              <div><b>${esc(s.title)}${done ? ' <small>완료</small>' : ''}</b>
              ${done ? '' : `<p>${esc(s.how)}</p><button class="btn small${cur ? ' primary' : ''}" data-step="${s.id}">${esc(s.act)}</button>`}</div>
            </li>`;
          }).join('')}
        </ol>
        <h3 class="guide-h">매일 해 볼 것</h3>
        <ul class="guide-daily">${GUIDE_DAILY.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        ${
          pr.next
            ? `<button class="btn small guide-hide" data-hide>${guideHidden() ? '위쪽 안내 다시 띄우기' : '위쪽 안내 숨기기'}</button>`
            : ''
        }`;
    };
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const step = t.closest<HTMLElement>('[data-step]');
      if (step) {
        play('tap');
        doGuideStep(step.dataset.step as GuideStepId);
        return;
      }
      if (t.closest('[data-hide]')) {
        play('tap');
        setGuideHidden(!guideHidden());
        draw();
      }
    });
    draw();
    const off = onChange(draw);
    return () => {
      off();
    };
  },
};
