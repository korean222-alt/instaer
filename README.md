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

## 처음 한 번만 하는 설정

### 이미 된 것 (2026-11-14, Claude 가 Cloudflare 커넥터로 함)

- D1 데이터베이스 `cat-island-db` 를 만들었어요 (위치: 아시아 태평양). ID 는 `wrangler.jsonc` 에 넣었어요.
- 표(테이블)를 모두 만들었어요 (`db/migrations/0001`, `0002`). 비어 있는 상태예요.
- 나중에 표를 바꿀 때는 `db/migrations/0003_...sql` 을 추가하고 `npm run db:migrate:remote` (또는 대시보드 D1 Console 에 붙여넣기)로 적용해요.

### 직접 하실 일: GitHub 연결 자동 배포 (폰 가능)

1. Cloudflare 대시보드 → **Workers & Pages** → **Create application** → **GitHub** → 처음이면 GitHub 로그인과 권한 허용.
2. 저장소 `instaer` 선택.
3. 설정값:
   | 항목 | 값 |
   |---|---|
   | 프로젝트(Worker) 이름 | `cat-island` (반드시 `wrangler.jsonc` 의 `name` 과 같아야 해요) |
   | Git branch (배포 기준 브랜치) | 합친 코드가 있는 브랜치 (아래 "브랜치" 참고) |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
4. **Save and Deploy** → 끝나면 `https://cat-island.<내계정>.workers.dev` 주소가 생겨요.
5. 그 주소 뒤에 `/api/health` 를 붙여 열었을 때 `"db":"ok"` 가 보이면 성공이에요.

- 배포하면 실시간용 Durable Object(`RealtimeRoom`)도 같이 만들어져요. 따로 할 일은 없어요.
- 배포가 `ratelimits` 때문에 거절되면 `wrangler.jsonc` 에서 그 부분만 지우고 다시 배포해요(코드는 바인딩이 없어도 동작해요).
- `.dev.vars`(부하 시험 키)는 로컬 전용이에요. 대시보드 환경 변수에 `LOADTEST_KEY` 를 넣지 마세요.

### 명령줄로 하고 싶다면 (컴퓨터)

```bash
npm install
npx wrangler login
npm run deploy               # 빌드 + 배포
```

### 브랜치

- 앱(Opus) 작업은 `claude/github-opus-guide-adidrp` 에 있고, Fable 의 최신 씬(`claude/nifty-mendel-1cpmgx`: 동네 배치, 걷기, 다른 유저 표시)을 합쳐 두었어요.
- 지금 저장소 기본 브랜치는 `claude/great-planck-vzld1e`(예전 씬)예요. GitHub 에서 `main` 을 만들어 이 브랜치를 합친 뒤 Cloudflare 배포 기준을 `main` 으로 두는 것을 권해요.

## 내 컴퓨터에서 실행

```bash
npm install
npm run db:migrate:local      # 로컬 DB 에 표 만들기 (처음 한 번)
npm run dev:api               # 터미널 1: 서버(API) http://localhost:8787
npm run dev                   # 터미널 2: 화면 http://localhost:5173 (API 는 8787 로 넘겨줌)
```

- 처음 한 번 가짜 입주자 64명 넣기: `npm run seed:local` (로컬 DB 만. 기존 로컬 데이터는 지워요)
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
  main.ts           입구: 씬 + 상단 HUD + 하단 메뉴 + 화면 전환 + 걷기
  router.ts         #/move-in, #/rank, #/decorate, #/house/12, #/search
  state.ts          내 집, 마을, 순위 상태와 씬 반영
  screens/          입주(입양 카드), 순위, 꾸미기, 집 팝업, 찾기
  ui/               입양 카드(SVG → PNG), 2D 고양이 그림, 알림
  net/api.ts        서버 호출
  net/realtime.ts   실시간 (주변 20명, 미니게임 방, 단독 모드)
  village.ts        빈 번지를 NPC 집으로 채우기
