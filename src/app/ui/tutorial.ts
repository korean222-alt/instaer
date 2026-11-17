import { esc } from './dom';

const KEY = 'cat-island-tutorial-v1';
const STEPS = [
  { emoji: '🏝️', title: '고양이섬에 어서 와요', body: '인스타 친구들이 다 같이 사는 섬이에요.<br />집 한 채와 고양이 한 마리를 무료로 받아요.' },
  { emoji: '🏠', title: '내 집, 내 고양이', body: '아이디를 적고 사는 지역을 고르면 입주 끝!<br />집에는 내 인스타 아이디 이름표가 걸려요.' },
  { emoji: '🐾', title: '둘러보고 꾸며요', body: '걷기 버튼으로 섬을 돌아다니고,<br />마당을 꾸미고, 마음에 드는 집에 예뻐요를 눌러요.' },
];

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** 처음 온 사람에게 3장짜리 안내를 보여 주고, 끝나면(건너뛰어도) onDone 을 부른다 */
export function showTutorial(onDone: () => void) {
  let i = 0;
  const box = document.createElement('div');
  box.className = 'tutorial';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* 저장 못 해도 괜찮음 */
    }
    box.remove();
    onDone();
  };
  const draw = () => {
    const s = STEPS[i];
    const last = i === STEPS.length - 1;
    box.innerHTML = `
      <div class="tutorial-card">
        <div class="tutorial-emoji" aria-hidden="true">${s.emoji}</div>
        <h2>${esc(s.title)}</h2>
        <p>${s.body}</p>
        <div class="tutorial-dots" aria-hidden="true">${STEPS.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
        <button class="btn primary" data-next>${last ? '입주하러 가기' : '다음'}</button>
        ${last ? '' : '<button class="tutorial-skip" data-skip>건너뛰기</button>'}
      </div>`;
    box.querySelector('[data-next]')!.addEventListener('click', () => (last ? finish() : (i++, draw())));
    box.querySelector('[data-skip]')?.addEventListener('click', finish);
  };
  draw();
  document.getElementById('app')!.appendChild(box);
}
