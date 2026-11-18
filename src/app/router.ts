// 화면 전환. 주소 뒤 #/ 로 화면을 정한다.
//   #/            지도 (판 없음)
//   #/move-in     입주 (입주했으면 내 입양 카드)
//   #/rank        지역 대항전
//   #/decorate    마당 꾸미기
//   #/house/12    12번지 구경 팝업
//   #/search      내 집 찾기 (아이디 검색)
//   #/settings    설정 (소리, 아이디 숨기기)
//   #/quests      퀘스트, 주민 부탁, 물고기 도감
//   #/shop        상점 (츄르로 꾸미기 아이템 사기)
//   #/draw/new    그림 그리기 (#/draw/그림id 는 따라 그리기)
//   #/npc/shop    주민에게 말 걸기 (shop, arcade, fisher, gardener, resident-12)
//   #/decorate/room  바로 집 안 꾸미기 (yard 는 마당)
//   #/board       마을 게시판 (2026-11-15)
//   #/friends     친구 목록, 받은 신청 (2026-11-15)
//   #/mail        우편함 (2026-11-16)
//   #/wish        소원 비는 곳 (2026-11-17)
//   #/report/12   신고 (번지 없이도 된다)
//   #/reclaim/아이디  내 인스타 아이디의 집 되찾기
//   #/admin       관리자 (ADMIN_KEY)
//   #/guide       처음 할 일 (입주한 사람에게, 2026-11-18)
// 지도(씬)는 항상 뒤에 깔려 있고, 다른 화면은 아래에서 올라오는 판으로 그 위에 뜬다. 뒤로 가기로 닫힌다.

export type ScreenId = 'map' | 'move-in' | 'rank' | 'decorate' | 'house' | 'search' | 'settings' | 'quests' | 'shop' | 'draw' | 'npc' | 'board' | 'friends' | 'mail' | 'wish' | 'report' | 'reclaim' | 'admin' | 'guide';
export interface Route {
  id: ScreenId;
  param: string | null;
}

const IDS: readonly ScreenId[] = ['map', 'move-in', 'rank', 'decorate', 'house', 'search', 'settings', 'quests', 'shop', 'draw', 'npc', 'board', 'friends', 'mail', 'wish', 'report', 'reclaim', 'admin', 'guide'];
const isScreen = (v: string): v is ScreenId => (IDS as readonly string[]).includes(v);

export function currentRoute(): Route {
  const [id, param] = location.hash.replace(/^#\/?/, '').split('/');
  return isScreen(id) ? { id, param: param ?? null } : { id: 'map', param: null };
}

export function go(id: ScreenId, param?: string | number): void {
  const next = id === 'map' ? '#/' : `#/${id}${param !== undefined ? `/${param}` : ''}`;
  if (location.hash !== next) location.hash = next;
}

export function onRoute(cb: (r: Route) => void): void {
  window.addEventListener('hashchange', () => cb(currentRoute()));
}
