# 고양이섬

인스타 팔로워가 고양이 집을 입양받아 다 같이 사는 3D 섬 웹게임이에요. 세로 화면 모바일 우선이고, 인스타 앱 안의 브라우저에서 열려요.

- 공통 약속(설정, 타입, 씬 함수, 폴더 분담)은 [`CLAUDE.md`](CLAUDE.md) 가 기준이에요.
- 3D 씬 설명은 [`src/scene/README-scene.md`](src/scene/README-scene.md) (Fable 담당).
- 앱, 서버, DB 할 일 목록은 [`tasks/opus-features.md`](tasks/opus-features.md) (Opus 담당).

## 구조 한눈에

```
브라우저 ──▶ Cloudflare Worker "cat-island" (주소 하나)
              ├─ /api/*  → api/index.ts (서버 코드) ──▶ D1 데이터베이스 "cat-island-db"
              └─ 나머지 → dist/ (Vite 로 만든 화면 파일)
```

- **Worker 하나로 화면과 API 를 같이 배포**해요. 같은 주소라서 로그인 쿠키가 인스타 앱 안 브라우저에서도 막히지 않고, 나중에 실시간(Durable Objects)도 이 Worker 에 붙일 수 있어요. Pages 프로젝트는 Durable Object 를 직접 가질 수 없어서 쓰지 않았어요.
- 무료 플랜 기준 D1 한도(2026-11 공식 문서): 하루 읽기 500만 행, 쓰기 10만 행, 저장 5GB. 넘으면 요금이 아니라 그날 자정(한국 시간 오전 9시)까지 쿼리가 실패해요. 그래서 목록과 순위는 캐시해요(단계 A).

## 처음 한 번만 하는 설정 (직접 하실 일)

방법이 세 가지예요. **폰만 있으면 A**, 컴퓨터가 있으면 B 가 편해요. C 는 이 채팅에서 제가 대신 하는 방법이에요.

### A. 대시보드에서 (폰 가능)

1. **데이터베이스 만들기**
   - Cloudflare 대시보드 → **Storage & databases** → **D1** → **Create** (메뉴 이름이 조금 다를 수 있어요).
   - 이름: `cat-island-db` 로 만들어요.
2. **표(테이블) 만들기**
   - 방금 만든 `cat-island-db` → **Console** 탭.
   - 이 저장소의 [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql) 내용을 통째로 복사해 붙여넣고 실행해요.
3. **데이터베이스 ID 알려 주기**
   - `cat-island-db` 화면에 보이는 **Database ID**(긴 영문+숫자)를 복사해서 저에게 알려 주세요. 제가 `wrangler.jsonc` 에 넣어 둘게요.
   - (ID 없이 배포해도 Cloudflare 가 DB 를 새로 하나 만들지만, 그러면 2번에서 만든 표가 없는 빈 DB 가 연결돼요. 그래서 ID 를 먼저 넣는 게 안전해요.)
4. **GitHub 연결 자동 배포**
   - 대시보드 → **Workers & Pages** → **Create application** → **GitHub** → 처음이면 GitHub 로그인과 권한 허용.
   - 저장소 `instaer` 선택.
   - 설정값:
     | 항목 | 값 |
     |---|---|
     | 프로젝트(Worker) 이름 | `cat-island` (반드시 `wrangler.jsonc` 의 `name` 과 같아야 해요) |
     | Git branch (배포 기준 브랜치) | 아래 질문 2번 답에 따라 정해요 |
     | Build command | `npm run build` |
     | Deploy command | `npx wrangler deploy` |
   - **Save and Deploy** → 끝나면 `https://cat-island.<내계정>.workers.dev` 주소가 생겨요.
   - 그 주소 뒤에 `/api/health` 를 붙여 열었을 때 `"db":"ok"` 가 보이면 성공이에요.

### B. 명령줄에서 (컴퓨터)

```bash
npm install
npx wrangler login                                   # 브라우저가 열리면 허용
npx wrangler d1 create cat-island-db                 # 나온 database_id 를 wrangler.jsonc 에 넣기
npm run db:migrate:remote                            # 표 만들기 (원격 DB)
npm run deploy                                       # 빌드 + 배포
```

GitHub 자동 배포는 B 로 한 번 배포한 뒤 대시보드에서 `cat-island` Worker → **Settings** → **Builds** → **Connect** 로 붙여요.

### C. 이 채팅의 Cloudflare 커넥터로 (제가 대신)

