// 집 꾸미기(마당 자유 배치, 집 안, 지붕 그림)와 직접 그린 그림.
import { DRAWING_BYTES, DRAWING_MAX, ROOF_COLORS } from '../../src/shared/config';
import { owns } from '../../src/shared/economy';
import type { Drawing } from '../../src/shared/types';
import type { Env } from '../env';
import { clientIp, error, json, readJson } from '../http';
import { invalidate } from '../lib/cache';
import { cleanFree, cleanSurface, ID_RE, joinRoof, readDecor, toDecor, yardOutsideBase } from '../lib/decor';
import { houseByNo, markZoneDirty } from '../lib/houses';
import { allow } from '../lib/rateLimit';
import { sessionHouse } from '../lib/session';
import { bumpDaily, loadWallet, saveWallet, walletView } from '../lib/wallet';
import { VILLAGE_KEY } from './village';

/** GET /api/house/:no : 그 집의 꾸미기 전체 (집 안 포함). 빈 집이면 404 (화면이 주민 집으로 채운다) */
export async function getDecor(houseNo: number, env: Env): Promise<Response> {
  const house = await houseByNo(env.DB, houseNo);
  if (!house) return error(404, 'no_house', '빈 집이에요');
  const [row, wal] = await Promise.all([
    readDecor(env.DB, house.id),
    env.DB.prepare('SELECT data FROM wallets WHERE house_id = ?').bind(house.id).first<{ data: string }>(),
  ]);
  const big = !!wal?.data && wal.data.includes('"room_big"');
  const decor = toDecor(houseNo, row);
  const bigYard = (!!wal?.data && wal.data.includes('"yard_big"')) || yardOutsideBase(decor.yard);
  return json({ ...decor, big, bigYard, roofColor: house.roof_color });
}

/** 그 그림들이 모두 내 것인지 */
async function allMine(db: D1Database, houseId: number, ids: Set<string>): Promise<boolean> {
  if (!ids.size) return true;
  const list = [...ids];
  const { results } = await db
    .prepare(`SELECT COUNT(*) AS n FROM drawings WHERE house_id = ? AND id IN (${list.map(() => '?').join(',')})`)
    .bind(houseId, ...list)
    .all<{ n: number }>();
  return (results[0]?.n ?? 0) === list.length;
}

/**
 * PUT /api/house/:no {yard?, room?, wallpaper?, floor?, roofColor?, roofArt?} : 내 집만. 보낸 것만 바꾼다.
 * 가진 아이템(기본 + 상점/퀘스트로 얻은 것)만 놓을 수 있고, 그림은 내 그림만 붙일 수 있다.
 */
