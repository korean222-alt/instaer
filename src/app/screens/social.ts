// 소통 화면 (2026-11-15): 마을 게시판, 친구, 이장님 소식, 집 프로필(친구 신청, 방명록).
import { DECOR_SCORE_RULES, decorRank } from '../../shared/decorScore';
import { BOARD_MAX, BOARD_PER_DAY, GUESTBOOK_MAX } from '../../shared/social';
import { NEWS, latestNewsId } from '../../shared/news';
import { play } from '../audio/sound';
import {
  ApiError,
  deleteBoardPost,
  deleteGuestbook,
  fetchBoard,
  fetchFriends,
  fetchHouseSocial,
  friendAction,
  postBoard,
  postGuestbook,
  type FriendState,
  type Person,
  type Post,
} from '../net/api';
import { go } from '../router';
import { emit, state } from '../state';
import { catSvg } from '../ui/catSvg';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import type { Screen } from './types';

const ago = (at: number) => {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};
const fail = (e: unknown, fallback: string) => {
  play('error');
  toast(e instanceof ApiError ? e.message : fallback);
};
const who = (p: Person, key: string) => `<button class="who" data-house="${p.houseNo}">${catSvg(p.cat, 30, key)}<b>${esc(p.handle)}</b></button>`;

// ── 이장님 소식 ──
const SEEN_KEY = 'ci_news_seen';
export function newsUnseen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== latestNewsId();
  } catch {
    return false;
  }
}
export function markNewsSeen() {
  try {
    localStorage.setItem(SEEN_KEY, latestNewsId());
  } catch {
    /* 저장 막힘 */
  }
  emit();
}
export function newsHtml(): string {
  return `<ul class="news">${NEWS.map((n, i) => `<li${i === 0 ? ' class="new"' : ''}><small>${esc(n.date)}</small><b>${esc(n.title)}</b><p>${esc(n.body)}</p></li>`).join('')}</ul>`;
}

// ── 마을 게시판 ──
export const boardScreen: Screen = {
  id: 'board',
  title: '마을 게시판',
  render(root) {
    let posts: Post[] | null = null;
    const draw = () => {
      root.innerHTML = `
        <a class="btn wish-link" href="#/wish">⭐ 소원 비는 곳 <small>고양이섬에 생겼으면 하는 것</small></a>
        ${
          state.me
            ? `<form class="chat-form board-form"><input class="chat-in" maxlength="${BOARD_MAX}" placeholder="마을 고양이들에게 한마디 (${BOARD_MAX}자)" autocomplete="off" enterkeyhint="send" /><button class="btn small primary">붙이기</button></form>
               <p class="chat-note">하루 ${BOARD_PER_DAY}번까지 붙일 수 있어요. 섬의 모든 고양이가 봐요. 나쁜 말은 가려져요.</p>`
            : '<p class="note">입주하면 게시판에 글을 붙일 수 있어요.</p>'
        }
        ${
          posts === null
            ? '<p class="empty">불러오는 중...</p>'
            : posts.length
              ? `<ul class="posts">${posts
                  .map(
                    (p) => `<li>${who(p, `b${p.id}`)}<p>${esc(p.text)}</p><small>${ago(p.at)}${p.houseNo === state.me?.houseNo ? ` · <button class="link small" data-del="${p.id}">지우기</button>` : ''}</small></li>`,
                  )
                  .join('')}</ul>`
              : '<p class="empty">아직 붙은 글이 없어요. 첫 글을 붙여 보세요!</p>'
        }`;
    };
    const load = () =>
      fetchBoard()
        .then((r) => {
          posts = r.posts;
          draw();
        })
        .catch(() => {
          posts = [];
          draw();
          toast('게시판을 불러오지 못했어요');
        });
    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = root.querySelector<HTMLInputElement>('.chat-in');
      const text = input?.value.trim();
      if (!text) return;
      try {
        await postBoard(text);
        play('place');
        toast('게시판에 붙였어요');
        if (input) input.value = '';
        // 바로 보이게 내 글을 앞에 넣고, 서버 캐시가 풀린 뒤 다시 불러온다
        posts = [{ id: -Date.now(), text, at: Date.now() / 1000, houseNo: state.me!.houseNo, handle: state.me!.igHandle ?? '', cat: state.me!.cat ?? { fur: '#f4a650', pattern: 'cheese', eyeColor: '#7ac36a' } }, ...(posts ?? [])];
        draw();
      } catch (err) {
        fail(err, '붙이지 못했어요');
      }
    });
    root.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const h = t.closest<HTMLElement>('[data-house]');
      if (h) return go('house', Number(h.dataset.house));
      const d = t.closest<HTMLElement>('[data-del]');
      if (d) {
        const id = Number(d.dataset.del);
        try {
          if (id > 0) await deleteBoardPost(id);
          posts = (posts ?? []).filter((p) => p.id !== id);
          draw();
        } catch (err) {
          fail(err, '지우지 못했어요');
        }
      }
    });
    draw();
    void load();
  },
};

