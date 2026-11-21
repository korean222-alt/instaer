# 고양이섬 프로젝트 (CLAUDE.md)

새 대화를 시작할 때 이 파일을 먼저 읽는다. 긴 대화 기록 없이도 작업을 이어갈 수 있게 하는 파일이다.

## 배포 규칙 (2026-11-15 사용자: "다음 새 채팅에서도 만들면 바로 배포까지 하게 해줘")
- **코드를 고쳐 만들면 끝에 바로 배포까지 한다. 사용자에게 배포할지 묻지 않는다.** (README 의 "직접 하실 일"은 이미 끝난 일)
- Cloudflare 가 배포 기준으로 보는 브랜치는 **`claude/zen-mendel-t7b5sp` 하나뿐**이다(Builds 트리거, 이 브랜치에 push 하면 `npm run build` + `npx wrangler deploy` 가 자동 실행). 새 채팅은 브랜치 이름이 매번 다르니 아래 순서로 한다.
  0. **먼저 최신 코드에서 시작한다.** 저장소 기본 브랜치(`claude/great-planck-vzld1e`)는 옛 코드라서, 새 채팅 브랜치가 거기서 시작했으면 작업 전에 `git fetch origin claude/zen-mendel-t7b5sp && git checkout -B <작업 브랜치> FETCH_HEAD` 로 옮긴다. (2026-11-17 에 옛 코드 위에서 작업해 배포 브랜치에 못 올라가 배포가 멈춘 일이 있었다)
  1. 타입 검사와 빌드 통과 확인: `npm install`(없으면) → `npm run typecheck` → `npm run build`
  2. 작업 브랜치에 커밋하고 push
  3. 같은 커밋을 배포 브랜치에도 push: `git push origin HEAD:claude/zen-mendel-t7b5sp` (이미 앞서 가 있으면 fast-forward 라 그냥 된다. 거절되면 `git fetch origin claude/zen-mendel-t7b5sp` 후 `git rebase`/merge 해서 다시 push. force push 는 하지 않는다)
  4. 배포 확인: `curl https://api.cloudflare.com/client/v4/accounts/90803ea7738d89a9cb2ad9a14333183f/builds/workers/4aca8f0441074d948625db0ac32eefc5/builds?per_page=1` 의 `build_outcome` 이 `success` 가 될 때까지 본다(보통 1~2분, 인증은 프록시가 붙인다. 실패하면 `.../builds/<build_uuid>/logs` 로 원인을 보고 고쳐서 다시 push).
- Cloudflare Builds 트리거의 브랜치(`branch_includes`)는 `claude/zen-mendel-t7b5sp` 로 고정한다. 바꾸지 않는다(2026-11-17 에 다른 브랜치로 바뀌어 배포가 멈춘 일이 있었다). push 했는데 빌드가 안 생기면 `.../builds/triggers` 로 확인하고, `POST .../builds/triggers/<trigger_uuid>/builds` `{"branch":"claude/zen-mendel-t7b5sp"}` 로 직접 빌드할 수 있다.
- DB 스키마(`db/migrations`)를 바꿨으면 배포 전에 원격 D1(`cat-island-db`)에 먼저 적용한다. 이 세션 환경에서는 `wrangler deploy` 직접 실행이 401 로 막히니 쓰지 않는다.
- 끝에 사용자에게는 "배포 완료/실패" 와 주소만 짧게 알린다.

## 프로젝트 요약
- 인스타 팔로워가 고양이 집을 입양받는 3D 고양이섬 웹게임. 한 섬에 모두가 같이 산다(공유 섬).
- 입주하면 집 한 채(마당 포함)와 고양이 한 마리를 받고, 집에 인스타 아이디 이름표가 뜬다.
- 분위기: 동물의 숲처럼 여유롭고 아늑하게. 닌텐도 캐릭터, 이름, 그림체를 그대로 따라 하지 않는다.
- **모바일 우선, 세로 화면.** 인스타그램 앱 안의 브라우저(WebView)에서 열린다.
- 스택: Three.js, **Cloudflare 한 곳**: Pages(프론트), Workers(API), D1(SQLite DB), Durable Objects(실시간 방). Vercel 과 Neon 은 쓰지 않는다. 이유: Vercel 무료 플랜은 수익 사업(상업 이용)이 금지이고, Cloudflare 는 무료 한도가 넓으며 한도를 넘으면 요금이 아니라 기능이 실패한다.
  - 배포 단위 (2026-11-14, Opus 단계 0): 프론트와 API 를 **Worker 하나**(정적 파일 `dist` + `/api/*`)로 배포한다. Pages 프로젝트에는 Durable Object 를 직접 넣을 수 없고, 프론트와 API 를 같은 주소에 두어야 인스타 앱 안 브라우저에서 로그인 쿠키가 막히지 않기 때문이다. 설정은 루트 `wrangler.jsonc`.

