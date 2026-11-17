-- 인스타 인증, 되찾기, 신고, 소원 (2026-11-17). 자세한 흐름은 src/shared/auth.ts.

-- 확인된(또는 적어 낸) 인스타 아이디. 닉네임(ig_handle)과 따로 둔다. 예전 입주자는 비어 있다
ALTER TABLE houses ADD COLUMN ig_id TEXT;
CREATE UNIQUE INDEX houses_ig_id ON houses (ig_id) WHERE ig_id IS NOT NULL;

-- 운영 설정 한 줄씩 (auth_mode, follower_pw, ig_token, ig_last_sync ...)
CREATE TABLE app_settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 서버가 읽어 온 내 게시물/릴스 댓글 (7일 지나면 지운다)
CREATE TABLE ig_comments (
  id        TEXT    PRIMARY KEY,
  username  TEXT    NOT NULL,
  text      TEXT    NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX ig_comments_user ON ig_comments (username, at);

-- 되찾기: 이 코드를 그 아이디로 댓글에 남기면 집을 돌려받는다
CREATE TABLE reclaims (
  code         TEXT    PRIMARY KEY,
  ig_id        TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  verified_at  INTEGER
);

-- 가입/되찾기 기록 (관리자가 도용을 고칠 때 본다). ip 는 해시 앞부분만
CREATE TABLE signup_log (
  id        INTEGER PRIMARY KEY,
  house_no  INTEGER NOT NULL,
  ig_id     TEXT,
  kind      TEXT    NOT NULL,
  ip_hash   TEXT,
  device    TEXT,
  at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX signup_log_device ON signup_log (device);
CREATE INDEX signup_log_at ON signup_log (at);

-- 신고. status 0 = 새 신고, 1 = 처리함
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL,
  house_no    INTEGER,
  ig_id       TEXT,
  contact     TEXT,
  text        TEXT    NOT NULL,
  reporter    INTEGER,
  ip_hash     TEXT,
  status      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX reports_status ON reports (status, created_at);
CREATE INDEX reports_ip ON reports (ip_hash, created_at);

-- 소원 비는 곳: 앞으로 생겼으면 하는 것
CREATE TABLE wishes (
  id          INTEGER PRIMARY KEY,
  house_id    INTEGER REFERENCES houses (id) ON DELETE SET NULL,
  text        TEXT    NOT NULL,
  ip_hash     TEXT,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX wishes_created ON wishes (hidden, created_at);
CREATE INDEX wishes_ip ON wishes (ip_hash, created_at);
