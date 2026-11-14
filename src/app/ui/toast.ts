let el: HTMLElement | null = null;
let timer = 0;

/** 화면 아래쪽에 잠깐 뜨는 한 줄 알림 */
export function toast(text: string, ms = 2200) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.getElementById('app')!.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.classList.remove('show'), ms);
}