## 폴더 분담 (절대 서로 침범하지 않는다)
- `src/scene/**` → 3D 씬(섬, 집, 마당, 고양이, 조명, 카메라, 걷기). Fable이 담당
- `src/app/**`, `api/**`(Workers/Pages Functions), `db/**`(D1 스키마와 마이그레이션), `src/shared/**`, 루트의 wrangler 설정 → 화면 UI, 서버, DB, 공통 데이터. Opus가 담당
- `src/shared/types.ts`, `src/shared/config.ts` 는 Opus가 만들고 씬 쪽은 읽기만 한다. 바꿔야 하면 `src/scene/README-scene.md` 에 요청으로 적는다.
- 예외: Opus 쪽 파일이 아직 없는 동안에는 씬 쪽이 빠진 상수와 타입을 **임시로** 추가할 수 있다. 값과 모양은 이 파일과 똑같이 하고, 파일 맨 위에 "임시: Opus 가 이어서 확장"이라고 적고, 추가한 내용을 `src/scene/README-scene.md` 에 기록한다. Opus 는 이 파일을 덮어쓰지 않고 읽고 확장한다.
- 씬은 DB나 서버를 직접 호출하지 않는다. 데이터는 항상 아래 함수로 받는다.
- 2026-11-15 사용자: "페이블을 꼭 안 써도 된다. 퀄리티가 떨어지지 않으면 Opus 가 씬도 해라." Opus 가 씬을 고칠 때도 위 인터페이스 규칙(기존 함수 이름/인자 유지, README-scene.md 갱신)은 그대로 지킨다.

## 공통 설정 (src/shared/config.ts)
- ZONE_CAPACITY = 100 (구역 하나 = 동네 10개 = 집 100채)
- FOLLOW_HANDLE = 'goyangi.seom' (입주 전에 팔로우를 부탁할 운영 계정, @ 없이. 비면 팔로우 단계 없음)
- NEIGHBORHOOD_SIZE = 10 (동네 하나 = 집 10채)
- YARD_SIZE = 6
- FOUNDER_MAX = 100
- REGIONS = [{ id, label, color }] : 17개 시도 + other (깃발 색에 쓴다)
- NEARBY_MAX = 20 (내 주변에서 보이는 다른 유저 수 상한), NEARBY_RADIUS = 40 (월드 단위), MOVE_SEND_HZ = 8, ROOM_MAX = 12 (미니게임 방 인원 상한)

## 공통 타입 (src/shared/types.ts)
- House = { houseNo, igHandle | null, roofColor(hex), region: RegionId, cat: { fur(hex), pattern: 'cheese'|'black'|'calico'|'white'|'gray'|'tuxedo', eyeColor(hex) } | null, likes, isNpc, verified }
- YardItem = { type: 'cat_tower'|'hammock'|'plant'|'sign'|'fish_rack'|'cushion'|'lantern'|'bench', x: 0~5, y: 0~5, rotation: 0|90|180|270 }

- RemotePlayer = { id, houseNo: number | null, handle: string, x, z, rotY, anim: 'idle'|'walk'|'sit'|'jump', cat: House['cat'], fishing?: 'cast'|'wait'|'bite'|'reel'|'caught'|null }
- LocalState = { x, z, rotY, anim }
- PlacedItem = { id, type, x, z, rotY, drawingId? } (마당 -3~3, 넓힌 마당 -3.6~3.6, 집 안 -4~4, 넓힌 집 -5.5~5.5, 미터), InteriorItem = PlacedItem, Drawing = { id, pixels(base64 512바이트), palette: string[16] }, HouseDecor = { houseNo, yard, room, wallpaper, floor, roofArt }