// ── 친구 ──
export const friendsScreen: Screen = {
  id: 'friends',
  title: '친구',
  render(root) {
    if (!state.me) {
      root.innerHTML = '<p class="empty">입주하면 친구를 사귈 수 있어요.<br />걷다가 지나가는 고양이를 누르면 프로필이 떠요.</p>';
      return;
    }
    let data: { friends: Person[]; incoming: Person[]; outgoing: Person[] } | null = null;
    const list = (people: Person[], kind: 'in' | 'friend' | 'out') =>
      `<ul class="people">${people
        .map(
          (p) => `<li>${who(p, `f${kind}${p.houseNo}`)}<div class="row-btns">${
            kind === 'in'
              ? `<button class="btn small primary" data-act="accept" data-no="${p.houseNo}">수락</button><button class="btn small" data-act="decline" data-no="${p.houseNo}">거절</button>`
              : kind === 'out'
                ? `<button class="btn small" data-act="decline" data-no="${p.houseNo}">신청 취소</button>`
                : `<button class="btn small" data-house="${p.houseNo}">집 가기</button>`
          }</div></li>`,
        )
        .join('')}</ul>`;
    const draw = () => {
      if (!data) {
        root.innerHTML = '<p class="empty">불러오는 중...</p>';
        return;
      }
      root.innerHTML = `
        ${data.incoming.length ? `<h3 class="sub">받은 친구 신청 ${data.incoming.length}</h3>${list(data.incoming, 'in')}` : ''}
        <h3 class="sub">내 친구 ${data.friends.length}</h3>
        ${data.friends.length ? list(data.friends, 'friend') : '<p class="note">아직 친구가 없어요. 걷다가 지나가는 고양이를 누르거나, 집을 눌러 프로필에서 친구 신청을 해 보세요.</p>'}
        ${data.outgoing.length ? `<h3 class="sub">보낸 신청 ${data.outgoing.length}</h3>${list(data.outgoing, 'out')}` : ''}
        <p class="chat-note">친구가 되면 서로의 집 방명록에 글을 남길 수 있어요.</p>`;
    };
    const load = () =>
      fetchFriends()
        .then((r) => {
          data = r;
          state.friendRequests = r.incoming.length;
          emit();
          draw();
        })
        .catch((e) => fail(e, '친구 목록을 불러오지 못했어요'));
    root.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const b = t.closest<HTMLButtonElement>('[data-act]');
      if (b) {
        b.disabled = true;
        try {
          const res = await friendAction(Number(b.dataset.no), b.dataset.act as 'accept' | 'decline');
          play(res.state === 'friends' ? 'fanfare' : 'tap');
          if (res.state === 'friends') toast('친구가 되었어요!');
          await load();
        } catch (err) {
          fail(err, '처리하지 못했어요');
          b.disabled = false;
        }
        return;
      }
      const h = t.closest<HTMLElement>('[data-house]');
      if (h) go('house', Number(h.dataset.house));
    });
    draw();
    void load();
  },
};

// ── 꾸미기 점수 (2026-11-18): 프로필(집 팝업)에서만 보인다 ──
function showDecorScore(box: HTMLElement, score: number | undefined, mine: boolean) {
  const el = box.parentElement?.querySelector<HTMLElement>('[data-score]');
  if (!el || typeof score !== 'number') return;
  const R = DECOR_SCORE_RULES;
  el.hidden = false;
  el.innerHTML = `<span class="ds-label">꾸미기 점수</span><b>${score.toLocaleString()}</b><span class="ds-rank">${esc(decorRank(score))}</span>
    ${mine ? `<small>가구 하나 ${R.item}점, 새 종류 +${R.variety}, 그림 붙인 가구 +${R.art}, 지붕 그림 ${R.roof}, 벽지/바닥 바꾸기 ${R.surface}</small>` : ''}`;
}

