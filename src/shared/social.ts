// 소통: 주변 채팅, 이모티콘, 춤, 친구, 방명록, 마을 게시판 (2026-11-15). 서버와 화면이 같이 쓴다.

/** 채팅 한 줄 최대 글자 수 */
export const CHAT_MAX = 40;
/** 같은 사람이 채팅을 보낼 수 있는 간격 (ms) */
export const CHAT_GAP_MS = 1200;
/** 이모티콘 간격 (ms) */
export const EMOTE_GAP_MS = 700;
/** 말풍선이 떠 있는 시간 (ms) */
export const BUBBLE_MS = 5000;

/** 이모티콘 (번호로 주고받는다. 순서를 바꾸지 않는다) */
export const EMOTES = ['❤️', '😺', '😂', '👋', '🎉', '😮', '😢', '💤', '✨', '🐟', '👍', '❓', '😡', '🥰', '🙏', '🔥'] as const;

export interface DanceDef {
  id: string;
  label: string;
  /** 츄르 */
  price: number;
  desc: string;
}
/** 춤 (상점에서 산다. 번호 = 순서 + 1 로 주고받는다. 순서를 바꾸지 않는다) */
export const DANCES: readonly DanceDef[] = [
  { id: 'wiggle', label: '엉덩이 씰룩', price: 40, desc: '좌우로 씰룩씰룩' },
  { id: 'hop', label: '깡총깡총', price: 90, desc: '제자리에서 통통 뛰어요' },
  { id: 'sway', label: '살랑살랑', price: 120, desc: '음악에 맞춰 천천히 흔들흔들' },
  { id: 'spin', label: '빙글빙글', price: 150, desc: '제자리에서 빙글빙글 돌아요' },
  { id: 'tap', label: '탭댄스', price: 220, desc: '발을 동동 구르며 탭댄스' },
  { id: 'twirl', label: '회오리 점프', price: 350, desc: '뛰어오르며 휘리릭 회전' },
];
export const danceDef = (id: string | null | undefined) => DANCES.find((d) => d.id === id);
/** 지갑 owned 에 넣는 이름 (가구 이름과 겹치지 않게) */
export const danceItem = (id: string) => `dance:${id}`;
export const danceIndex = (id: string | null | undefined) => (id ? DANCES.findIndex((d) => d.id === id) + 1 : 0);

// ── 친구, 방명록, 게시판 ──

/** 친구 수 상한 */
export const FRIEND_MAX = 100;
/** 방명록 한 줄 최대 글자 수, 집마다 보여 주는 수 */
export const GUESTBOOK_MAX = 60;
export const GUESTBOOK_SHOW = 30;
/** 마을 게시판 한 줄 최대 글자 수, 하루에 쓸 수 있는 수, 보여 주는 수 */
export const BOARD_MAX = 60;
export const BOARD_PER_DAY = 3;
export const BOARD_SHOW = 40;
