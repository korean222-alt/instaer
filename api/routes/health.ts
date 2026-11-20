import type { Env } from '../env';
import { publicHandle } from '../lib/houses';
import { json } from '../http';
import { toDecor, type DecorRow } from '../lib/decor';
import { decorRank, decorScore } from '../../src/shared/decorScore';

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

/**
 * GET /api/series : 촬영 모드 "연재 릴스" (2026-11-19). 지금 입주 수, 최근 24시간에 들어온 집들(새것부터, 최대 30).
 * 화면은 "어제 N채 → 오늘 M채" 로 숫자를 올리고 새 집을 하나씩 세운다. 호출은 촬영할 때만이라 가볍다.
 */
export async function series(env: Env): Promise<Response> {
  const since = Math.floor(Date.now() / 1000) - 86400;
  const [total, recent] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM houses').first<{ n: number }>(),
    env.DB.prepare('SELECT house_no, ig_handle, hide_handle, region FROM houses WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT 30')
      .bind(since)
      .all<{ house_no: number; ig_handle: string; hide_handle: number; region: string }>(),
  ]);
  return json({
    total: total?.n ?? 0,
    recent: (recent.results ?? []).map((r) => ({ houseNo: r.house_no, handle: publicHandle(r), region: r.region })),
  });
}

/**
 * GET /api/showcase : 촬영 모드 "꾸미기 릴스" (2026-11-20). 지붕 그림이 있는 집, 집 안을 잘 꾸민 집(방 전체 꾸미기 포함), 마당을 잘 꾸민 집.
 * 집이 수백 채라 꾸미기 줄을 한 번에 읽어 점수로 고른다. 촬영할 때만 불러서 가볍다.
 */
export async function showcase(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT h.house_no, h.ig_handle, h.hide_handle, h.region, d.yard, d.room, d.wallpaper, d.floor, d.roof_art, w.data AS wallet
     FROM house_decor d JOIN houses h ON h.id = d.house_id LEFT JOIN wallets w ON w.house_id = d.house_id`,
  ).all<{ house_no: number; ig_handle: string; hide_handle: number; region: string; wallpaper: string; floor: string; wallet: string | null } & DecorRow>();
  const rows = (results ?? []).map((r) => {
    const d = toDecor(r.house_no, r);
    const score = decorScore(d);
    const surf = (d.wallpaper !== 'cream' ? 1 : 0) + (d.floor !== 'wood' ? 1 : 0);
    return {
      houseNo: r.house_no,
      handle: publicHandle(r),
      region: r.region,
      score,
      rank: decorRank(score),
      d,
      roomScore: d.room.length * 10 + new Set(d.room.map((i) => i.type)).size * 5 + surf * 15 + d.room.filter((i) => i.drawingId).length * 5,
      yardScore: d.yard.length * 10 + new Set(d.yard.map((i) => i.type)).size * 5,
      big: !!r.wallet && r.wallet.includes('"room_big"'),
    };
  });
  const pick = <T>(list: T[], n: number) => list.slice(0, n);
  return json({
    roofs: pick(
      rows.filter((r) => r.d.roofArt || r.d.roofArtBack).sort((a, b) => b.score - a.score),
      5,
    ).map((r) => ({ houseNo: r.houseNo, handle: r.handle, region: r.region, roofArt: r.d.roofArt, roofArtBack: r.d.roofArtBack })),
    rooms: pick(
      rows.filter((r) => r.d.room.length >= 3).sort((a, b) => b.roomScore - a.roomScore),
      4,
    ).map((r) => ({ houseNo: r.houseNo, handle: r.handle, region: r.region, rank: r.rank, room: r.d.room, wallpaper: r.d.wallpaper, floor: r.d.floor, big: r.big })),
    yards: pick(
      rows.filter((r) => r.d.yard.length >= 3).sort((a, b) => b.yardScore - a.yardScore),
      6,
    ).map((r) => ({ houseNo: r.houseNo, handle: r.handle, region: r.region })),
  });
}