## 씬 인터페이스 (src/scene/index.ts)
createIslandScene(canvas) → IslandScene
- setHouses(houses), setYardItems(houseNo, items), setUnlockedZones(count)
- setTimeOfDay('day'|'night'), focusHouse(houseNo), highlightHouse(houseNo|null)
- highlightRegion(regionId|null)  : 그 지역 집을 밝게, 나머지는 흐리게
- onHouseTap(cb), resize(), dispose()
- (걷기 작업 시 추가) setWalkMode(on, startHouseNo?), onNearHouse(cb(houseNo|null))
- (멀티플레이 작업 시 추가) setRemotePlayers(players: RemotePlayer[]), onLocalMove(cb(state: LocalState)), getLocalState()
- (작업 5에서 추가) setRoofArt(items: {houseNo, drawingId}[]), setNpcs(npcs: {id, name, x, z, rotY, cat, role?}[]), onNpcTap(cb(id)), setFishing('cast'|'wait'|'bite'|'reel'|'caught'|null), setLocalPosition(x, z, rotY?), renderCatPreview(cat, size?, options?) → PNG data URL. 따로 내보내는 것: fishingSpotAt(x, z) → {kind: 'pond'|'pier', x, z} | null, POND_R, dockArea()
- (2026-11-15 추가) enterNpcHome(homeId, interior, wallpaper?, floor?), enterCave(level, nodes), setCaveNodes(nodes), exitCave(), onExitCave(cb), caveNodeNear(reach?), setWalkZoom(0~1), renderItemPreview(type, size?). 따로 내보내는 것: npcHomes(zones), caveMouths(zones), mapHills(zones), landAt, CAVE_DEEPER
- (2026-11-16) onArtTap(cb(drawingId, type)), getViewYaw(), setRiding('drive'|'passenger'|null, driverId?), enterHouse 의 다섯째 인자 big. 따로 내보내는 것: mailboxPos(houseNo)
- (2026-11-16 겨울) setBigYards(houseNos) : 마당 넓힌 집(7.2m, 나머지는 6m), setWinter(on) : 눈(나무는 늘, 밤에는 땅/빈 집 지붕), LED, 크리스마스 트리, 눈 내림
- (2026-11-17 최적화) createIslandScene(canvas, options?: { graphics?: 'auto'|'normal'|'low', rememberLow? }), setGraphicsMode(mode), getGraphicsState() → { mode, low, weakDevice, quality }, onAutoLowSpec(cb). 앱은 설정 '화면 품질'(src/app/graphics.ts, localStorage ci_gfx)로 고른다. 기본은 '보통'(2026-11-18 사용자: 자동 기본 금지), '보통'은 해상도를 한 단계(0.82)까지만 낮춘다
- (2026-11-18 꾸미기 시점) rotateView(step?), setTopView(on), getTopView(), resetView()
- (2026-11-19 촬영) remoteScreenPos(id) : 걷기 모드가 아니어도 다른 유저 고양이 머리 위 화면 자리, onAfterRender(cb|null) : 섬을 그린 직후 (녹화/썸네일 캔버스 복사)
- (2026-11-15 소통) setDance(id|null), setSitting(on), catScreenPos(id|null) → {x,y}|null, onRemoteTap(cb(id)), RemotePlayer.dance. 따로 내보내는 것: townSquares(zones), benchNear(x,z), TOWN_SQUARE, walkCost(x,z,zones,hasHouse)
- (작업 4에서 추가) enterHouse(houseNo, interior: InteriorItem[], wallpaper?, floor?), exitHouse(), setInteriorItems(items), onDoor(cb(houseNo|null)), onExitHouse(cb(houseNo)), setYardItemsFree(houseNo, items: PlacedItem[]), startPlacing(typeOrItemId?, houseNo?), stopPlacing(), rotatePlacing(step?), onPlace(cb(item)), onPick(cb(itemId)), setDrawings(drawings). 자세한 약속은 `src/scene/README-scene.md`
- 위치 계산: `houseSlot(houseNo)` → { x, z, zone, neighborhood } (src/scene/layout.ts). 위치는 DB에 저장하지 않는다.

