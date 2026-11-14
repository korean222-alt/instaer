-- 로그인 표시(세션)와 예뻐요 IP 제한.

-- 브라우저 로그인 표시. 토큰 원문은 저장하지 않고 SHA-256 해시만 저장한다.
CREATE TABLE sessions (
  token_hash  TEXT    PRIMARY KEY,
  house_id    INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  seen_day    TEXT
);
CREATE INDEX sessions_house ON sessions (house_id);

-- 예뻐요: 같은 IP(통신사 공유 IP 고려해 몇 번까지만)에서 한 집에 하루 몇 번까지
ALTER TABLE likes_log ADD COLUMN ip_hash TEXT;
CREATE INDEX likes_log_day ON likes_log (day, house_id);
