// 방명록 알림창 (2026-11-19 사용자: "다른 사람이 내 집에 방명록 남기면 남겨 있다고 알림창").
// 접속할 때와 그 뒤 3분마다(화면이 보일 때만) 내 집 방명록의 새 글을 묻는다. 어디까지 봤는지는 이 브라우저에 기억한다.
// 미니게임이나 꾸미기 중에는 기다렸다가 끝나면 띄운다.
import { fetchMyGuestbookNew, type Post } from '../net/api';
import { play } from '../audio/sound';
import { go } from '../router';
import { state } from '../state';
import { esc } from '../ui/dom';

const POLL_MS = 3 * 60_000;
const key = (no: number) => `ci_gb_seen_${no}`;

function seen(no: number): number {
  try {
    return Number(localStorage.getItem(key(no))) || 0;
  } catch {
    return 0;
  }
}
function markSeen(no: number, id: number) {
  try {
    localStorage.setItem(key(no), String(id));
  } catch {
    /* 저장이 막힌 브라우저 */
  }
}

export function initGuestbookAlert() {
  const app = document.getElementById('app')!;
  const box = document.createElement('div');
  box.className = 'gb-alert';
  box.hidden = true;
  app.appendChild(box);
  let pending: { no: number; posts: Post[]; latest: number } | null = null;
  let busy = false;

  const blocked = () =>
    document.body.classList.contains('playing') ||
    document.body.classList.contains('decorating') ||
    document.body.classList.contains('cinema-mode') ||
    !!document.getElementById('sheet')?.classList.contains('open');

  function show() {
    if (!pending || !box.hidden || blocked()) return;
    const { no, posts, latest } = pending;
    pending = null;
    const list = posts
      .slice(0, 3)
      .map((p) => `<li><b>${esc(p.handle || '이웃')}</b><span>${esc(p.text)}</span></li>`)
      .join('');
    const more = posts.length > 3 ? `<p class="gb-more">그 밖에 ${posts.length - 3}개 더</p>` : '';
    box.innerHTML = `<div class="gb-card" role="dialog" aria-label="방명록 알림">
        <div class="gb-head"><span class="gb-icon">💌</span><b>우리 집 방명록에 새 글이 왔어요!</b></div>
        <ul>${list}</ul>${more}
        <div class="row-btns"><button class="btn small" data-x>닫기</button><button class="btn small primary" data-go>방명록 보기</button></div>
      </div>`;
    box.hidden = false;
    markSeen(no, latest);
    play('mew');
  }

  box.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-go]') && state.me) {
      box.hidden = true;
      play('open');
      go('house', state.me.houseNo);
    } else if (t.closest('[data-x]') || e.target === box) {
      box.hidden = true;
      play('close');
    }
  });

  async function check() {
    const no = state.me?.houseNo;
    if (!no || busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const after = seen(no);
      const r = await fetchMyGuestbookNew(after);
      if (r.posts.length && state.me?.houseNo === no) {
        pending = { no, posts: r.posts, latest: r.latest };
        show();
      }
    } catch {
      /* 다음에 다시 */
    } finally {
      busy = false;
    }
  }

  window.setInterval(check, POLL_MS);
  // 판이 닫히거나 미니게임이 끝나면 미뤄 둔 알림을 띄운다
  window.setInterval(show, 1500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  return { check };
}