## 설계 결정 (바꾸지 않는다)
- 집은 "동네" 단위로 배치한다. 동네 중심에 광장/연못/큰 나무, 둘레에 집 10채를 느슨하게 둥글게. 격자 도시처럼 보이면 안 된다.
- 시점은 3단계: 전체(동네가 작은 섬 조각) → 동네(기본, 한 번에 20채 이하) → 내 마당(꾸미기).
- 지역은 입주할 때 한 번 정하고 바꾸지 못한다. 지역 깃발은 동네 시점에서만 작게 보이고, 전체 시점에서는 동네 단위 색으로 합친다.
- 집, 고양이, 아이템은 같은 모양을 복제해서 그리는 방식(InstancedMesh). 멀리서는 LOD로 단순화한다.
- 걷기는 섬 전체를 자유롭게 걸어 다니는 3인칭이다(바다, 집 몸체, 큰 나무만 막는다). 점프 버튼이 있다.
- 멀티플레이: 내 주변의 몇 명(NEARBY_MAX)만 실시간으로 보인다. 미니게임 방 안에서는 참가자가 거리와 상관없이 모두 보인다. (아래 "멀티플레이 방침")
- 이번 버전에서 하지 않는 것: 전체 채팅(주변 채팅만 있다), 개인 땅 구매, 인스타 DM 자동 인증, 사람 캐릭터, 현금 결제.
- 입주는 soft (2026-11-15 사용자): 인스타 DM 인증은 사업자 인증이 필요해서 못 쓴다. 입주 화면이 운영 계정 팔로우를 부탁만 하고(`FOLLOW_HANDLE`, 비면 건너뜀) 확인은 하지 않는다. 입주할 때 열린 구역 안의 빈 집을 직접 고른다(안 고르면 빈 번지 중 앞 번호). 열린 구역 수는 입주 수로 센다(`src/shared/zones.ts`).
- 놀거리 (2026-11-15 사용자 요청): 돈은 "츄르"(서버만 지급, 지갑 한 줄 JSON 이라 DB 쓰기가 적다). 퀘스트는 주민에게 말을 걸어 받는다(주민마다 하루 하나, 한국 시간 자정에 새로 + 특별 부탁). 미니게임(낚시, 생선 받기, 동굴 캐기). 물고기/광석은 가방에 들어가고 잡화점에서 팔아야 츄르가 된다. 주민은 섬 모서리의 주민 집 8채에 산다(빈 집은 입주할 집일 뿐 들어갈 수 없다). 미니게임은 지금은 혼자 하는 2D 판이다(여럿이 하는 방 미니게임은 아직). 규칙은 `src/shared/economy.ts`.
- 겨울 (2026-11-16 사용자): 기간(`WINTER_START`~`WINTER_END`)에는 눈 쌓인 크리스마스 섬. 눈은 **밤에만** 땅과 빈 집 지붕에 쌓이고, 낮에는 나무에만. 눈사람은 겨울 한정 선물(우편함), 마당에만 놓는다. 마당 넓히기는 300츄르(기본 6m → 7.2m).
- 입주할 때 고양이(무늬, 털 색, 눈 색)를 고른다(DB houses.cat, 비어 있으면 아이디로 정해진 고양이). 빈 집 마당에는 고양이가 없다.
- 인스타 인증 (2026-11-17 결정): 사업자 없음 → Meta 심사 불가. 팔로우 → 릴스 댓글 → 키티챗 DM 으로 팔로워 암호(모두 같음) → 사이트에 아이디+암호 → 서버가 그 아이디의 최근 댓글을 읽어 확인. 도용은 되찾기(집 코드 댓글)와 신고 버튼. `tasks/opus-5-인스타인증-키티챗.md` 를 먼저 읽는다.

