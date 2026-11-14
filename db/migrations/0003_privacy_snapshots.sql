-- 아이디 숨기기, 사람이 많아져도 D1 무료 한도(하루 읽기 500만 행)를 넘지 않게 하는 요약 표.

-- 아이디 숨기기: 1 이면 다른 사람에게는 가린 아이디(mo**ng)만 보낸다
ALTER TABLE houses ADD COLUMN hide_handle INTEGER NOT NULL DEFAULT 0;

-- 오늘 받은 예뻐요 수 (오늘의 특이한 집을 likes_log 전체를 세지 않고 찾기 위해)
ALTER TABLE houses ADD COLUMN likes_day TEXT;
ALTER TABLE houses ADD COLUMN likes_today INTEGER NOT NULL DEFAULT 0;
CREATE INDEX houses_likes_today ON houses (likes_day, likes_today);

-- 구역(100채)마다 미리 만든 집 목록 JSON. 마을 목록은 이 표만 읽는다 (구역 수만큼의 행).
-- dirty: 0 최신, 1 예뻐요만 바뀜(15분마다 다시 만듦), 2 집/마당/숨기기 바뀜(1분 안에 다시 만듦)
CREATE TABLE zone_cache (
  zone      INTEGER PRIMARY KEY,
  json      TEXT    NOT NULL,
  built_at  INTEGER NOT NULL,
  dirty     INTEGER NOT NULL DEFAULT 0
);

-- 지역별 입주 수. week = 0 은 전체, 그 밖은 그 주 시작(한국 시간 월요일 0시, unix 초)
CREATE TABLE region_counts (
  region  TEXT    NOT NULL,
  week    INTEGER NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (region, week)
);
INSERT INTO region_counts (region, week, n) SELECT region, 0, COUNT(*) FROM houses GROUP BY region;
-- 주별 신규 입주 수 채우기 (한국 시간 월요일 0시 기준)
INSERT INTO region_counts (region, week, n)
SELECT region,
       CAST(strftime('%s', date(created_at + 32400, 'unixepoch', 'weekday 0', '-6 days')) AS INTEGER) - 32400 AS wk,
       COUNT(*)
FROM houses GROUP BY region, wk;
-- 오늘 예뻐요가 아무도 없을 때 전체 1등을 찾는 데 쓴다
CREATE INDEX houses_likes ON houses (likes);
