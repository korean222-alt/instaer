-- 소통 (2026-11-15): 친구, 방명록, 마을 게시판.

-- 친구. a 가 b 에게 신청했다. status 0 = 신청 중, 1 = 친구. 한 쌍은 한 줄만 둔다 (서버가 양쪽 순서를 다 본다)
CREATE TABLE friends (
  a           INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  b           INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  status      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (a, b)
);
CREATE INDEX friends_b ON friends (b, status);

-- 방명록: 친구가 그 집에 남기는 한 줄
CREATE TABLE guestbook (
  id          INTEGER PRIMARY KEY,
  house_id    INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX guestbook_house ON guestbook (house_id, created_at);
CREATE INDEX guestbook_author ON guestbook (author_id, created_at);

-- 마을 게시판 (마을 광장): 누구나 하루 몇 줄
CREATE TABLE board_posts (
  id          INTEGER PRIMARY KEY,
  house_id    INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  day         TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX board_posts_created ON board_posts (created_at);
CREATE INDEX board_posts_house_day ON board_posts (house_id, day);
