-- 자유 배치 꾸미기(마당 + 집 안), 직접 그린 그림, 츄르 지갑.
-- 쓰기 한도(하루 10만 행)를 아끼려고 집 한 채의 꾸미기와 지갑은 각각 한 줄(JSON)로 저장한다.

-- 집 한 채의 꾸미기. yard / room 은 PlacedItem[] JSON
CREATE TABLE house_decor (
  house_id    INTEGER PRIMARY KEY REFERENCES houses (id) ON DELETE CASCADE,
  yard        TEXT    NOT NULL DEFAULT '[]',
  room        TEXT    NOT NULL DEFAULT '[]',
  wallpaper   TEXT    NOT NULL DEFAULT 'cream',
  floor       TEXT    NOT NULL DEFAULT 'wood',
  roof_art    TEXT,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 직접 그린 그림 (32x32, 16색). 한 번 저장하면 바뀌지 않는다 (고치면 새 id) → 오래 캐시할 수 있다
CREATE TABLE drawings (
  id          TEXT    PRIMARY KEY,
  house_id    INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  pixels      TEXT    NOT NULL,
  palette     TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX drawings_house ON drawings (house_id, created_at);

-- 츄르 지갑. data 는 WalletData JSON (src/shared/economy.ts)
CREATE TABLE wallets (
  house_id  INTEGER PRIMARY KEY REFERENCES houses (id) ON DELETE CASCADE,
  coins     INTEGER NOT NULL DEFAULT 0,
  data      TEXT    NOT NULL DEFAULT '{}'
);

-- 기존 칸 방식 마당 → 자유 배치 좌표 (x = 칸x - 2.5, z = 칸y - 2.5, rotY = -rotation 라디안)
INSERT INTO house_decor (house_id, yard)
SELECT house_id,
       json_group_array(json_object('id', 'g' || rowid, 'type', item_type, 'x', x - 2.5, 'z', y - 2.5,
                                    'rotY', round(-rotation * 0.017453292519943295, 4)))
FROM yard_items GROUP BY house_id;

-- 이미 마당에 놓은 아이템은 가진 것으로 친다 (상점 아이템이 된 캣타워, 해먹 등)
INSERT INTO wallets (house_id, coins, data)
SELECT house_id, 50, json_object('owned', json_group_array(DISTINCT item_type))
FROM yard_items GROUP BY house_id;

-- 구역 목록 모양이 바뀌었으니 전부 다시 만든다
UPDATE zone_cache SET dirty = 2;
