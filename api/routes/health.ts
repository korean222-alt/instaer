import type { Env } from '../env';
import { publicHandle } from '../lib/houses';
import { json } from '../http';

/**
 * GET /api/health : D1 연결 확인.
 * 집 수를 세서 돌려준다 (앱 상단 HUD 가 "입주 N마리"로 쓴다).
 * 마이그레이션을 아직 안 했으면 db: 'no_schema' 로 알려 준다.
 */
export async function health(env: Env): Promise<Response> {
  const started = Date.now();
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM houses').first<{ n: number }>();
    return json({ ok: true, db: 'ok', houses: row?.n ?? 0, ms: Date.now() - started });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const noSchema = /no such table/i.test(message);
    return json(
      { ok: false, db: noSchema ? 'no_schema' : 'error', message },
      { status: noSchema ? 200 : 500 },
    );
  }
}

/**
 * GET /api/newcomer : 가장 최근에 입주한 집 (촬영 모드 "새 주민 릴스"가 주인공을 고를 때만 부른다).
 * 집이 적어서 created_at 정렬은 가볍다. 화면에 보이는 이름은 숨기기를 따른다.
 */
export async function newcomer(env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT house_no, ig_handle, hide_handle, region, created_at FROM houses ORDER BY created_at DESC, id DESC LIMIT 1').first<{
    house_no: number;
    ig_handle: string;
    hide_handle: number;
    region: string;
    created_at: number;
  }>();
  if (!row) return json({ house: null });
  return json({ house: { houseNo: row.house_no, handle: publicHandle(row), region: row.region, at: row.created_at } });
}
