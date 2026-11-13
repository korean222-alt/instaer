import { ZONE_CAPACITY } from '../shared/config';

/**
 * 집 번호(houseNo) → 위치. 위치는 DB에 저장하지 않고 항상 여기서 계산한다.
 *
 * 구조
 * - 섬(구역) 하나에 집 100채(ZONE_CAPACITY). 1~100번은 1구역, 101~200번은 2구역 ...
 * - 구역은 가운데에서 시작해 소용돌이 모양으로 바깥으로 늘어난다. 이웃한 구역끼리 다리로 이어진다.
 * - 구역 안은 12칸 x 11줄 격자. 가운데는 광장, 네 귀퉁이는 바다 쪽이라 비우고,
 *   남은 120자리 중 20자리는 빈터로 남긴다(나중에 땅 넓히기용). 나머지 100자리가 집.
 * - 번호는 광장에 가까운 자리부터 매긴다. (입주 초반에 마을이 가운데부터 차 보이게)
 * - 모든 집은 화면 아래쪽(+z)을 본다. 줄마다 집 앞에 길이 있다.
 */
export const ZONE = {
  cols: 12,
  rows: 11,
  /** 마당 가운데끼리의 가로 간격 */
  pitchX: 6.8,
  /** 줄 간격 (마당 6 + 길 2.2) */
  pitchZ: 8.2,
  /** 가운데 큰길 때문에 좌우로 벌리는 거리 */
  avenue: 1.1,
  /** 마당 가운데에서 그 줄 앞길 가운데까지 */
  rowPath: 4.1,
  /** 섬(땅)의 절반 크기 */
  halfX: 47.4,
  halfZ: 50.6,
  corner: 20,
  /** 섬과 섬 사이 바다 폭 */
  gap: 16,
  /** 길 반폭 */
  pathR: 0.78,
} as const;

/** 구역 가운데끼리의 간격 */
export const ZONE_PITCH_X = ZONE.halfX * 2 + ZONE.gap;
export const ZONE_PITCH_Z = ZONE.halfZ * 2 + ZONE.gap;

/** 줄 전체를 살짝 위로 올려서 맨 아랫줄 앞길이 들어갈 자리를 만든다 */
const ROW_SHIFT = 0.4;

/** 광장 (구역 가운데 기준 좌표). 4번째 줄 앞길이 광장 한가운데를 지난다 */
export const PLAZA_LOCAL = { x: 0, z: -ZONE.pitchZ - ROW_SHIFT + ZONE.rowPath, r: 6.6 };

export interface LocalLot {
  /** 구역 가운데 기준 마당 한가운데 */
  x: number;
  z: number;
  col: number;
  row: number;
}

export const colX = (col: number) => (col - (ZONE.cols - 1) / 2) * ZONE.pitchX + (col < ZONE.cols / 2 ? -ZONE.avenue : ZONE.avenue);
export const rowZ = (row: number) => (row - (ZONE.rows - 1) / 2) * ZONE.pitchZ - ROW_SHIFT;

/** 둥근 네모 섬 모양: 안쪽이 +, 바다가 - (해안 굴곡을 넣기 전의 매끈한 모양) */
export function zoneBaseLand(lx: number, lz: number): number {
  const qx = Math.abs(lx) - ZONE.halfX + ZONE.corner;
  const qz = Math.abs(lz) - ZONE.halfZ + ZONE.corner;
  return -(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - ZONE.corner);
}

const isPlazaCell = (col: number, row: number) => col >= 4 && col <= 7 && (row === 4 || row === 5);

function buildLots(): { houses: LocalLot[]; reserved: LocalLot[] } {
  const valid: LocalLot[] = [];
  for (let row = 0; row < ZONE.rows; row++) {
    for (let col = 0; col < ZONE.cols; col++) {
      if (isPlazaCell(col, row)) continue;
      const x = colX(col);
      const z = rowZ(row);
      // 마당 네 귀퉁이가 전부 풀밭 안쪽이어야 한다 (해안 굴곡 여유 포함)
      let ok = true;
      for (const sx of [-3.2, 3.2]) for (const sz of [-3.2, 3.2]) if (zoneBaseLand(x + sx, z + sz) < 4.6) ok = false;
      if (ok) valid.push({ x, z, col, row });
    }
  }
  // 광장에 가까운 순서. 거리가 같으면 앞줄(화면 아래) 먼저, 그다음 왼쪽부터
  const key = (l: LocalLot) => Math.hypot(l.x * 0.92, l.z - PLAZA_LOCAL.z);
  valid.sort((a, b) => key(a) - key(b) || b.row - a.row || a.col - b.col);
  const houses: LocalLot[] = [];
  const reserved: LocalLot[] = [];
  valid.forEach((lot, i) => (i % 6 === 5 ? reserved : houses).push(lot));
  // 자리가 모자라거나 남으면 빈터와 맞바꿔서 정확히 ZONE_CAPACITY 채를 맞춘다
  while (houses.length > ZONE_CAPACITY) reserved.push(houses.pop()!);
  while (houses.length < ZONE_CAPACITY && reserved.length) houses.push(reserved.pop()!);
  return { houses, reserved };
}