## 멀티플레이 방침
- 로블록스 같은 완전 오픈 월드가 아니라, **내 주변 몇 명만 보이는** 방식이다. 서버가 각 유저에게 가까운 최대 NEARBY_MAX 명의 위치만 보낸다.
- 씬(`src/scene`)은 네트워크를 모른다. 앱(`src/app/net`)이 서버와 통신하고 `setRemotePlayers` / `onLocalMove` 로만 씬과 주고받는다.
- 실시간은 Cloudflare Durable Objects(WebSocket)로 한다. 방(room) 하나가 객체 하나이고, 월드를 구역 단위로 나눠 한 구역 = 객체 하나로 시작한다. 객체가 그 안의 유저 위치를 들고 있으므로 별도 공유 저장소(Redis 등)는 쓰지 않는다.
- 무료 한도가 있다(들어오는 WebSocket 메시지는 20개가 요청 1건으로 계산되고, 하루 요청 한도가 있다). 위치 전송 횟수를 줄이고, 한도를 넘어 실패하면 단독 모드로 돌아간다. 최신 한도는 Cloudflare 공식 문서에서 확인한다.
- 연결이 끊겨도 자동 재연결하고, 막히면 대안을 제안만 하고 임의로 갈아타지 않는다.
- 실시간이 안 되어도 게임은 혼자서 정상 동작해야 한다(실패 시 단독 모드).
- 미니게임: 방(room) 단위. 방 안의 유저는 거리와 상관없이 모두 보인다(ROOM_MAX 이하). 이번 단계에서는 방 인프라와 테스트 방만 만든다.

## 모바일 조건
- 세로 화면, touch-action: none, dvh/innerHeight, safe-area 고려, devicePixelRatio 최대 2.
- 목표: 폰에서 30fps 이상. 프레임이 떨어지면 해상도/디테일을 자동으로 낮춘다.
- 텍스처와 모델은 작게. WebGL 컨텍스트 복구를 고려한다.

## 작업 규칙
- **메모 규칙 (2026-11-20 사용자: "다음 새 채팅에서도 알아야 될 내용은 말 안 해도 md 파일에 메모해 줘")**: 대화 중 정해진 결정, 운영 상태(외부 서비스 설정 포함), 사용자 선호, 겪은 문제와 해결은 묻지 않고 이 파일(한 줄 요약)이나 관련 문서(`README.md`, `tasks/*.md`)에 적고, 커밋해서 배포 브랜치까지 push 한다. 코드 작업이 없는 상담 대화도 마찬가지다. 새 채팅도 이 규칙을 그대로 따른다.
- 한 번에 한 가지 작업만 한다. 시작할 때 이 파일과 `src/scene/README-scene.md` 를 읽고 현재 상태를 5줄 이내로 요약한 뒤 작업한다.
- 끝나면 `src/scene/README-scene.md` 의 "현재 상태" 를 갱신한다(구현된 것, 안 된 것, 성능 측정 결과, 알려진 문제).
- 기존 인터페이스(함수 이름과 인자)를 바꾸지 않는다. 새 함수만 추가한다.
- 다 만든 뒤 직접 실행해서 오류가 없는지 확인한다.

