-- 고양이섬 첫 스키마 (D1 = SQLite). boolean 은 integer 0/1, 시간은 unix 초.
-- 위치(좌표)는 저장하지 않는다. 번지(house_no)로 씬이 계산한다.
-- 고양이 외형은 저장하지 않는다. 아이디로 항상 같은 결과가 나오는 catLook(handle) 로 만든다.

CREATE TABLE houses (
  id          INTEGER PRIMARY KEY,
  house_no    INTEGER NOT NULL UNIQUE,
  ig_handle   TEXT    NOT NULL UNIQUE,
  verified    INTEGER NOT NULL DEFAULT 0,
  region      TEXT    NOT NULL,
  roof_color  TEXT    NOT NULL,
  likes       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
-- 지역 순위(전체 / 이번 주 신규)용
CREATE INDEX houses_region_created ON houses (region, created_at);

CREATE TABLE yard_items (
  house_id   INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  item_type  TEXT    NOT NULL,
  x          INTEGER NOT NULL CHECK (x BETWEEN 0 AND 5),
  y          INTEGER NOT NULL CHECK (y BETWEEN 0 AND 5),
  rotation   INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270))
);
CREATE INDEX yard_items_house ON yard_items (house_id);

-- 나중에 인스타 DM 코드 인증용 (지금은 테이블만)
CREATE TABLE claim_codes (
  code        TEXT    PRIMARY KEY,
  house_id    INTEGER REFERENCES houses (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  used_at     INTEGER
);

-- 예뻐요 하루 1번 제한용. day = 'YYYY-MM-DD' (UTC)
CREATE TABLE likes_log (
  house_id   INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  voter_key  TEXT    NOT NULL,
  day        TEXT    NOT NULL,
  PRIMARY KEY (house_id, voter_key, day)
);