export async function putDecor(houseNo: number, request: Request, env: Env): Promise<Response> {
  if (!(await allow(env.RL_WRITE, `write:${clientIp(request)}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주한 사람만 꾸밀 수 있어요');
  if (mine.house.house_no !== houseNo) return error(403, 'not_yours', '내 집만 꾸밀 수 있어요');
  const body = await readJson<Record<string, unknown>>(request, 24_576);
  if (!body) return error(400, 'bad_request', '내용이 이상해요');

  const id = mine.house.id;
  const db = env.DB;
  const [row, wallet] = await Promise.all([readDecor(db, id), loadWallet(db, id)]);
  const cur = toDecor(houseNo, row);
  const usedTypes = new Set<string>();
  const usedDrawings = new Set<string>();

  // 마당 넓히기 (2026-11-16, 300츄르). 이미 넓은 마당에 놓아 둔 집은 무료로 열어 준다
  if (!wallet.data.owned.includes('yard_big') && yardOutsideBase(cur.yard)) wallet.data.owned.push('yard_big');
  if (body.yard !== undefined) {
    const c = cleanFree(body.yard, 'yard', wallet.data.owned.includes('yard_big'));
    if ('problem' in c) return error(400, 'bad_items', c.problem);
    cur.yard = c.items;
    c.types.forEach((t) => usedTypes.add(t));
    c.drawings.forEach((d) => usedDrawings.add(d));
  }
  if (body.room !== undefined) {
    const c = cleanFree(body.room, 'room', wallet.data.owned.includes('room_big'));
    if ('problem' in c) return error(400, 'bad_items', c.problem);
    cur.room = c.items;
    c.types.forEach((t) => usedTypes.add(t));
    c.drawings.forEach((d) => usedDrawings.add(d));
  }
  for (const kind of ['wallpaper', 'floor'] as const) {
    if (body[kind] === undefined) continue;
    const s = cleanSurface(body[kind], kind);
    if (!s) return error(400, 'bad_surface', kind === 'wallpaper' ? '없는 벽지예요' : '없는 바닥이에요');
    cur[kind] = s.value;
    if (s.drawing) usedDrawings.add(s.drawing);
  }
  // 지붕 그림 (앞, 뒤): 2026-11-16 부터 한 번 100츄르를 내야 붙일 수 있다 (전에 붙인 집은 그대로 쓸 수 있게 열어 준다)
  const hadRoof = !!(cur.roofArt || cur.roofArtBack);
  if (hadRoof && !wallet.data.owned.includes('roof_art')) wallet.data.owned.push('roof_art');
  for (const key of ['roofArt', 'roofArtBack'] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (v !== null && (typeof v !== 'string' || !ID_RE.test(v))) return error(400, 'bad_roof', '지붕 그림이 이상해요');
    if (v && !wallet.data.owned.includes('roof_art')) return error(403, 'not_owned', '지붕 그림은 한 번 100츄르를 내면 계속 그릴 수 있어요');
    cur[key] = v as string | null;
    if (v) usedDrawings.add(v as string);
  }
  const roof = body.roofColor ?? mine.house.roof_color;
  if (typeof roof !== 'string' || !(ROOF_COLORS as readonly string[]).includes(roof)) return error(400, 'bad_roof', '없는 지붕 색이에요');

  for (const t of usedTypes) if (!owns(wallet.data, t)) return error(403, 'not_owned', '아직 없는 아이템이 있어요. 상점이나 퀘스트로 얻어요');
  if (!(await allMine(db, id, usedDrawings))) return error(400, 'bad_drawing', '내 그림만 붙일 수 있어요');

  wallet.data.daily.decorate += 1;
  const stmts = [
    db
      .prepare(
        `INSERT INTO house_decor (house_id, yard, room, wallpaper, floor, roof_art, updated_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT (house_id) DO UPDATE SET yard = excluded.yard, room = excluded.room, wallpaper = excluded.wallpaper,
           floor = excluded.floor, roof_art = excluded.roof_art, updated_at = excluded.updated_at`,
      )
      .bind(id, JSON.stringify(cur.yard), JSON.stringify(cur.room), cur.wallpaper, cur.floor, joinRoof(cur.roofArt, cur.roofArtBack)),
    saveWallet(db, id, wallet),
  ];
  // 마당/지붕이 바뀌면 다른 사람 화면(마을 목록)도 다시 만든다. 집 안만 바뀌면 필요 없다
  const publicChanged = body.yard !== undefined || body.roofArt !== undefined || body.roofArtBack !== undefined || roof !== mine.house.roof_color;
  if (publicChanged) stmts.push(markZoneDirty(db, houseNo, 2));
  if (roof !== mine.house.roof_color) stmts.push(db.prepare('UPDATE houses SET roof_color = ? WHERE id = ?').bind(roof, id));
  await db.batch(stmts);
  if (publicChanged) invalidate(VILLAGE_KEY);
  return json({
    ok: true,
    decor: { ...cur, big: wallet.data.owned.includes('room_big'), bigYard: wallet.data.owned.includes('yard_big') },
    roofColor: roof,
    wallet: walletView(wallet, houseNo),
  });
}

// ── 그림 ──

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function cleanDrawing(body: Record<string, unknown> | null): { pixels: string; palette: string[] | null } | null {
  if (!body || typeof body.pixels !== 'string' || body.pixels.length > 700) return null;
  let bin: string;
  try {
    bin = atob(body.pixels);
  } catch {
    return null;
  }
  if (bin.length !== DRAWING_BYTES) return null;
  let palette: string[] | null = null;
  if (body.palette !== undefined && body.palette !== null) {
    if (!Array.isArray(body.palette) || body.palette.length !== 16 || !body.palette.every((c) => typeof c === 'string' && HEX_RE.test(c))) return null;
    palette = (body.palette as string[]).map((c) => c.toLowerCase());
  }
  return { pixels: body.pixels, palette };
}

function newDrawingId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface DrawingRow {
  id: string;
  pixels: string;
  palette: string | null;
}
const toDrawing = (r: DrawingRow): Drawing => ({ id: r.id, pixels: r.pixels, palette: r.palette ? (JSON.parse(r.palette) as string[]) : [] });

/** POST /api/drawings {pixels, palette?} : 새 그림. 집 한 채에 DRAWING_MAX 장까지 */
export async function postDrawing(request: Request, env: Env): Promise<Response> {
  if (!(await allow(env.RL_WRITE, `write:${clientIp(request)}`, 40))) return error(429, 'rate_limited', '잠시 후에 다시 해 주세요');
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주한 사람만 그림을 저장할 수 있어요');
  const d = cleanDrawing(await readJson<Record<string, unknown>>(request, 4096));
  if (!d) return error(400, 'bad_drawing', '그림이 이상해요');
  const db = env.DB;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM drawings WHERE house_id = ?').bind(mine.house.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= DRAWING_MAX) return error(400, 'too_many', `그림은 ${DRAWING_MAX}장까지 둘 수 있어요. 안 쓰는 그림을 지워 주세요`);
  const id = newDrawingId();
  await db.prepare('INSERT INTO drawings (id, house_id, pixels, palette) VALUES (?, ?, ?, ?)').bind(id, mine.house.id, d.pixels, d.palette ? JSON.stringify(d.palette) : null).run();
  await bumpDaily(db, mine.house.id, (w) => {
    w.daily.draw += 1;
    w.life.draw += 1;
  });
  return json({ ok: true, drawing: { id, pixels: d.pixels, palette: d.palette ?? [] } });
}

/** GET /api/me/drawings : 내 그림 전체 */
export async function myDrawings(request: Request, env: Env): Promise<Response> {
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return json({ drawings: [] });
  const { results } = await env.DB.prepare('SELECT id, pixels, palette FROM drawings WHERE house_id = ? ORDER BY created_at DESC').bind(mine.house.id).all<DrawingRow>();
  return json({ drawings: results.map(toDrawing) });
}

/** GET /api/drawings?ids=a,b,c : 그림 여러 장 (60장까지). 그림은 바뀌지 않으니 하루 캐시 */
export async function getDrawings(url: URL, env: Env): Promise<Response> {
  const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').filter((s) => ID_RE.test(s)))].slice(0, 60);
  if (!ids.length) return json({ drawings: [] });
  const { results } = await env.DB.prepare(`SELECT id, pixels, palette FROM drawings WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<DrawingRow>();
  return json({ drawings: results.map(toDrawing) }, { headers: { 'cache-control': 'public, max-age=86400' } });
}

/** DELETE /api/drawings/:id : 내 그림 지우기 (붙어 있던 곳은 빈 액자로 보인다) */
export async function deleteDrawing(drawingId: string, request: Request, env: Env): Promise<Response> {
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주한 사람만 지울 수 있어요');
  const res = await env.DB.prepare('DELETE FROM drawings WHERE id = ? AND house_id = ?').bind(drawingId, mine.house.id).run();
  if (!res.meta.changes) return error(404, 'no_drawing', '없는 그림이에요');
  return json({ ok: true });
}

/** GET /api/wallet : 내 지갑 */
export async function getWallet(request: Request, env: Env): Promise<Response> {
  const mine = await sessionHouse(env.DB, request);
  if (!mine) return error(401, 'no_session', '입주하면 츄르를 모을 수 있어요');
  return json({ wallet: walletView(await loadWallet(env.DB, mine.house.id), mine.house.house_no) });
}
