// 화면 전환. 주소 뒤 #/ 로 화면을 정한다 (#/map, #/move-in, #/rank, #/decorate).
// 지도(씬)는 항상 뒤에 깔려 있고, 다른 화면은 아래에서 올라오는 판으로 그 위에 뜬다.

export type ScreenId = 'map' | 'move-in' | 'rank' | 'decorate';

export const SCREEN_IDS: readonly ScreenId[] = ['map', 'move-in', 'rank', 'decorate'];

const isScreen = (v: string): v is ScreenId => (SCREEN_IDS as readonly string[]).includes(v);

export function currentScreen(): ScreenId {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  return isScreen(id) ? id : 'map';
}

export function go(id: ScreenId): void {
  const next = id === 'map' ? '#/' : `#/${id}`;
  if (location.hash !== next) location.hash = next;
}

export function onRoute(cb: (id: ScreenId) => void): void {
  window.addEventListener('hashchange', () => cb(currentScreen()));
}