src/scene/          3D 씬 (Fable). 앱은 src/scene 의 공개 함수만 씀
src/shared/         공통 설정, 타입, catLook(아이디 → 고양이), 아이디 검사/욕설 필터, 실시간 약속
api/                서버(Worker) 코드 (Opus)
  index.ts          /api/* 길 나누기
  routes/           village, regions, move-in, me, yard, like, realtime, health
  lib/              세션, 캐시, 속도 제한, 집 데이터
  realtime/         Durable Object (구역/방 하나 = 객체 하나)
db/migrations/      D1 스키마. 바꿀 때는 새 번호 파일을 추가 (0003_...sql)
scripts/            seed-local.mjs (로컬 가짜 입주자), loadtest.mjs (실시간 부하 시험)
tasks/              작업 지시문
```

## API

| 주소 | 하는 일 |
|---|---|
| `GET /api/health` | DB 연결 확인, 집 수 |
| `GET /api/village` | 입주한 집 전체(House), 마당 아이템, 열린 구역 수, 오늘의 특이한 집. 60초 캐시 |
| `GET /api/regions` | 지역별 전체/이번 주 입주 수와 순위. 60초 캐시 |
| `POST /api/move-in` `{handle, region}` | 입주 (지금은 미인증). 로그인 쿠키를 남김. IP 당 1분 5번 |
| `GET /api/me` | 이 브라우저의 내 집 |
| `GET /api/yard/:houseNo` | 마당 아이템과 지붕 색 |
| `PUT /api/yard/:houseNo` `{items, roofColor}` | 내 집만. 집 칸(x 1~4, y 0~2) 금지, 16개까지 |
| `POST /api/like/:houseNo` | 예뻐요. 같은 브라우저는 한 집에 하루 1번, 같은 IP 는 5번까지, 내 집 불가 |
| `GET /api/rt/zone/:n`, `/api/rt/room/:id` | 실시간 WebSocket (README-realtime.md) |
| `GET /api/rt/usage/zone/:n` | 그 구역의 오늘 실시간 사용량 |

- 캐시: Worker 메모리 60초 + Cache API. Cache API 는 **내 도메인을 연결했을 때만** 효과가 있어요(workers.dev 에서는 메모리 캐시만). Workers Cache 기능은 켜지 않았어요: 켜면 정적 파일 요청까지 하루 10만 건 무료 요청에 들어가기 때문이에요.
- 쓰기 요청은 같은 주소에서 온 것만 받아요(Origin 검사).

## 현재 상태 (앱, 서버)

**단계 0, A, B, C 완료 (2026-11-14)**. 단계 D(보류 목록)는 구조만 열어 뒀어요.

### 단계 A (기능)

- 입주: 아이디 정리(소문자, `@` 제거, 영문/숫자/./_ , 30자), 인스타 규칙 검사, 욕설/사칭 필터, 중복 방지, 지역 선택(바꿀 수 없음). 입력하는 동안 내 고양이 미리 보기. 지금은 **미인증**으로 저장하고, `claim_codes` 와 `verified` 로 나중에 DM 코드 인증을 받을 수 있어요.
- 로그인 표시: HttpOnly 쿠키(1년) + 인스타 앱 브라우저가 쿠키를 지울 때를 대비해 localStorage 에 예비 토큰. DB 에는 토큰의 해시만 저장.
- 고양이 입양: `catLook(handle)` 이 아이디로 항상 같은 털/무늬/눈/이름(40개)/성격(40개)을 정해요. 입양 카드는 세로 1080x1920 그림(PNG)으로 만들어 공유 버튼(폰 공유 시트) 또는 길게 눌러 저장. 2D 고양이 그림은 씬과 같은 색을 써요.
- 입주 직후 "부산 3위 · 1위까지 N마리".
- 지역 대항전: 전체/이번 주(한국 시간 월요일부터) 탭, 막대, 내 지역 강조, 지역을 누르면 `highlightRegion`(위쪽 칩으로 해제).
- 꾸미기: 6x6 마당(집 칸 막힘), 아이템 8종 놓기/옮기기/돌리기/빼기, 16개까지, 지붕 12색. 바꾸는 동안 씬에 바로 보이고, 저장하지 않고 닫으면 되돌려요.
- 구경과 예뻐요: 집이나 고양이를 누르면 팝업(아이디, 번지, 지역, 창립 주민, 인증 여부, 꾸미기 수, 예뻐요, 인스타 보러 가기, 신고 자리).
- 오늘의 특이한 집: 오늘 예뻐요를 가장 많이 받은 집(없으면 전체 1등). 위쪽 칩 → 그 집으로, 씬에 금색 표시.
- HUD: 입주 N마리, 다음 섬까지 N마리, 아이디로 집 찾기.
- 창립 주민: 1~100번지.
- 빈 번지는 앱이 NPC 집으로 채워요(서버는 입주한 집만 줘요).

### 단계 B (걷기)

- 지도 오른쪽 아래 "걷기" → `setWalkMode(true, 내 집)`. 걷는 동안 메뉴와 HUD 를 숨기고 오른쪽 위 "걷기 끝".
- `onNearHouse` 로 집 가까이 가면 가운데 아래 "@아이디 집 구경하기" → 집 팝업. 조이스틱(왼쪽 아래)과 점프(오른쪽 아래)는 비워 둠.

### 단계 C (실시간) — 자세한 내용은 [README-realtime.md](README-realtime.md)

- Durable Object(구역 하나 = 객체 하나, Hibernation), 주변 20명, 미니게임 방(12명, `?room=test`), 자동 재연결, 단독 모드, 속도/횟수 제한, 부하 시험(100명: 지연 중앙값 9ms, 최대 20명 보임).

### 직접 확인한 것

- `npm run typecheck`, `npm run build`, `wrangler deploy --dry-run` 오류 없음.
- 로컬 Worker + 가짜 입주자 64명으로 폰 크기(iPhone 13) 화면에서 처음부터 끝까지: 입주 → 입양 카드(PNG) → 꾸미기 저장(서버에 저장된 값 확인) → 순위와 지역 강조 → 집 팝업과 예뻐요 → 아이디 찾기 → 걷기와 구경하기 버튼 → 실시간 연결. 페이지 오류 없음.
- 서버 검사: 잘못된 아이디/욕설/없는 지역 거절, 중복 아이디 거절, 남의 마당 저장 거절, 집 칸 거절, 예뻐요 하루 1번과 내 집 금지, 다른 사이트 요청 거절, 입주 속도 제한.
- 브라우저 두 개가 동시에 걸으면 서로 보임.

### 아직 안 된 것 / 알려진 문제

- **실제 Cloudflare 배포와 실제 폰 시험은 아직** (GitHub 연결 후).
- 씬 코드 덩어리가 약 680KB(압축 약 180KB)라 빌드 경고가 나요. 첫 로딩이 느리면 나눠 불러오기를 검토해요.
- 같은 사람이 브라우저를 바꾸면 다시 입주할 수 없어요(아이디 중복). DM 코드 인증(단계 D)을 붙이면 "내 집 다시 열기"로 해결돼요.
- 오늘의 특이한 집은 UTC 날짜 기준이에요(한국 시간 오전 9시에 바뀜).
- 이번 주 신규 순위는 입주 시각(created_at)으로 세요.
- 실시간 구역 경계와 `fix` 반영은 README-realtime.md 참고.

## Fable 에게 요청 (씬)

1. `src/shared/types.ts` 에 `RemotePlayer`, `LocalState`, `PlayerAnim` 이, `src/shared/config.ts` 에 `NEIGHBORHOOD_SIZE`, `NEARBY_MAX`, `NEARBY_RADIUS`, `MOVE_SEND_HZ`, `ROOM_MAX` 가 생겼어요. 모양과 값은 씬 임시 파일과 같아요(`id` 는 string). 씬의 `src/scene/remote/types.ts` 와 `layout.ts` 의 임시 `NEIGHBORHOOD_SIZE` 를 shared 에서 가져오도록 바꿔 주세요.
2. (새 함수 요청) 걷기 모드에서 서버가 위치를 되돌릴 때 쓸 `setLocalPosition(x, z)` 같은 함수가 있으면 순간이동 방지가 화면에도 반영돼요. 급하지 않아요.
3. (선택) 입양 카드에 3D 고양이를 쓰고 싶으면 `renderCatPreview(cat, size) → 이미지` 같은 함수가 있으면 좋아요. 지금은 2D 그림을 써요.
