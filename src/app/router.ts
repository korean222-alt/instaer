// 화면 전환. 주소 뒤 #/ 로 화면을 정한다.
//   #/            지도 (판 없음)
//   #/move-in     입주 (입주했으면 내 입양 카드)
//   #/rank        지역 대항전
//   #/decorate    마당 꾸미기
//   #/house/12    12번지 구경 팝업
//   #/search      내 집 찾기 (아이디 검색)
// 지도(씬)는 항상 뒤에 깔려 있고, 다른 화면은 아래에서 올라오는 판으로 그 위에 뜬다. 뒤로 가기로 닫힌다.

export type ScreenId = 'map' | 'move-in' | 'rank' | 'decorate' | 'house' | 'search';
export interface Route {
  id: ScreenId;
  param: string | null;
}

const IDS: readonly ScreenId[] = ['map', 'move-in', 'rank', 'decorate', 'house', 'search'];
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
