// 걷는 동안 소통 (2026-11-15): 주변 채팅, 이모티콘, 춤, 앉기.
// - 채팅은 서버가 내 둘레(NEARBY_RADIUS) 안 사람에게만 보낸다. 화면에 불러온(보이는) 고양이 말만 보인다.
// - 말풍선과 이모티콘은 씬 catScreenPos 로 고양이 머리 위 자리를 받아 DOM 으로 띄운다.
// - 춤은 상점처럼 츄르로 사서 배운다 (지갑 owned 'dance:id'). 걸으면 멈춘다.
import { benchNear, type IslandScene } from '../../scene';
import { CURRENCY } from '../../shared/economy';
import { cleanChat } from '../../shared/handle';
import { BUBBLE_MS, CHAT_GAP_MS, CHAT_MAX, DANCES, danceItem, EMOTES, EMOTE_GAP_MS } from '../../shared/social';
import type { LocalState } from '../../shared/types';
import { play } from '../audio/sound';
import { ApiError, buyItem } from '../net/api';
import type { Realtime } from '../net/realtime';
import { state } from '../state';
import { esc } from '../ui/dom';
import { toast } from '../ui/toast';
import { applyWallet, coins } from '../wallet';

export interface Social {
  /** 걷기를 켜고 끌 때 */
  setWalking(on: boolean): void;
  onChat(id: string, text: string): void;
  onEmote(id: string, e: number): void;
  /** 내 고양이가 움직일 때 (걸으면 춤, 앉기를 멈춘다) */
  onLocalMove(s: LocalState): void;
  close(): void;
}

type Tab = 'chat' | 'emote' | 'dance';
interface Bubble {
  el: HTMLElement;
  who: string | null;
  until: number;
}
interface LogLine {
  who: string;
  mine: boolean;
  text: string;
}

