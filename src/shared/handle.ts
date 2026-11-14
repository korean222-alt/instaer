// 인스타 아이디 정리와 검사. 서버와 화면이 같은 규칙을 쓴다.

export const HANDLE_MAX = 30;

/** 소문자, 앞의 @ 와 공백 제거 */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export type HandleProblem = 'empty' | 'too_long' | 'bad_chars' | 'bad_dots' | 'blocked';

/** 문제가 없으면 null. 인스타 규칙: 영문 소문자, 숫자, 마침표, 밑줄, 30자 이하, 마침표로 시작/끝 불가, 연속 마침표 불가 */
export function handleProblem(handle: string): HandleProblem | null {
  if (!handle) return 'empty';
  if (handle.length > HANDLE_MAX) return 'too_long';
  if (!/^[a-z0-9._]+$/.test(handle)) return 'bad_chars';
  if (handle.startsWith('.') || handle.endsWith('.') || handle.includes('..')) return 'bad_dots';
  if (isBlockedText(handle)) return 'blocked';
  return null;
}

export const HANDLE_PROBLEM_TEXT: Record<HandleProblem, string> = {
  empty: '인스타 아이디를 적어 주세요',
  too_long: `아이디는 ${HANDLE_MAX}자까지예요`,
  bad_chars: '영문, 숫자, 마침표(.), 밑줄(_)만 쓸 수 있어요',
  bad_dots: '마침표는 처음과 끝, 두 번 연속으로 쓸 수 없어요',
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
