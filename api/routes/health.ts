import type { Env } from '../env';
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