이 채팅에는 Cloudflare 커넥터가 연결되어 있어서, 허락해 주시면 제가 **D1 만들기 + 표 만들기 + ID 를 `wrangler.jsonc` 에 넣기**까지 할 수 있어요. GitHub 연결(A 의 4번)은 커넥터로 할 수 없어서 대시보드에서 직접 하셔야 해요.

## 내 컴퓨터에서 실행

```bash
npm install
npm run db:migrate:local      # 로컬 DB 에 표 만들기 (처음 한 번)
npm run dev:api               # 터미널 1: 서버(API) http://localhost:8787
npm run dev                   # 터미널 2: 화면 http://localhost:5173 (API 는 8787 로 넘겨줌)
```

- `http://localhost:5173/` : 앱
- `http://localhost:5173/scene-demo.html` : 3D 씬 확인용 데모 (Fable)
- 실제 배포와 똑같이 보려면 `npm run preview:cf` (빌드 후 Worker 하나로 http://localhost:8787 에서 실행)
- 타입 검사: `npm run typecheck` (화면 코드와 서버 코드 둘 다)
- 로컬 DB 는 `.wrangler/` 폴더에 저장돼요(저장소에 올라가지 않아요).

## 폴더

```
index.html          앱 페이지
scene-demo.html     씬 데모 페이지 (Fable)
wrangler.jsonc      Cloudflare 설정 (Worker 이름, 정적 파일, D1 바인딩)
src/app/            화면 UI (Opus)
  main.ts           입구: 씬 캔버스 + 상단 HUD + 하단 메뉴 + 화면 전환
  router.ts         #/map, #/move-in, #/rank, #/decorate
  screens/          입주 / 순위 / 꾸미기 판
  net/api.ts        서버 호출은 전부 여기서
  village.ts        빈 번지를 NPC 집으로 채우기
src/scene/          3D 씬 (Fable). 앱은 createIslandScene 만 씀
src/shared/         공통 설정과 타입 (씬과 앱이 같이 씀)
api/                서버(Worker) 코드 (Opus)
  index.ts          /api/* 길 나누기
  routes/health.ts  GET /api/health (D1 연결 확인, 집 수)
db/migrations/      D1 스키마. 바꿀 때는 새 번호 파일을 추가 (0002_...sql)
tasks/              작업 지시문
```

## 현재 상태 (앱, 서버)

**단계 0 완료 (2026-11-14)**

- 됨
  - 앱 뼈대: 3D 씬을 화면 전체에 깔고, 하단 메뉴(지도/입주/순위/꾸미기)로 판을 여닫아요. 주소의 `#/rank` 처럼 화면이 바뀌어 뒤로 가기도 돼요.
  - 상단 HUD: 서버에서 집 수를 받아 "입주 N마리", "다음 섬까지 N마리". 서버가 안 되면 "혼자 둘러보는 중" 표시 후 씬만 보여요(단독 모드).
  - 빈 번지는 앱이 NPC 집(흐린 지붕 + 고양이)으로 채워서 섬이 휑하지 않아요.
  - 밤 7시~아침 6시는 밤 화면.
  - Worker + D1 구조, 첫 스키마(`houses`, `yard_items`, `claim_codes`, `likes_log`), `GET /api/health`.
- 직접 확인한 것
  - `npm run typecheck`, `npm run build` 오류 없음.
  - 로컬 Worker(`wrangler dev`)에서 마이그레이션 적용 → `/api/health` 가 `{"ok":true,"db":"ok","houses":0}`, 집 한 채 넣으면 `houses: 1` → HUD 에 "입주 1마리".
  - 없는 API 는 404 JSON, 그 밖의 주소는 앱 화면이 나와요.
  - 폰 크기(iPhone 13) 화면에서 씬, HUD, 메뉴, 입주 판이 겹치지 않고, 페이지 오류 없음.
- 아직 안 된 것 (단계 A)
  - 입주, 입양 카드, 지역 순위, 꾸미기, 예뻐요, 오늘의 특이한 집, 내 집 찾기. 판들은 지금 모양만 있어요.
  - `src/shared` 에 `NEIGHBORHOOD_SIZE`, `NEARBY_MAX` 등 CLAUDE.md 의 나머지 상수와 `RemotePlayer` 타입 추가, "임시" 표시 지우기.
- 알려진 문제
  - 씬 코드가 한 덩어리 약 675KB(압축 약 180KB)라 빌드 경고가 나와요. 첫 화면 로딩이 느리면 나중에 나눠 불러오기를 검토해요.
  - 실제 Cloudflare 에는 아직 배포하지 않았어요(위 "처음 한 번만 하는 설정" 이후).
