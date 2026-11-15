// 로컬 확인용 가짜 입주자 SQL 을 만든다. (실제 DB 에는 쓰지 않는다)
//   node scripts/seed-local.mjs 120 > .wrangler/seed.sql
//   npx wrangler d1 execute DB --local --file .wrangler/seed.sql
const n = Number(process.argv[2] ?? 60);
const A = ['mochi', 'bori', 'nabi', 'kong', 'dubu', 'coco', 'haru', 'choco', 'bam', 'dal', 'tori', 'yuja', 'ruru', 'somi'];
const B = ['cat', 'nyang', 'meow', 'home', 'zip', 'daily', 'log', 'jelly', 'island', 'butler'];
const REGIONS = ['seoul', 'seoul', 'seoul', 'gyeonggi', 'gyeonggi', 'gyeonggi', 'gyeonggi', 'busan', 'busan', 'incheon', 'daegu', 'gwangju', 'daejeon', 'ulsan', 'sejong', 'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju', 'other'];
const ROOFS = ['#ff8f7a', '#f6a55c', '#ffd166', '#c5e17a', '#7fd8b0', '#5cc2b5', '#8fd3e8', '#7cc4f2', '#9fa8f0', '#b79cf0', '#ff9ec2', '#d9a37e'];
const ITEMS = ['cat_tower', 'hammock', 'plant', 'sign', 'fish_rack', 'cushion', 'lantern', 'bench'];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (l) => l[Math.floor(rnd() * l.length)];
const now = Math.floor(Date.now() / 1000);
const out = ['DELETE FROM drawings; DELETE FROM wallets; DELETE FROM house_decor; DELETE FROM yard_items; DELETE FROM likes_log; DELETE FROM sessions; DELETE FROM houses; DELETE FROM zone_cache; DELETE FROM region_counts;'];
const used = new Set();
for (let i = 1; i <= n; i++) {
  let h;
  do h = `${pick(A)}_${pick(B)}${Math.floor(rnd() * 90 + 10)}`; while (used.has(h));
  used.add(h);
  const created = now - Math.floor(rnd() * 14 * 86400);
  out.push(`INSERT INTO houses (id, house_no, ig_handle, region, roof_color, likes, created_at) VALUES (${i}, ${i}, '${h}', '${pick(REGIONS)}', '${pick(ROOFS)}', ${Math.floor(rnd() * rnd() * 40)}, ${created});`);
  const cells = new Set();
  const k = Math.floor(rnd() * 5);
  for (let j = 0; j < k; j++) {
    const x = Math.floor(rnd() * 6), y = 3 + Math.floor(rnd() * 3);
    if (cells.has(`${x},${y}`)) continue;
    cells.add(`${x},${y}`);
    out.push(`INSERT INTO yard_items (house_id, item_type, x, y, rotation) VALUES (${i}, '${pick(ITEMS)}', ${x}, ${y}, ${pick([0, 90, 180, 270])});`);
  }
}
// 지역 수 다시 세기 (전체 + 주별, 한국 시간 월요일 0시 기준)
// 칸 방식 마당 → 자유 배치 (db/migrations/0004 와 같은 변환)
out.push(`INSERT INTO house_decor (house_id, yard) SELECT house_id, json_group_array(json_object('id', 'g' || rowid, 'type', item_type, 'x', x - 2.5, 'z', y - 2.5, 'rotY', round(-rotation * 0.017453292519943295, 4))) FROM yard_items GROUP BY house_id;`);
out.push(`INSERT INTO wallets (house_id, coins, data) SELECT house_id, 50, json_object('owned', json_group_array(DISTINCT item_type)) FROM yard_items GROUP BY house_id;`);
out.push(`INSERT INTO region_counts (region, week, n) SELECT region, 0, COUNT(*) FROM houses GROUP BY region;`);
out.push(`INSERT INTO region_counts (region, week, n) SELECT region, CAST(strftime('%s', date(created_at + 32400, 'unixepoch', 'weekday 0', '-6 days')) AS INTEGER) - 32400 AS wk, COUNT(*) FROM houses GROUP BY region, wk;`);
console.log(out.join('\n'));
