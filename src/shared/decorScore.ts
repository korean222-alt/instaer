// 꾸미기 점수 (2026-11-18 사용자: 가구를 놓을수록 점수가 올라가게, 프로필에서만 보이게).
// 서버가 집 꾸미기 전체(마당 + 집 안 + 지붕)로 계산해서 프로필(/api/house/:no/social)에 넣는다.
import type { HouseDecor } from './types';

/** 점수 매기는 법 (화면 설명에도 쓴다) */
export const DECOR_SCORE_RULES = {
  /** 놓은 가구 하나 (마당, 집 안 모두) */
  item: 10,
  /** 서로 다른 종류의 가구 하나 더 */
  variety: 5,
  /** 직접 그린 그림을 붙인 가구 하나 */
  art: 5,
  /** 지붕 그림 (앞, 뒤 각각) */
  roof: 20,
  /** 기본이 아닌 벽지, 바닥 (각각) */
  surface: 10,
} as const;

export function decorScore(d: Pick<HouseDecor, 'yard' | 'room' | 'wallpaper' | 'floor' | 'roofArt' | 'roofArtBack'>): number {
  const r = DECOR_SCORE_RULES;
  const items = [...(d.yard ?? []), ...(d.room ?? [])];
  const types = new Set(items.map((i) => i.type));
  let s = items.length * r.item + types.size * r.variety + items.filter((i) => i.drawingId).length * r.art;
  if (d.roofArt) s += r.roof;
  if (d.roofArtBack) s += r.roof;
  if (d.wallpaper && d.wallpaper !== 'cream') s += r.surface;
  if (d.floor && d.floor !== 'wood') s += r.surface;
  return s;
}

/** 점수에 맞는 이름 */
export function decorRank(score: number): string {
  if (score >= 600) return '섬 최고의 집';
  if (score >= 350) return '꾸미기 장인';
  if (score >= 180) return '예쁜 집';
  if (score >= 80) return '아늑한 집';
  if (score > 0) return '꾸미는 중';
  return '새 집';
}
