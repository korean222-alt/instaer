// 인스타 인증 (2026-11-17). 서버와 화면이 같은 규칙을 쓴다.
// 흐름: 팔로우 → 릴스에 댓글 → 키티챗 DM 으로 팔로워 암호(모두 같음) → 사이트에 인스타 아이디 + 암호
//       → 서버가 그 아이디로 최근 댓글이 있는지 확인 → 가입.
// 도용되면: 되찾기(사이트가 준 코드를 댓글로 남기기) 또는 신고.

/**
 * off      : 예전처럼 닉네임만으로 입주 (인증 없음)
 * password : 인스타 아이디 + 팔로워 암호 (댓글은 확인하지 않음. Meta 토큰이 아직 없을 때)
 * comment  : 인스타 아이디 + 팔로워 암호 + 최근 댓글 확인
 */
export type AuthMode = 'off' | 'password' | 'comment';
export const AUTH_MODES: readonly AuthMode[] = ['off', 'password', 'comment'];
export const isAuthMode = (v: unknown): v is AuthMode => typeof v === 'string' && (AUTH_MODES as readonly string[]).includes(v);

/** 댓글을 단 지 이 시간 안이어야 가입할 수 있다 */
export const COMMENT_WINDOW_SEC = 24 * 3600;
/** 되찾기 코드 유효 시간 */
export const RECLAIM_TTL_SEC = 30 * 60;
export const RECLAIM_CODE_LEN = 6;
/** 헷갈리는 글자(0 O 1 I L) 뺀 글자 */
export const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const IG_ID_MAX = 30;
/** 인스타 아이디 정리: @ 빼고, 공백 빼고, 소문자 */
export const normalizeIgId = (raw: string) => raw.trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
/** 인스타 아이디 규칙 (영문 소문자, 숫자, 마침표, 밑줄, 30자). 문제 없으면 null */
export function igIdProblem(id: string): string | null {
  if (!id) return '인스타 아이디를 적어 주세요';
  if (id.length > IG_ID_MAX) return `인스타 아이디는 ${IG_ID_MAX}자까지예요`;
  if (!/^[a-z0-9._]+$/.test(id)) return '인스타 아이디는 영문, 숫자, 마침표(.), 밑줄(_)만 있어요';
  return null;
}
/** 댓글 속 코드 비교용: 띄어쓰기와 - 를 빼고 대문자 */
export const flatCode = (s: string) => s.replace(/[\s\-_.]/g, '').toUpperCase();

// ── 신고 ──
export type ReportKind = 'stolen' | 'house' | 'other';
export const REPORT_KINDS: Array<{ id: ReportKind; label: string }> = [
  { id: 'stolen', label: '누가 내 인스타 아이디로 가입했어요' },
  { id: 'house', label: '이 집(이름, 그림, 글)이 이상해요' },
  { id: 'other', label: '그 밖의 문제' },
];
export const isReportKind = (v: unknown): v is ReportKind => v === 'stolen' || v === 'house' || v === 'other';
export const REPORT_MAX = 300;

// ── 소원 비는 곳: 앞으로 생겼으면 하는 것 적기 ──
export const WISH_MAX = 100;
export const WISH_PER_DAY = 3;
export const WISH_SHOW = 60;