// ── 집 프로필: 친구 버튼 + 방명록 (houseScreen 안에 붙는다) ──
const FRIEND_BTN: Record<FriendState, string> = {
  self: '',
  none: '친구 신청',
  sent: '신청 보냄 (취소)',
  received: '친구 신청 수락',
  friends: '친구 ♥ (끊기)',
};
export function mountHouseSocial(box: HTMLElement, houseNo: number) {
  let st: FriendState = 'none';
  let count = 0;
  let book: Post[] | null = null;
  const draw = () => {
    const mine = st === 'self';
    const canWrite = mine || st === 'friends';
    box.innerHTML = `
      <div class="friend-row">
        <span class="badge">친구 ${count}명</span>
        ${state.me && !mine ? `<button class="btn small${st === 'none' || st === 'received' ? ' primary' : ''}" data-fr>${FRIEND_BTN[st]}</button>` : ''}
        ${st === 'received' ? '<button class="btn small" data-decline>거절</button>' : ''}
      </div>
      <h3 class="sub">방명록</h3>
      ${
        canWrite
          ? `<form class="chat-form gb-form"><input class="chat-in" maxlength="${GUESTBOOK_MAX}" placeholder="${mine ? '내 방명록에 한마디' : '친구에게 한마디'}" autocomplete="off" enterkeyhint="send" /><button class="btn small primary">남기기</button></form>`
          : `<p class="chat-note">${state.me ? '친구가 되면 방명록을 쓸 수 있어요.' : '입주하고 친구가 되면 방명록을 쓸 수 있어요.'}</p>`
      }
      ${
        book === null
          ? '<p class="empty small">불러오는 중...</p>'
          : book.length
            ? `<ul class="posts">${book
                .map(
                  (p) =>
                    `<li>${who(p, `g${p.id}`)}<p>${esc(p.text)}</p><small>${ago(p.at)}${mine || p.houseNo === state.me?.houseNo ? ` · <button class="link small" data-gdel="${p.id}">지우기</button>` : ''}</small></li>`,
                )
                .join('')}</ul>`
            : '<p class="empty small">아직 방명록이 비어 있어요.</p>'
      }`;
  };
  const load = () =>
    fetchHouseSocial(houseNo)
      .then((r) => {
        st = r.friendState;
        count = r.friendCount;
        showDecorScore(box, r.decorScore, st === 'self');
        book = r.guestbook;
        draw();
      })
      .catch(() => {
        book = [];
        draw();
      });
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = box.querySelector<HTMLInputElement>('.chat-in');
    const text = input?.value.trim();
    if (!text) return;
    try {
      await postGuestbook(houseNo, text);
      play('place');
      if (input) input.value = '';
      await load();
    } catch (err) {
      fail(err, '남기지 못했어요');
    }
  });
  box.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const h = t.closest<HTMLElement>('[data-house]');
    if (h && Number(h.dataset.house) !== houseNo) return go('house', Number(h.dataset.house));
    const fr = t.closest<HTMLButtonElement>('[data-fr], [data-decline]');
    if (fr) {
      const action = fr.hasAttribute('data-decline') ? 'decline' : st === 'none' ? 'request' : st === 'received' ? 'accept' : 'remove';
      if (action === 'remove' && st === 'friends' && !confirm('친구를 끊을까요?')) return;
      fr.disabled = true;
      try {
        const res = await friendAction(houseNo, action);
        st = res.state;
        if (st === 'friends') {
          play('fanfare');
          toast('친구가 되었어요!');
        } else if (st === 'sent') {
          play('ding');
          toast('친구 신청을 보냈어요. 상대가 수락하면 친구가 돼요');
        } else play('tap');
        await load();
      } catch (err) {
        fail(err, '처리하지 못했어요');
        fr.disabled = false;
      }
      return;
    }
    const gd = t.closest<HTMLElement>('[data-gdel]');
    if (gd) {
      try {
        await deleteGuestbook(Number(gd.dataset.gdel));
        await load();
      } catch (err) {
        fail(err, '지우지 못했어요');
      }
    }
  });
  draw();
  void load();
}
