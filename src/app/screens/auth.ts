// 인스타 인증 주변 화면 (2026-11-17): 되찾기, 신고, 소원 비는 곳, 관리자.
import { igIdProblem, normalizeIgId, REPORT_KINDS, REPORT_MAX, WISH_MAX, WISH_PER_DAY, type ReportKind } from '../../shared/auth';
import { FOLLOW_HANDLE } from '../../shared/config';
import { play } from '../audio/sound';
import { adminCall, ApiError, fetchWishes, postWish, reclaimPoll, reclaimStart, saveToken, sendReport, type Wish } from '../net/api';
import { go } from '../router';
import { setMe, state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { refreshWallet } from '../wallet';
import type { Screen } from './types';

const msgOf = (e: unknown, fallback = '잠시 문제가 생겼어요') => (e instanceof ApiError ? e.message : fallback);
const ago = (at: number) => {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};
const igUrl = () => `https://www.instagram.com/${encodeURIComponent(FOLLOW_HANDLE)}/`;

// ── 되찾기: 코드를 그 아이디로 댓글에 남기면 집을 돌려받는다 ──
export const reclaimScreen: Screen = {
  id: 'reclaim',
  title: '내 집 되찾기',
  render(root, param) {
    let timer = 0;
    let alive = true;
    const askId = () => {
      root.innerHTML = `
        <p class="lead">누가 내 인스타 아이디로 먼저 가입했나요?<br />아래 순서대로 하면 그 집을 <b>내가</b> 돌려받아요.</p>
        <form class="form" novalidate>
          <label class="field"><span>내 인스타 아이디</span>
            <input name="ig" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="31" placeholder="mochi_nyang" value="${esc(param ? decodeURIComponent(param) : '')}" /></label>
          <button class="btn primary" type="submit">되찾기 코드 받기</button>
        </form>
        <p class="note">코드는 내 아이디로 단 댓글로만 확인돼요. 남은 내 아이디로 댓글을 달 수 없으니 안전해요.</p>
        <p class="note"><button class="link small" data-act="report">대신 신고하기</button></p>`;
      root.querySelector('[data-act="report"]')?.addEventListener('click', () => go('report'));
      root.querySelector('form')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ig = normalizeIgId(root.querySelector<HTMLInputElement>('input[name="ig"]')!.value);
        const p = igIdProblem(ig);
        if (p) return toast(p);
        try {
          const r = await reclaimStart(ig);
          play('ding');
          wait(r.code, r.igId, r.houseNo, r.expiresIn);
        } catch (err) {
          play('error');
          toast(msgOf(err), 3200);
        }
      });
    };
    const wait = (code: string, igId: string, houseNo: number, expiresIn: number) => {
      const until = Date.now() + expiresIn * 1000;
      root.innerHTML = `
        <p class="lead"><b>@${esc(igId)}</b> 아이디로 고양이섬 릴스에 아래 코드를 <b>댓글</b>로 남겨 주세요.</p>
        <div class="code-big" aria-label="되찾기 코드">${esc(code)}</div>
        <div class="row two">
          <button class="btn" data-act="copy">코드 복사</button>
          <a class="btn primary" href="${igUrl()}" target="_blank" rel="noopener noreferrer">인스타 열기</a>
        </div>
        <p class="note" data-status><i class="spin" aria-hidden="true"></i> 댓글을 기다리는 중이에요. 이 화면을 열어 두세요 (보통 1분 안, 늦으면 5분).</p>
        <p class="note">${houseNo}번지를 돌려받으면 다른 폰에 된 로그인은 모두 끊겨요.</p>`;
      root.querySelector('[data-act="copy"]')!.addEventListener('click', () => {
        navigator.clipboard?.writeText(code).then(
          () => toast('복사했어요'),
          () => toast('길게 눌러서 복사해 주세요'),
        );
      });
      const status = root.querySelector<HTMLElement>('[data-status]')!;
      const tick = async () => {
        if (!alive) return;
        if (Date.now() > until) {
          status.textContent = '시간이 지났어요. 처음부터 다시 해 주세요.';
          return;
        }
        try {
          const r = await reclaimPoll(code);
          if (!r.pending && r.token && r.house) {
            saveToken(r.token);
            state.hideHandle = !!r.hideHandle;
            setMe(r.house);
            void refreshWallet();
            play('fanfare');
            toast(`${r.house.houseNo}번지를 되찾았어요!`, 3000);
            state.scene.focusHouse(r.house.houseNo);
            go('move-in');
            return;
          }
        } catch (err) {
          if (err instanceof ApiError && err.code === 'expired') {
            status.textContent = err.message;
            return;
          }
        }
        timer = window.setTimeout(tick, 6000);
      };
      timer = window.setTimeout(tick, 4000);
    };
    askId();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  },
};

