// 닉네임 정리와 검사. 서버와 화면이 같은 규칙을 쓴다. (이름은 handle, DB 열은 ig_handle 로 남아 있지만 지금은 닉네임이다. 2026-11-15)

export const HANDLE_MAX = 12;

/** 앞뒤 공백 제거, 한글 조합 통일, 영문은 소문자 (같은 닉네임은 대소문자 상관없이 한 명만) */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').normalize('NFC').toLowerCase();
}

export type HandleProblem = 'empty' | 'too_long' | 'bad_chars' | 'blocked';

/** 문제가 없으면 null. 한글, 영문, 숫자, 밑줄(_) 만, 12자 이하 */
export function handleProblem(handle: string): HandleProblem | null {
  if (!handle) return 'empty';
  if (handle.length > HANDLE_MAX) return 'too_long';
  if (!/^[a-z0-9_가-힣]+$/.test(handle)) return 'bad_chars';
  if (isBlockedText(handle)) return 'blocked';
  return null;
}

export const HANDLE_PROBLEM_TEXT: Record<HandleProblem, string> = {
  empty: '닉네임을 적어 주세요',
  too_long: `닉네임은 ${HANDLE_MAX}자까지예요`,
  bad_chars: '한글, 영문, 숫자, 밑줄(_)만 쓸 수 있어요 (띄어쓰기는 안 돼요)',
  blocked: '쓸 수 없는 단어가 들어 있어요',
};

// ── 간단한 욕설/부적절 단어 필터 (아이디, 이름표, 문구에 쓴다) ──
// 완벽하지 않다. 걸러지지 않은 것은 신고 기능(나중)으로 처리한다.
const BLOCKED = [
  // 영어
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'porn', 'nazi', 'hitler', 'whore', 'slut', 'pussy',
  // 한국어 로마자 표기
  'ssibal', 'sibal', 'shibal', 'ssival', 'gaesaekki', 'gaeseki', 'byungsin', 'byeongsin', 'jiral',
  // 한국어
  '시발', '씨발', '씨바', '병신', '븅신', '개새', '좆', '지랄', '느금', '섹스', '야동', '일베', '보지', '자지', '꺼져', '닥쳐',
];
/** 통째로 같을 때만 막는 이름 (운영 사칭 방지). 'badminton' 같은 아이디는 막지 않는다 */
const RESERVED = ['admin', 'administrator', 'official', 'catisland', 'cat_island', 'cat.island', 'support', 'staff', 'root'];

/** 글자 사이에 넣은 . _ - 공백 등을 빼고 본다 */
export function isBlockedText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (RESERVED.includes(lower)) return true;
  const flat = lower.replace(/[\s._\-*~0-9]/g, '');
  return BLOCKED.some((w) => flat.includes(w));
}

/** 닉네임 숨기기: mochi_nyang → mo*******ng. 가린 아이디에는 항상 '*' 가 들어간다 */
export function maskHandle(handle: string): string {
  if (handle.length <= 3) return `${handle[0] ?? ''}**`;
  const keep = handle.length <= 5 ? 1 : 2;
  return handle.slice(0, keep) + '*'.repeat(Math.min(6, handle.length - keep * 2)) + handle.slice(-keep);
}
/** 가린 아이디인지 (진짜 인스타 아이디에는 '*' 를 쓸 수 없다) */
export const isMaskedHandle = (h: string | null | undefined) => !!h && h.includes('*');