const LOTS = buildLots();
/** 구역 안의 집 자리 100개 (번호 순서) */
export const LOCAL_SLOTS: readonly LocalLot[] = LOTS.houses;
/** 비워 둔 빈터 */
export const RESERVED_LOTS: readonly LocalLot[] = LOTS.reserved;

const slotIndexByCell = new Map<number, number>();
LOCAL_SLOTS.forEach((l, i) => slotIndexByCell.set(l.row * ZONE.cols + l.col, i));

// ── 구역 위치: 가운데에서 시작하는 네모 소용돌이 ──
const zoneGrid: Array<{ gx: number; gz: number }> = [{ gx: 0, gz: 0 }];
const zoneByGrid = new Map<string, number>([['0,0', 0]]);
function growZones(count: number) {
  // 동 → 북 → 서 → 남 순서로 1,1,2,2,3,3... 칸씩
  const dirs = [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ];
  while (zoneGrid.length < count) {
    let gx = 0;
    let gz = 0;
    let n = 1;
    let len = 1;
    let d = 0;
    zoneGrid.length = 1;
    outer: for (;;) {
      for (let rep = 0; rep < 2; rep++) {
        for (let s = 0; s < len; s++) {
          gx += dirs[d][0];
          gz += dirs[d][1];
          zoneGrid[n] = { gx, gz };
          zoneByGrid.set(`${gx},${gz}`, n);
          n++;
          if (n >= count + 16) break outer;
        }
        d = (d + 1) % 4;
      }
      len++;
    }
  }
}

/** 구역 가운데의 세계 좌표 (zone 은 0부터) */
export function zoneCenter(zone: number): { x: number; z: number } {
  if (zone >= zoneGrid.length) growZones(zone + 1);
  const g = zoneGrid[zone];
  return { x: g.gx * ZONE_PITCH_X, z: g.gz * ZONE_PITCH_Z };
}

/** 구역 k 와 바로 앞 구역(k-1)을 잇는 다리의 방향. 'x' 는 동서, 'z' 는 남북 */
export function zoneLink(zone: number): { from: number; to: number; axis: 'x' | 'z'; sign: number } | null {
  if (zone <= 0) return null;
  zoneCenter(zone);
  const a = zoneGrid[zone - 1];
  const b = zoneGrid[zone];
  if (b.gx !== a.gx) return { from: zone - 1, to: zone, axis: 'x', sign: Math.sign(b.gx - a.gx) };
  return { from: zone - 1, to: zone, axis: 'z', sign: Math.sign(b.gz - a.gz) };
}

/** 집 번호가 속한 구역 (0부터) */
export const zoneOfHouse = (houseNo: number) => Math.floor((houseNo - 1) / ZONE_CAPACITY);

/**
 * 집 번호 → 마당 한가운데의 세계 좌표와 구역 번호.
 * zone 은 0부터 센다 (1~100번지가 zone 0).
 */
export function houseSlot(houseNo: number): { x: number; z: number; zone: number } {
  const n = Math.max(1, Math.floor(houseNo));
  const zone = zoneOfHouse(n);
  const lot = LOCAL_SLOTS[(n - 1) % ZONE_CAPACITY];
  const c = zoneCenter(zone);
  return { x: c.x + lot.x, z: c.z + lot.z, zone };
}

/** 세계 좌표가 속한 구역. 구역 사이 바다면 -1 */
export function zoneAt(x: number, z: number): number {
  const gx = Math.round(x / ZONE_PITCH_X);
  const gz = Math.round(z / ZONE_PITCH_Z);
  const zone = zoneByGrid.get(`${gx},${gz}`);
  if (zone === undefined) return -1;
  if (Math.abs(x - gx * ZONE_PITCH_X) > ZONE.halfX + 2 || Math.abs(z - gz * ZONE_PITCH_Z) > ZONE.halfZ + 2) return -1;
  return zone;
}

/** 세계 좌표가 어느 집 마당 위인지. 없으면 null. (탭한 집 찾기용, 계산 한 번으로 끝난다) */
export function houseNoAt(x: number, z: number, margin = 0.3): number | null {
  const zone = zoneAt(x, z);
  if (zone < 0) return null;
  const c = zoneCenter(zone);
  const lx = x - c.x;
  const lz = z - c.z;
  const row = Math.round((lz + ROW_SHIFT) / ZONE.pitchZ + (ZONE.rows - 1) / 2);
  if (row < 0 || row >= ZONE.rows) return null;
  const side = lx < 0 ? -ZONE.avenue : ZONE.avenue;
  const col = Math.round((lx - side) / ZONE.pitchX + (ZONE.cols - 1) / 2);
  if (col < 0 || col >= ZONE.cols) return null;
  if (Math.abs(lx - colX(col)) > 3 + margin || Math.abs(lz - rowZ(row)) > 3 + margin) return null;
  const idx = slotIndexByCell.get(row * ZONE.cols + col);
  return idx === undefined ? null : zone * ZONE_CAPACITY + idx + 1;
}
