/** Worker 가 받는 바인딩 (wrangler.jsonc 와 이름을 맞춘다) */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}