// ── 신고 ──
export const reportScreen: Screen = {
  id: 'report',
  title: '신고하기',
  render(root, param) {
    const houseNo = param && /^\d+$/.test(param) ? Number(param) : null;
    const start: ReportKind = houseNo ? 'house' : 'stolen';
    root.innerHTML = `
      <form class="form" novalidate>
        <label class="field"><span>무엇을 신고할까요?</span>
          <select name="kind">${REPORT_KINDS.map((k) => `<option value="${k.id}" ${k.id === start ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
        <label class="field"><span>번지 <small>모르면 비워 두세요</small></span>
          <input name="house" class="input" inputmode="numeric" maxlength="7" value="${houseNo ?? ''}" placeholder="12" /></label>
        <label class="field"><span>내 인스타 아이디 <small data-ig-note></small></span>
          <input name="ig" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="31" placeholder="mochi_nyang" /></label>
        <label class="field"><span>연락받을 곳 <small>선택 · 인스타 DM 이면 비워 두세요</small></span>
          <input name="contact" class="input" maxlength="60" autocomplete="off" /></label>
        <label class="field"><span>자세히 <small>${REPORT_MAX}자</small></span>
          <textarea name="text" class="input" rows="4" maxlength="${REPORT_MAX}" placeholder="언제부터, 무엇이 문제인지 적어 주세요"></textarea></label>
        <button class="btn primary" type="submit">신고 보내기</button>
      </form>
      <div class="stolen-tip"></div>`;
    const form = root.querySelector('form')!;
    const kind = form.querySelector<HTMLSelectElement>('select')!;
    const tip = root.querySelector<HTMLElement>('.stolen-tip')!;
    const igNote = root.querySelector<HTMLElement>('[data-ig-note]')!;
    const sync = () => {
      const stolen = kind.value === 'stolen';
      igNote.textContent = stolen ? '꼭 적어 주세요' : '선택';
      tip.innerHTML = stolen
        ? `<p class="note">기다리기 싫다면 <button class="link small" data-act="reclaim">지금 바로 되찾기</button> 를 해 보세요. 내 아이디로 댓글 하나만 달면 돼요.</p>`
        : '';
    };
    kind.addEventListener('change', sync);
    sync();
    tip.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="reclaim"]')) {
        const ig = normalizeIgId(form.querySelector<HTMLInputElement>('input[name="ig"]')!.value);
        go('reclaim', ig ? encodeURIComponent(ig) : undefined);
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (n: string) => (form.querySelector<HTMLInputElement>(`[name="${n}"]`)!.value ?? '').trim();
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      btn.disabled = true;
      try {
        await sendReport({
          kind: kind.value as ReportKind,
          houseNo: /^\d+$/.test(v('house')) ? Number(v('house')) : null,
          igId: v('ig'),
          contact: v('contact'),
          text: v('text'),
        });
        play('ding');
        root.innerHTML = '<p class="lead"><b>신고를 받았어요.</b><br />운영자가 확인하고 고칠게요. 고마워요!</p>';
      } catch (err) {
        play('error');
        toast(msgOf(err), 3200);
        btn.disabled = false;
      }
    });
  },
};

// ── 소원 비는 곳: 내 소원 빌기 (2026-11-19 사용자: 섬에 생겼으면 하는 것이 아니라 개인 소원) ──
export const wishScreen: Screen = {
  id: 'wish',
  title: '소원 비는 곳',
  render(root) {
    let wishes: Wish[] | null = null;
    const draw = () => {
      root.innerHTML = `
        <p class="lead">마음속 소원을 하나 빌어 보세요 ✨<br /><small>섬 고양이들이 같이 빌어 줄게요.</small></p>
        <form class="chat-form wish-form"><input class="chat-in" maxlength="${WISH_MAX}" placeholder="예) 이번 시험 꼭 붙게 해 주세요 (${WISH_MAX}자)" autocomplete="off" enterkeyhint="send" /><button class="btn small primary">빌기</button></form>
        <p class="chat-note">하루 ${WISH_PER_DAY}번까지 빌 수 있어요. 모두에게 보여요.</p>
        ${
          wishes === null
            ? '<p class="empty">불러오는 중...</p>'
            : wishes.length
              ? `<ul class="posts wishes">${wishes
                  .map((w) => `<li><p>⭐ ${esc(w.text)}</p><small>${w.handle ? `${esc(w.handle)} · ` : ''}${ago(w.at)}</small></li>`)
                  .join('')}</ul>`
              : '<p class="empty">아직 빈 소원이 없어요. 첫 소원을 빌어 보세요!</p>'
        }`;
    };
    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = root.querySelector<HTMLInputElement>('.chat-in');
      const text = input?.value.trim();
      if (!text) return;
      try {
        await postWish(text);
        play('fanfare');
        toast('소원을 빌었어요');
        wishes = [{ id: -Date.now(), text, at: Date.now() / 1000, houseNo: state.me?.houseNo ?? null, handle: state.me?.igHandle ?? null }, ...(wishes ?? [])];
        draw();
      } catch (err) {
        play('error');
        toast(msgOf(err, '빌지 못했어요'));
      }
    });
    draw();
    fetchWishes()
      .then((r) => {
        wishes = r.wishes;
        draw();
      })
      .catch(() => {
        wishes = [];
        draw();
      });
  },
};

// ── 관리자: 입주 방식, 팔로워 암호, 인스타 토큰, 신고, 가입 기록, 소원 ──
interface AdminState {
  mode: string;
  password: string;
  passwordAt: number | null;
  token: 'db' | 'secret' | 'none';
  tokenAt: number | null;
  tokenRefresh: { ok: boolean; at: number } | null;
  lastSync: number | null;
  syncError: string | null;
  comments: { n: number; last: number | null } | null;
  reports: Array<{ id: number; kind: string; house_no: number | null; ig_id: string | null; contact: string | null; text: string; status: number; created_at: number }>;
  signups: Array<{ house_no: number; ig_id: string | null; kind: string; device: string | null; ip_hash: string | null; at: number }>;
  wishes: Array<{ id: number; text: string; hidden: number; created_at: number }>;
}
const ADMIN_LS = 'ci_admin';
export const adminScreen: Screen = {
  id: 'admin',
  title: '관리자',
  render(root) {
    let key = '';
    try {
      key = localStorage.getItem(ADMIN_LS) ?? '';
    } catch {
      /* 저장 막힘 */
    }
    const login = (msg = '') => {
      root.innerHTML = `<form class="form"><label class="field"><span>관리자 키</span><input class="input" type="password" name="k" autocomplete="off" /></label>
        <button class="btn primary">열기</button>${msg ? `<p class="note">${esc(msg)}</p>` : ''}</form>`;
      root.querySelector('form')!.addEventListener('submit', (e) => {
        e.preventDefault();
        key = root.querySelector<HTMLInputElement>('input')!.value.trim();
        try {
          localStorage.setItem(ADMIN_LS, key);
        } catch {
          /* 이 화면에서만 */
        }
        void load();
      });
    };
    const time = (t: number | null) => (t ? ago(t) : '없음');
    const draw = (s: AdminState) => {
      const kindLabel = (k: string) => REPORT_KINDS.find((x) => x.id === k)?.label ?? k;
      root.innerHTML = `
        <div class="set-group">
          <label class="field"><span>입주 방식</span><select name="mode">
            <option value="off">off: 닉네임만 (예전 방식, 인증 없음)</option>
            <option value="password">password: 인스타 아이디 + 팔로워 암호</option>
            <option value="comment">comment: 아이디 + 암호 + 댓글 확인 (권장)</option>
          </select></label>
          <label class="field"><span>팔로워 암호 <small>키티챗 DM 에 넣은 것과 똑같이 · 바꾼 지 ${time(s.passwordAt)}</small></span>
            <input class="input" name="pw" value="${esc(s.password)}" maxlength="30" autocomplete="off" /></label>
          <button class="btn primary" data-act="save">저장</button>
        </div>
        <div class="set-group">
          <div class="set-row"><span>인스타 토큰</span><b>${s.token === 'none' ? '없음' : s.token === 'db' ? `있음 (${time(s.tokenAt)} 넣음)` : '있음 (secret)'}</b></div>
          <div class="set-row"><span>토큰 자동 갱신</span><b>${s.tokenRefresh ? (s.tokenRefresh.ok ? `성공 ${time(s.tokenRefresh.at)}` : `실패 ${time(s.tokenRefresh.at)}`) : '아직'}</b></div>
          <div class="set-row"><span>마지막 댓글 읽기</span><b>${time(s.lastSync)}</b></div>
          <div class="set-row"><span>저장된 댓글</span><b>${s.comments?.n ?? 0}개 · 최근 ${time(s.comments?.last ?? null)}</b></div>
          ${s.syncError ? `<p class="note bad">오류: ${esc(s.syncError)}</p>` : ''}
          <label class="field"><span>새 토큰 넣기 <small>Meta 개발자 앱에서 받은 장기 토큰. 채팅에 붙이지 말고 여기에만</small></span>
            <input class="input" name="token" type="password" autocomplete="off" /></label>
          <div class="row two"><button class="btn" data-act="token">토큰 저장</button><button class="btn" data-act="sync">지금 댓글 읽기</button></div>
        </div>
        <h3>신고</h3>
        ${
          s.reports.length
            ? `<ul class="posts">${s.reports
                .map(
                  (r) => `<li class="${r.status ? 'done' : ''}"><b>${esc(kindLabel(r.kind))}</b>
                <p>${r.house_no ? `${r.house_no}번지 · ` : ''}${r.ig_id ? `@${esc(r.ig_id)} · ` : ''}${r.contact ? `연락: ${esc(r.contact)} · ` : ''}${esc(r.text)}</p>
                <small>${ago(r.created_at)}${r.status ? ' · 처리함' : ` · <button class="link small" data-resolve="${r.id}">처리함</button>`}${
                  r.house_no ? ` · <button class="link small" data-free="${r.house_no}">${r.house_no}번지 인스타 아이디 비우기</button>` : ''
                }</small></li>`,
                )
                .join('')}</ul>`
            : '<p class="empty">신고 없음</p>'
        }
        <h3>최근 가입/되찾기</h3>
        <ul class="posts">${s.signups
          .map((g) => `<li><p>${g.house_no}번지 · ${g.ig_id ? `@${esc(g.ig_id)}` : '(아이디 없음)'} · ${g.kind === 'reclaim' ? '되찾기' : '가입'}</p><small>${ago(g.at)} · 기기 ${esc((g.device ?? '-').slice(0, 6))} · ip ${esc((g.ip_hash ?? '-').slice(0, 6))}</small></li>`)
          .join('')}</ul>
        <h3>소원</h3>
        <ul class="posts">${s.wishes
          .map((w) => `<li class="${w.hidden ? 'done' : ''}"><p>${esc(w.text)}</p><small>${ago(w.created_at)} · <button class="link small" data-hide="${w.id}">${w.hidden ? '다시 보이기' : '숨기기'}</button></small></li>`)
          .join('')}</ul>
        <p class="note"><button class="link small" data-act="logout">관리자 키 지우기</button></p>`;
      root.querySelector<HTMLSelectElement>('select[name="mode"]')!.value = s.mode;
    };
    const act = async (body: Record<string, unknown>, done: string) => {
      try {
        const r = await adminCall<{ ok: true; result?: { error?: string; added?: number } }>(key, body);
        toast(r.result ? (r.result.error ? `오류: ${r.result.error}` : `새 댓글 ${r.result.added ?? 0}개`) : done, 3000);
        void load();
      } catch (err) {
        toast(msgOf(err), 3000);
      }
    };
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const b = t.closest<HTMLElement>('[data-act], [data-resolve], [data-hide], [data-free]');
      if (!b) return;
      const val = (n: string) => root.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value ?? '';
      if (b.dataset.act === 'save') void act({ action: 'settings', mode: val('mode'), password: val('pw') }, '저장했어요');
      else if (b.dataset.act === 'token') void act({ action: 'settings', token: val('token') }, '토큰을 저장했어요');
      else if (b.dataset.act === 'sync') void act({ action: 'sync' }, '읽었어요');
      else if (b.dataset.act === 'logout') {
        try {
          localStorage.removeItem(ADMIN_LS);
        } catch {
          /* 무시 */
        }
        login();
      } else if (b.dataset.resolve) void act({ action: 'resolve', id: Number(b.dataset.resolve) }, '처리했어요');
      else if (b.dataset.hide) void act({ action: 'hide-wish', id: Number(b.dataset.hide) }, '바꿨어요');
      else if (b.dataset.free && confirm(`${b.dataset.free}번지의 인스타 아이디를 비우고 로그인을 끊을까요? 진짜 주인이 다시 가입할 수 있게 돼요`)) {
        void act({ action: 'free-ig', houseNo: Number(b.dataset.free) }, '비웠어요');
      }
    });
    const load = async () => {
      if (!key) return login();
      try {
        draw(await adminCall<AdminState>(key));
      } catch (err) {
        login(msgOf(err));
      }
    };
    void load();
  },
};