## 현재 상태
(작업이 끝날 때마다 `src/scene/README-scene.md`(씬) 또는 `README.md`(앱, 서버)에 적고, 여기에는 한 줄 요약만 남긴다)
- 씬(Fable): 작업 1(동네 단위 배치), 작업 2(3인칭 걷기: `setWalkMode`, `onNearHouse`), 작업 3a(다른 유저 고양이 표시: `setRemotePlayers`, `onLocalMove`, `getLocalState`), 작업 4(집 안 들어가기, 끌어서 놓는 자유 배치, 32x32 그림: 씬 쪽만, 2026-11-15) 완료. 작업 5(지붕 그림, 주민 고양이, 낚시 모습, 부두 걷기와 부두 낚시터, 위치 되돌리기, 고양이 그림 찍기, 고양이 눈 키우기: 씬 쪽만, 2026-11-15) 완료. 씬 임시 타입은 shared 로 바꿨다. 실제 폰 fps 는 미측정. 2026-11-17: 겨울 밤 렉 줄이기(전구 빛/눈송이 크기를 해상도에 맞춤, 작은 겨울 나무 삼각형 약 30% 줄임, 그림자 지도 덜 자주/작게, 끊김 감지)와 저사양 모드(설정 '화면 품질', 약한 폰과 버거운 폰은 자동).
- 앱(Opus): 단계 0, A(입주, 입양 카드, 지역 대항전, 꾸미기, 예뻐요, 오늘의 특이한 집, HUD), B(걷기 버튼, 구경하기), C(Durable Object 실시간 주변 20명, 미니게임 방 인프라, 부하 시험) 완료 (2026-11-14). 원격 D1 `cat-island-db` 생성과 스키마 적용 완료. 실제 배포(GitHub 연결)와 실제 폰 시험은 아직. 소리(배경 음악/효과음, 설정), 아이디 숨기기, 사람 많아져도 D1 무료 한도에 맞게 구역별 요약 표(zone_cache, region_counts) 추가(2026-11-15). 자세한 내용은 README.md, README-realtime.md. 2026-11-15: 작업 4 연결(마당/집 안 자유 배치 저장, 32x32 그림판, 지붕 그림 저장), 츄르/상점/퀘스트/주민/낚시/생선 받기 완료(DB `0004`, 원격 적용 완료). 지붕 그림의 3D 표시는 씬 작업 5 대기. `src/shared` 에 RemotePlayer/LocalState 와 실시간 상수가 생겼으니 씬의 임시 타입은 shared 로 바꿀 것(README.md "Fable 에게 요청"). 씬 작업 5 연결(주민 setNpcs, 부두 바다 낚시, 낚시 모습, 서버 fix → setLocalPosition, 3D 입양 카드, 다른 유저 낚시 단계 전송) 완료(2026-11-15). 고양이 고르기(DB `0005`, 원격 적용), 빈 집 고양이 없애기, 다른 유저 낚싯대(씬, Opus), 첫 실제 배포(Builds API 로 이 브랜치) 완료(2026-11-15). soft 입주(팔로우 부탁, 확인 없음), 집 고르기, 원격 입주 데이터 초기화(2026-11-15).
- 2026-11-15 (Opus, 씬 포함): 입주 탭 제거(위쪽 "입주하기", 설정에 입양 카드/닉네임 변경 500츄르), 고양이 이름 = 닉네임, 걷기 미니맵과 시야 넓히기, 섬 네 모서리 땅 + 주민 집 8채(빈 집에는 주민 없음), 바위 언덕, 동굴 산과 동굴 1~3층(광석 캐기), 퀘스트는 주민에게 받아야 시작(하루 한 번 새로), 물고기/광석은 가방 → 잡화점에서 팔기, 상점 3D 가구 그림, 탭해서 놓는 배치, 지붕 색 즉시 반영, 지붕 그림 크게 + 지붕 모양 도화지, 실시간 묶어 보내기(동접 500 계산은 README "동접 500명 계산").
- 입주 화면 변경(2026-11-15 사용자): 입주 첫 화면은 "팔로우하러 가기" 버튼 하나만 항상 띄운다("부탁해요"/"팔로우했어요" 버튼 없음. 누르면 인스타 프로필이 열리고 곧 입주 폼으로 넘어간다. 팔로우 여부는 여전히 확인하지 못한다). 인스타 아이디 대신 **닉네임**(한글/영문/숫자/_, 12자, 중복 불가)을 직접 정한다. 코드 이름 `handle`/`igHandle`/DB `ig_handle` 은 그대로 두고 뜻만 닉네임이다. 화면의 `@` 표시와 "인스타 보러 가기", 아이디 숨기기(설정과 입주 폼)는 없앴다(서버 `setPrivacy` API 는 남겨 둠).
- 2026-11-15 (Opus, 씬 포함): 주변 채팅(저장 안 함), 이모티콘, 춤(츄르로 배움), 앉기, 마을 광장(게시판, 이장 냥냥, 장터 가판대: 잡화점/오락실 주인이 여기로), 이장님 소식(`src/shared/news.ts`, 배포 때 한 줄 추가), 마을 게시판, 섬 지도 개편(지도 탭으로 언제나, 확대, 표시 누르기, 길 안내, 우리 집), 친구/프로필/방명록(DB `0006`, 원격 적용), 입주 팔로우 15초 가짜 확인. 주민은 사람이 아니라 고양이로 둔다(사람 캐릭터는 하지 않음). README.md "소통".
- 2026-11-16 (Opus, 씬 포함): 내 고양이 둘로 보이던 문제(다른 창 접속), 걷기 중 퀘스트, 작은 지도 매 프레임+회전, 화가/우체부 새 주민(잡화점·오락실은 광장에만), 냥냥 말투, 고양이 자동차(500츄르, 뒷자리 한 명), 눌러서 놓기, 마당 7.2m, 집 넓히기(400), 울타리 점프, 지붕 앞뒤 그림(100 한 번), 우편함(환영 편지 50츄르), 꾹 눌러 캐기, 그림 캔버스. README.md "2026-11-16".
- 2026-11-16 (Opus, 씬 포함): 겨울 크리스마스 섬(낮 나무 눈, 밤 땅/빈 집 지붕 눈, LED, 광장 트리, 눈 내림), 눈사람(우편함 선물, 마당 전용), 마당 넓히기 300츄르(기본 6m), 자동 낚시. README.md "2026-11-16 겨울".
- 인스타 인증(키티챗 팔로워 암호 + 댓글 확인), 되찾기, 신고, 소원 비는 곳 (2026-11-17, Opus). 원격 DB 0007 적용, 배포, **운영 중: 방식 `password`, 암호는 원격 DB app_settings.follower_pw**(바꿀 때 키티챗 DM 문구도 같이). ADMIN_KEY 는 아직 없음(관리는 DB 로 직접). 키티챗 규칙 설정과 시험 완료(2026-11-17). 다른 집 지붕/마당 그림이 입주 전 구경꾼과 방금 입주한 사람에게 안 보이던 문제 고침(`src/app/art.ts`). `tasks/opus-5-인스타인증-키티챗.md`.
- 촬영 모드(`?cinema`, 설정 버튼): 릴스용 자동 카메라 장면, 자막, 효과음 (2026-11-17, Opus). README.md.
- 고양이 소리(포먼트 울음, 가르릉, 걷는 중 근처 고양이 울음), 직접 지은 잔잔한 배경 음악(오르골, 잔향, 파도), 첫 접속 로딩 화면(`index.html` #boot) (2026-11-18, Opus). README.md.
- 처음 할 일 안내(입주 뒤 6단계: 걷기, 우편함, 주민 부탁, 낚시, 팔기, 꾸미기 + 길 안내, `#/guide`, HUD 칩) (2026-11-18, Opus). README.md.
- 촬영 모드 새 주민 릴스(최근 입주 집, ElevenLabs 나레이션, 자막, "댓글에 '입주'" 카드, `/api/newcomer`) (2026-11-18, Opus). README.md.
- 촬영 모드 첫 1초 릴스(빈 집 → 내 집 변신, 창립 주민 남은 자리, "옆집 살 친구한테 보내고 댓글에 입주", ElevenLabs 나레이션) (2026-11-18, Opus). README.md.
- 이사(첫 번 무료, 그다음 200츄르, 창립 주민은 1~100 안에서만), 꾸미기 시점(화면 돌리기/위에서 보기/확대, 씬 `rotateView` 등), 꾸미기 점수(프로필에서만, `src/shared/decorScore.ts`), 같은 가구 하나 더 (2026-11-18, Opus). README.md.
- 촬영 모드 연재 릴스("팔로워 1명 = 집 1채, Day N", 약 39초, 집이 하나씩 늘어나는 장면, 새 이웃 5집, 광장 고양이 수다, `/api/series`, 나레이션 길이에 맞춰 영상 늘리기) (2026-11-19, Opus). README.md.
- 소원 비는 곳을 개인 소원 빌기로 바꿈(문구만, DB/API 그대로), 글자 칸에 쓰는 중에는 스페이스/방향키로 고양이가 점프·걷지 않게(`src/scene/walk/controls.ts`) (2026-11-19, Opus).
- 촬영 모드 자동 녹화(화면 기록 없이 MP4/WebM, 글자 카드도 같이, `src/app/reelRecorder.ts`)와 썸네일 사진(고양이 6마리, 글자 없이) (2026-11-19, Opus). README.md.
- 미니지도에 다른 사람 화살표(구역 레이더 3초마다, 지도 밖이면 가장자리 화살표, 집 방향), 섬을 돌아다니는 산책냥(구역마다 3마리, 시계로 정한 자리, 씬 `SceneNpc.moving`) (2026-11-19, Opus). README.md.
- 방명록 친구 아니어도 쓰기, 만든 고양이 울음 삭제 (2026-11-19, Opus). README.md.
- 진짜 고양이 울음 5개(`public/sfx/meow1~5.mp3`), 방명록 새 글 알림창(`/api/me/guestbook`), 새 가구 20개, 곤충 채집(곤충 11종, 도감, 씬 `setBugs`, `/api/game/bug`) (2026-11-19, Opus). README.md.
- 다른 고양이 걸음 부드럽게(보낸 사람 시간줄에 점 놓기, 화면 쪽만, 서버 부담 그대로) (2026-11-19, Opus). README.md.
- 산책냥 부탁(머리 위 "!", 지나가면 말풍선, give/count, 하루 5개), 꾸미기 아래 줄 내 가구/상점 탭(바로 사기), 판 바깥 누르기/끌어 내리기로 닫기, 판 열 때 화면 돌리기 버튼 숨김 (2026-11-19, Opus). README.md.
- 키티챗 인스타 경고(2026-11-19, 자동 대댓글 때문) → 자동 대댓글 끔, 시간당 DM 200→30, DM 지연 설정은 키티챗에 없음. 자세한 건 `tasks/opus-5-인스타인증-키티챗.md` "운영 상태 (2026-11-20)" (2026-11-20).
- 촬영 모드 꾸미기 릴스(지붕 그림 3집, 마당 2집, 잘 꾸민 집 안 3집, 방 안 고양이, `/api/showcase`, 나레이션 `decor-voice.mp3`, 씬: 집 안에서도 촬영 카메라) (2026-11-20, Opus). README.md. 이 세션 컨테이너에서는 운영 사이트 주소가 막혀 있어 시험은 원격 D1 을 로컬 D1 에 복사해 `wrangler dev` 로 한다.
- 넓힌 집 벽걸이 공중에 뜨던 버그 고침, 촬영 끊김 줄이기(녹화 복사 초당 30장, '아주 선명하게' 기본 끔) (2026-11-20, Opus). 실제 폰에서 끊기는지는 사용자 확인 대기.
- 촬영 모드 꾸미기 썸네일(입주 첫날 빈 방 vs 지금 꾸민 방 위아래 비교, 글자 없이) (2026-11-20, Opus). README.md.
- 배경 음악이 폰에서 안 들리던 문제(고양이 울음보다 30dB 작았음): 음악 크게(버스 ×10 → 사용자 '살짝 줄여' 로 ×7, 기본 크기 70, 재 보니 -20~-12dB), 낮은 음 한 옥타브 위 겹침, 끝에 압축기 (2026-11-20, Opus). README.md.
- 가구에 앉기/올라가기(의자/소파/벤치/방석 앉기, 침대/해먹/캣타워 올라가기, 씬 `seatNear`/`sitOnSeat`/`getSeat`), 꾸미기 상점 탭 눌러 보라는 표시 (2026-11-20, Opus). README.md.
- 가구 올라가기 버튼이 곤충/우편함 버튼에 밀리던 것 고침(앉기 버튼 맨 앞, 1.3m), 가구 직접 눌러 올라가기, 탁자/코타츠 추가 (2026-11-21, Opus). README.md.
- 배경 음악 자동 재생: 브라우저가 첫 터치 전에는 소리를 막는다(정책, 못 피함). 켜자마자 한 번 시도 + 아이폰/인스타는 touchend/click 에서만 풀려서 그 이벤트도 듣고 실제로 켜질 때까지 재시도(`initSound`) (2026-11-21, Opus).
- 촬영 모드 겨울밤 릴스(눈 오는 밤, 코타츠 고양이, 광장 트리, 입주 수 + 남은 빈 집 = HUD '다음 섬까지', ElevenLabs 나레이션 `winter-voice.mp3`) (2026-11-21, Opus). README.md. 환경 허용 주소에 `elevenlabsusercontent.com` 추가(나레이션 받기). 이 컨테이너에서 운영 사이트(workers.dev)는 502 로 안 닿아 화면 확인은 `vite preview` + Playwright 로 했다.
