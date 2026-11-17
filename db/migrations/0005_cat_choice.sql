-- 입주할 때 고른 고양이 'pattern|털색|눈색' (2026-11-15).
-- NULL 이면 예전처럼 아이디로 정해진 고양이(catLook)를 쓴다.
ALTER TABLE houses ADD COLUMN cat TEXT;

-- 구역 목록에 들어가는 고양이 값이 바뀔 수 있으니 다시 만든다
UPDATE zone_cache SET dirty = 2;
