// 곤충 채집 (2026-11-19 사용자: "컨텐츠 더 추가").
// 걷는 동안 내 둘레 섬 곳곳에 곤충이 나타난다. 자리는 땅 칸(CELL)과 시간 칸(SLOT)으로 정해서
// 몇 분마다 새로 바뀌고, 같은 시간에는 누가 봐도 같은 곳에 있다. 잡은(놓친) 곤충은 이 화면에서 지운다.
// 가까이 가서 "잡기" → 곤충마다 잡힐 확률이 있고, 놓치면 날아간다. 잡은 곤충은 모아서 서버에 알린다(가방, 도감).
import { landAt, walkCost, type IslandScene, type SceneBug } from '../../scene';
import { BUGS, bugDef, rollBug, type BugDef } from '../../shared/economy';
import { state } from '../state';

const CELL = 13;
/** 곤충이 바뀌는 시간 (ms) */
const SLOT_MS = 150_000;
/** 내 둘레 이 안의 칸만 본다 */
const RANGE = 34;
/** 한 칸에 곤충이 있을 확률 */
const CHANCE = 0.3;
/** 이 안이면 "잡기" (곤충은 자리 둘레를 날아다니므로 그려진 자리로 잰다) */
export const BUG_REACH = 1.7;

export interface FieldBug {
  id: string;
  def: BugDef;
  x: number;
  z: number;
}

const hash = (a: number, b: number, c: number, d = 0) => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647) ^ Math.imul(d + 1, 974634267);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const isNightNow = () => {
  const h = new Date().getHours();
  return h >= 19 || h < 6;
};

export function createBugField(scene: IslandScene) {
  /** 잡았거나 놓친 곤충 id (시간 칸이 바뀌면 자연히 쓸모없어진다) */
  const gone = new Set<string>();
  let shown: FieldBug[] = [];
  let lastKey = '';

  function spawn(mx: number, mz: number): FieldBug[] {
    const slot = Math.floor(Date.now() / SLOT_MS);
    const night = isNightNow();
    const zones = state.unlockedZones;
    const has = (no: number) => state.houses.has(no);
    const out: FieldBug[] = [];
    const c0x = Math.floor((mx - RANGE) / CELL);
    const c1x = Math.floor((mx + RANGE) / CELL);
    const c0z = Math.floor((mz - RANGE) / CELL);
    const c1z = Math.floor((mz + RANGE) / CELL);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        if (hash(cx, cz, slot) > CHANCE) continue;
        const x = (cx + 0.15 + hash(cx, cz, slot, 1) * 0.7) * CELL;
        const z = (cz + 0.15 + hash(cx, cz, slot, 2) * 0.7) * CELL;
        if (Math.hypot(x - mx, z - mz) > RANGE) continue;
        if (landAt(x, z) < 2 || !Number.isFinite(walkCost(x, z, zones, has))) continue;
        const id = `b${cx}_${cz}_${slot}`;
        if (gone.has(id)) continue;
        out.push({ id, def: rollBug(hash(cx, cz, slot, 3), night), x, z });
      }
    return out;
  }

  const toScene = (b: FieldBug): SceneBug => ({ id: b.id, kind: b.def.kind, x: b.x, z: b.z, color: b.def.color, size: b.def.size });

  return {
    /** 걷기 중 0.2초마다. active 가 아니면(집 안, 동굴, 걷기 끔) 모두 지운다 */
    update(mx: number, mz: number, active: boolean) {
      const list = active ? spawn(mx, mz) : [];
      const key = list.map((b) => b.id).join(',');
      shown = list;
      if (key !== lastKey) {
        lastKey = key;
        scene.setBugs(list.map(toScene));
      }
    },
    /** 내 고양이 가까이의 곤충 (그려진 자리로 잰다) */
    near(mx: number, mz: number): FieldBug | null {
      let best: FieldBug | null = null;
      let bestD = BUG_REACH;
      for (const b of shown) {
        const p = scene.bugPos(b.id) ?? b;
        const d = Math.hypot(p.x - mx, p.z - mz);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return best;
    },
    /** 잡기: 잡혔으면 true. 잡혔든 놓쳤든 그 곤충은 사라진다 */
    tryCatch(b: FieldBug): boolean {
      gone.add(b.id);
      shown = shown.filter((x) => x.id !== b.id);
      lastKey = shown.map((x) => x.id).join(',');
      scene.setBugs(shown.map(toScene));
      return Math.random() < b.def.catchRate;
    },
  };
}
export type BugField = ReturnType<typeof createBugField>;
export { BUGS, bugDef };
