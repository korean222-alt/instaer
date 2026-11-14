import { REGIONS } from '../../shared/config';
import type { Screen } from './types';

// 단계 A 에서 실제 입주(POST /api/move-in)를 붙인다. 지금은 모양만.
export const moveInScreen: Screen = {
  id: 'move-in',
  title: '입주하기',
  render(root) {
    const options = REGIONS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('');
    root.innerHTML = `
      <p class="lead">집 한 채와 고양이 한 마리를 무료로 받아요.<br />집에는 내 인스타 아이디 이름표가 걸려요.</p>
      <form class="form" onsubmit="return false">
        <label class="field">
          <span>인스타 아이디</span>
          <input name="handle" type="text" inputmode="latin" autocomplete="off" autocapitalize="off"
                 spellcheck="false" maxlength="30" placeholder="예: mochi_nyang" disabled />
        </label>
        <label class="field">
          <span>사는 지역 <small>한 번 정하면 못 바꿔요</small></span>
          <select name="region" disabled>${options}</select>
        </label>
        <button class="btn primary" type="submit" disabled>입주하기</button>
      </form>
      <p class="note">입주 신청은 곧 열려요.</p>`;
  },
};
