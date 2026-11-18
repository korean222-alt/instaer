// 이사 (2026-11-18 사용자 요청: "집 못 옮기나요, 트리 있는 집에서 살고 싶은데").
// 설정의 "이사하기" 또는 빈 집 팝업의 "이 집으로 이사하기"로 연다. 첫 이사는 무료, 그다음부터 MOVE_HOUSE_COST 츄르.
// 마당/집 안/지붕 그림/넓히기는 서버에서 집(id)에 붙어 있어서 그대로 따라온다.
import { FOUNDER_MAX } from '../../shared/config';
import { CURRENCY, MOVE_HOUSE_COST } from '../../shared/economy';
import { maxPickableHouseNo } from '../../shared/zones';
import { syncArt } from '../art';
import { play } from '../audio/sound';
import { ApiError, moveMyHouse } from '../net/api';
import { go, onRoute } from '../router';
import { moveMyHouseLocal, state } from '../state';
import { toast } from '../ui/toast';
import { applyWallet, coins } from '../wallet';

let picking = false;
let banner: HTMLElement | null = null;
let busy = false;

/** 섬에서 이사할 집을 고르는 중인지 */
export const pickingMove = () => picking && !!state.me;
/** 이번 이사가 무료인지 */
export const moveIsFree = () => !state.wallet?.data.owned.includes('moved_once');
export const moveCostLabel = () => (moveIsFree() ? '첫 이사 무료' : `${MOVE_HOUSE_COST} ${CURRENCY}`);

/** 내가 이 빈 집으로 이사할 수 있는지. 안 되면 이유 */
export function moveProblem(no: number): string | null {
  const me = state.me;
  if (!me) return '입주한 뒤에 이사할 수 있어요';
  if (state.houses.has(no)) return '이미 다른 고양이가 사는 집이에요';
  const founder = me.houseNo <= FOUNDER_MAX;
  if (founder && no > FOUNDER_MAX) return `창립 주민은 1~${FOUNDER_MAX}번지 안에서 이사할 수 있어요`;
  if (!founder && no <= FOUNDER_MAX) return `1~${FOUNDER_MAX}번지는 창립 주민 집이에요`;
  if (no > maxPickableHouseNo(state.houses.size, Math.max(0, ...state.houses.keys()))) return '아직 열리지 않은 집이에요';
  if (!moveIsFree() && coins() < MOVE_HOUSE_COST) return `${CURRENCY}가 ${MOVE_HOUSE_COST - coins()}개 모자라요`;
  return null;
}

function endPicking() {
  picking = false;
  banner?.remove();
  banner = null;
}

/** 섬 지도에서 빈 집을 눌러 고르게 한다 */
export function startMovePicking() {
  if (!state.me) return;
  picking = true;
  go('map');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'pick-banner';
    banner.innerHTML = `<span>이사할 <b>빈 집</b>을 눌러 주세요 <small>(${moveCostLabel()})</small></span><button type="button">취소</button>`;
    banner.querySelector('button')!.addEventListener('click', () => {
      play('tap');
      endPicking();
    });
    document.getElementById('app')!.appendChild(banner);
  }
}
onRoute((r) => {
  if (picking && r.id !== 'map' && r.id !== 'house') endPicking();
});

/** 그 빈 집으로 이사한다 (묻고 나서) */
export async function moveTo(no: number): Promise<boolean> {
  const why = moveProblem(no);
  if (why) {
    play('error');
    toast(why);
    return false;
  }
  if (busy) return false;
  const me = state.me!;
  if (!confirm(`${me.houseNo}번지에서 ${no}번지로 이사할까요?\n마당, 집 안, 지붕 그림은 그대로 따라가요. (${moveCostLabel()})`)) return false;
  busy = true;
  try {
    const res = await moveMyHouse(no);
    applyWallet(res.wallet, { silent: true });
    moveMyHouseLocal(res.from, res.house);
    syncArt();
    endPicking();
    play('fanfare');
    toast(`${no}번지로 이사했어요! 새 집에서도 잘 지내요`, 2800);
    state.scene.focusHouse(no);
    // 이미 그 집 팝업이 열려 있으면 주소가 같아서 다시 그려지지 않으므로 한 번 지도로 갔다가 연다
    if (location.hash === `#/house/${no}`) {
      go('map');
      setTimeout(() => go('house', no), 60);
    } else go('house', no);
    return true;
  } catch (e) {
    play('error');
    toast(e instanceof ApiError ? e.message : '이사하지 못했어요');
    return false;
  } finally {
    busy = false;
  }
}
