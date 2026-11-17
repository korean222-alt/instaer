// 길 찾기 (2026-11-15): 지도에서 고른 곳까지 걸어가는 길. 씬의 walkCost(땅, 다리, 집/나무/바위 막힘, 길은 싸게)로
// 1.5 단위 칸 위에서 A* 로 찾는다. 길이 없으면 null.
import { walkCost } from '../../scene';
import { state } from '../state';

const CELL = 1.5;
const MARGIN = 26;
const MAX_CELLS = 90_000;

export interface Pt {
  x: number;
  z: number;
}

/** 작은 최소 힙 (칸 번호, 값) */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** from → to 걷는 길 (세계 좌표 점 목록, 처음은 from, 끝은 to 근처). 못 찾으면 null */
export function findRoute(from: Pt, to: Pt): Pt[] | null {
  const zones = state.unlockedZones;
  const has = (no: number) => state.houses.has(no);
  let minX = Math.min(from.x, to.x) - MARGIN;
  let minZ = Math.min(from.z, to.z) - MARGIN;
  const maxX = Math.max(from.x, to.x) + MARGIN;
  const maxZ = Math.max(from.z, to.z) + MARGIN;
  let cell = CELL;
  let w = Math.ceil((maxX - minX) / cell) + 1;
  let h = Math.ceil((maxZ - minZ) / cell) + 1;
  // 아주 먼 길은 칸을 키운다
  while (w * h > MAX_CELLS) {
    cell *= 1.4;
    w = Math.ceil((maxX - minX) / cell) + 1;
    h = Math.ceil((maxZ - minZ) / cell) + 1;
  }
  minX = Math.floor(minX);
  minZ = Math.floor(minZ);
  const costs = new Float32Array(w * h).fill(-1);
  const cost = (i: number) => {
    let c = costs[i];
    if (c < 0) {
      c = walkCost(minX + (i % w) * cell, minZ + Math.floor(i / w) * cell, zones, has);
      costs[i] = c;
    }
    return c;
  };
  const idx = (p: Pt) => Math.round((p.z - minZ) / cell) * w + Math.round((p.x - minX) / cell);
  /** 막힌 칸이면 가장 가까운 걸을 수 있는 칸 */
  const nearestOpen = (p: Pt) => {
    const cx = Math.round((p.x - minX) / cell);
    const cz = Math.round((p.z - minZ) / cell);
    for (let r = 0; r < 8; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= w || z >= h) continue;
          if (Number.isFinite(cost(z * w + x))) return z * w + x;
        }
    return -1;
  };
  const start = Number.isFinite(cost(idx(from))) ? idx(from) : nearestOpen(from);
  const goal = Number.isFinite(cost(idx(to))) ? idx(to) : nearestOpen(to);
  if (start < 0 || goal < 0) return null;
  const gx = goal % w;
  const gz = Math.floor(goal / w);
  const g = new Float32Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const heap = new Heap();
  g[start] = 0;
  heap.push(start, 0);
  const D = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  let found = false;
  let steps = 0;
  while (heap.size && steps++ < MAX_CELLS * 2) {
    const cur = heap.pop();
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % w;
    const cz = Math.floor(cur / w);
    const cc = cost(cur);
    for (const [dx, dz, len] of D) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= w || z >= h) continue;
      const n = z * w + x;
      const nc = cost(n);
      if (!Number.isFinite(nc)) continue;
      // 대각선은 양옆 칸이 다 열려 있어야 (모서리를 파고들지 않게)
      if (dx && dz && (!Number.isFinite(cost(cz * w + x)) || !Number.isFinite(cost(z * w + cx)))) continue;
      const ng = g[cur] + len * (cc + nc) * 0.5;
      if (ng < g[n]) {
        g[n] = ng;
        came[n] = cur;
        heap.push(n, ng + Math.hypot(x - gx, z - gz) * 0.55);
      }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = goal; c >= 0; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: minX + (c % w) * cell, z: minZ + Math.floor(c / w) * cell }));
  pts[0] = { ...from };
  pts.push({ ...to });
  // 같은 방향으로 이어지는 점은 줄인다
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 0.01 || Math.hypot(b.x - a.x, b.z - a.z) > 12) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 길의 남은 길이 (점 목록을 따라) */
export function routeLength(pts: Pt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return d;
}
