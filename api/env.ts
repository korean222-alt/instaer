/** Worker 가 받는 바인딩 (wrangler.jsonc 와 이름을 맞춘다) */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 실시간: 구역/방 하나 = 객체 하나 */
  REALTIME: DurableObjectNamespace;
  /** 입주 (IP 당 1분 5번) */
  RL_MOVE_IN?: RateLimit;
  /** 꾸미기 저장, 예뻐요 (IP 당 1분 40번) */
  RL_WRITE?: RateLimit;
  /** 실시간 접속 (IP 당 1분 20번) */
  RL_CONNECT?: RateLimit;
  /** 부하 시험용 (로컬 .dev.vars 에만 둔다. 배포 환경에는 두지 않는다) */
  LOADTEST_KEY?: string;
}