export function createSocial(scene: IslandScene, realtime: Realtime, icon: (n: string) => string): Social {
  const app = document.getElementById('app')!;
  const layer = document.createElement('div');
  layer.className = 'bubble-layer';
  app.appendChild(layer);

  const btn = document.createElement('button');
  btn.className = 'social-btn';
  btn.hidden = true;
  btn.setAttribute('aria-label', '채팅, 이모티콘, 춤');
  btn.innerHTML = `${icon('chat')}<span>소통</span>`;
  app.appendChild(btn);

  const panel = document.createElement('section');
  panel.className = 'social';
  panel.hidden = true;
  app.appendChild(panel);

  let walking = false;
  let tab: Tab = 'chat';
  let dancing: string | null = null;
  let sitting = false;
  let lastChat = 0;
  let lastEmote = 0;
  const log: LogLine[] = [];
  const bubbles: Bubble[] = [];
  let raf = 0;

  const nameOf = (id: string) => realtime.playerInfo(id)?.handle ?? '고양이';

  // ── 말풍선 ──
  function bubble(who: string | null, html: string, kind: 'chat' | 'emote') {
    // 한 고양이에 같은 종류는 하나만 (새 말이 오면 바꾼다)
    for (let i = bubbles.length - 1; i >= 0; i--)
      if (bubbles[i].who === who && bubbles[i].el.classList.contains(kind)) {
        bubbles[i].el.remove();
        bubbles.splice(i, 1);
      }
    const el = document.createElement('div');
    el.className = `bub ${kind}`;
    el.innerHTML = html;
    layer.appendChild(el);
    bubbles.push({ el, who, until: performance.now() + (kind === 'chat' ? BUBBLE_MS : 2600) });
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    raf = 0;
    const now = performance.now();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const pos = walking ? scene.catScreenPos(b.who) : null;
      if (now > b.until || (!pos && b.who !== null && !realtime.playerInfo(b.who))) {
        b.el.remove();
        bubbles.splice(i, 1);
        continue;
      }
      if (!pos) {
        b.el.style.opacity = '0';
        continue;
      }
      const lift = b.el.classList.contains('emote') ? 34 : 0;
      b.el.style.opacity = now > b.until - 400 ? String(Math.max(0, (b.until - now) / 400)) : '1';
      b.el.style.transform = `translate(${pos.x.toFixed(1)}px, ${(pos.y - lift).toFixed(1)}px) translate(-50%, -100%)`;
    }
    if (bubbles.length) raf = requestAnimationFrame(tick);
  }

  function addLog(line: LogLine) {
    log.push(line);
    if (log.length > 40) log.shift();
    if (!panel.hidden && tab === 'chat') drawLog();
  }

  // ── 판 ──
  function draw() {
    const owned = (id: string) => !!state.wallet?.data.owned.includes(danceItem(id));
    const tabs = (['chat', 'emote', 'dance'] as Tab[])
      .map((t) => `<button class="seg-btn${t === tab ? ' on' : ''}" data-tab="${t}">${t === 'chat' ? '채팅' : t === 'emote' ? '이모티콘' : '춤'}</button>`)
      .join('');
    let body = '';
    if (tab === 'chat') {
      body = `
        <ul class="chat-log" aria-live="polite"></ul>
        <form class="chat-form"><input class="chat-in" maxlength="${CHAT_MAX}" placeholder="주변 고양이에게 한마디" autocomplete="off" enterkeyhint="send" /><button class="btn small primary">보내기</button></form>
        <p class="chat-note">내 주변에 보이는 고양이에게만 보여요. 멀리 있거나 아직 안 불러온 고양이는 못 봐요.</p>`;
    } else if (tab === 'emote') {
      body = `<div class="emote-grid">${EMOTES.map((e, i) => `<button class="emote" data-emote="${i}" aria-label="이모티콘 ${i + 1}">${e}</button>`).join('')}</div>
        <div class="row"><button class="btn small" data-act="sit">${sitting ? '일어나기' : benchNear(scene.getLocalState().x, scene.getLocalState().z, 2.4) ? '벤치에 앉기' : '앉기'}</button></div>`;
    } else {
      body = `<ul class="dance-list">${DANCES.map((d) => {
        const have = owned(d.id);
        const on = dancing === d.id;
        return `<li><div><b>${esc(d.label)}</b><small>${esc(d.desc)}</small></div>${
          have
            ? `<button class="btn small${on ? '' : ' primary'}" data-dance="${d.id}">${on ? '멈추기' : '추기'}</button>`
            : `<button class="btn small" data-buy="${d.id}">${d.price} ${CURRENCY}에 배우기</button>`
        }</li>`;
      }).join('')}</ul>
        <p class="chat-note">${state.me ? `가진 ${CURRENCY} ${coins().toLocaleString()} · 춤은 한 번 배우면 계속 출 수 있어요. 걸으면 멈춰요.` : '입주하면 춤을 배울 수 있어요.'}</p>`;
    }
    panel.innerHTML = `<div class="social-head"><div class="seg">${tabs}</div><button class="close" data-act="close" aria-label="닫기">${icon('close')}</button></div>${body}`;
    if (tab === 'chat') drawLog();
  }
  function drawLog() {
    const ul = panel.querySelector('.chat-log');
    if (!ul) return;
    ul.innerHTML = log.length
      ? log.slice(-30).map((l) => `<li${l.mine ? ' class="mine"' : ''}><b>${esc(l.who)}</b> ${esc(l.text)}</li>`).join('')
      : `<li class="empty-log">${state.me ? (realtime.connected() ? '주변 고양이에게 인사해 보세요' : '지금은 주변에 연결되지 않았어요 (혼자 둘러보는 중)') : '입주하면 주변 고양이와 이야기할 수 있어요'}</li>`;
    ul.scrollTop = ul.scrollHeight;
  }

  function open(on: boolean) {
    panel.hidden = !on;
    document.body.classList.toggle('social-open', on);
    if (on) {
      btn.classList.remove('new');
      play('open');
      draw();
    }
  }

  function sendChat(raw: string) {
    if (!state.me) return toast('입주하면 채팅할 수 있어요');
    const now = Date.now();
    if (now - lastChat < CHAT_GAP_MS) return toast('조금 천천히 말해 주세요');
    const text = cleanChat(raw, CHAT_MAX);
    if (!text) return toast('보낼 수 없는 말이에요');
    lastChat = now;
    const ok = realtime.sendChat(text);
    bubble(null, esc(text), 'chat');
    addLog({ who: '나', mine: true, text });
    play('tap');
    if (!ok) toast('주변에 연결되지 않아서 나만 보여요');
  }

  function setDance(id: string | null) {
    dancing = id;
    scene.setDance(id);
    realtime.setDance(id);
    if (id && sitting) setSit(false);
  }
  function setSit(on: boolean) {
    sitting = on;
    scene.setSitting(on);
    if (on) {
      if (dancing) setDance(null);
      const me = scene.getLocalState();
      const b = benchNear(me.x, me.z, 2.4);
      // 벤치 앞에 벤치를 등지고 선다 (벤치는 막혀 있어서 바로 앞이 가장 가까운 빈 곳)
      if (b) scene.setLocalPosition(b.x + Math.sin(b.rot) * 0.55, b.z + Math.cos(b.rot) * 0.55, b.rot);
    }
  }

  btn.addEventListener('click', () => open(!!panel.hidden));
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = panel.querySelector<HTMLInputElement>('.chat-in');
    if (!input || !input.value.trim()) return;
    sendChat(input.value);
    input.value = '';
  });
  panel.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const tb = t.closest<HTMLElement>('[data-tab]');
    if (tb) {
      tab = tb.dataset.tab as Tab;
      play('tap');
      draw();
      return;
    }
    if (t.closest('[data-act="close"]')) return open(false);
    if (t.closest('[data-act="sit"]')) {
      setSit(!sitting);
      play('tap');
      draw();
      return;
    }
    const em = t.closest<HTMLElement>('[data-emote]');
    if (em) {
      const n = Number(em.dataset.emote);
      const now = Date.now();
      if (now - lastEmote < EMOTE_GAP_MS) return;
      lastEmote = now;
      bubble(null, EMOTES[n], 'emote');
      if (state.me) realtime.sendEmote(n);
      play('tap');
      return;
    }
    const dn = t.closest<HTMLElement>('[data-dance]');
    if (dn) {
      const id = dn.dataset.dance!;
      setDance(dancing === id ? null : id);
      play(dancing ? 'fanfare' : 'tap');
      draw();
      return;
    }
    const by = t.closest<HTMLButtonElement>('[data-buy]');
    if (by) {
      if (!state.me) return toast('입주하면 춤을 배울 수 있어요');
      const d = DANCES.find((x) => x.id === by.dataset.buy);
      if (!d) return;
      if (coins() < d.price) {
        play('error');
        return toast(`${CURRENCY}가 ${d.price - coins()}개 모자라요`);
      }
      by.disabled = true;
      try {
        const res = await buyItem(danceItem(d.id));
        applyWallet(res.wallet, { silent: true });
        play('fanfare');
        toast(`${d.label} 춤을 배웠어요!`);
        setDance(d.id);
      } catch (err) {
        play('error');
        toast(err instanceof ApiError ? err.message : '배우지 못했어요');
      }
      draw();
    }
  });

  return {
    setWalking(on) {
      walking = on;
      btn.hidden = !on;
      if (!on) {
        open(false);
        setDance(null);
        if (sitting) setSit(false);
        for (const b of bubbles) b.el.remove();
        bubbles.length = 0;
      }
    },
    onChat(id, text) {
      bubble(id, esc(text), 'chat');
      addLog({ who: nameOf(id), mine: false, text });
      if (panel.hidden) btn.classList.add('new');
    },
    onEmote(id, e) {
      const emo = EMOTES[e];
      if (emo) bubble(id, emo, 'emote');
    },
    onLocalMove(s) {
      if (s.anim !== 'walk' && s.anim !== 'jump') return;
      if (dancing && s.anim === 'walk') {
        setDance(null);
        if (!panel.hidden && tab === 'dance') draw();
      }
      if (sitting) {
        setSit(false);
        if (!panel.hidden && tab === 'emote') draw();
      }
    },
    close: () => open(false),
  };
}
