# 고양이섬 프로젝트 (CLAUDE.md)

새 대화를 시작할 때 이 파일을 먼저 읽는다. 긴 대화 기록 없이도 작업을 이어갈 수 있게 하는 파일이다.

## 프로젝트 요약
- 인스타 팔로워가 고양이 집을 입양받는 3D 고양이섬 웹게임. 한 섬에 모두가 같이 산다(공유 섬).
- 입주하면 집 한 채(마당 포함)와 고양이 한 마리를 받고, 집에 인스타 아이디 이름표가 뜬다.
- 분위기: 동물의 숲처럼 여유롭고 아늑하게. 닌텐도 캐릭터, 이름, 그림체를 그대로 따라 하지 않는다.
- **모바일 우선, 세로 화면.** 인스타그램 앱 안의 브라우저(WebView)에서 열린다.
- 스택: Three.js, Vercel(프론트 + /api 서버리스), Neon(Postgres).

## 폴더 분담 (절대 서로 침범하지 않는다)
- `src/scene/**` → 3D 씬(섬, 집, 마당, 고양이, 조명, 카메라, 걷기). Fable이 담당
- `src/app/**`, `api/**`, `db/**`, `src/shared/**` → 화면 UI, 서버, DB, 공통 데이터. Opus가 담당
- `src/shared/types.ts`, `src/shared/config.ts` 는 Opus가 만들고 씬 쪽은 읽기만 한다. 바꿔야 하면 `src/scene/README-scene.md` 에 요청으로 적는다.
- 씬은 DB나 서버를 직접 호출하지 않는다. 데이터는 항상 아래 함수로 받는다.

## 공통 설정 (src/shared/config.ts)
- ZONE_CAPACITY = 100 (구역 하나 = 동네 10개 = 집 100채)
- NEIGHBORHOOD_SIZE = 10 (동네 하나 = 집 10채)
- YARD_SIZE = 6
- FOUNDER_MAX = 100
- REGIONS = [{ id, label, color }] : 17개 시도 + other (깃발 색에 쓴다)
- NEARBY_MAX = 20 (내 주변에서 보이는 다른 유저 수 상한), NEARBY_RADIUS = 40 (월드 단위), MOVE_SEND_HZ = 8, ROOM_MAX = 12 (미니게임 방 인원 상한)

## 공통 타입 (src/shared/types.ts)
- House = { houseNo, igHandle | null, roofColor(hex), region: RegionId, cat: { fur(hex), pattern: 'cheese'|'black'|'calico'|'white'|'gray'|'tuxedo', eyeColor(hex) } | null, likes, isNpc, verified }
- YardItem = { type: 'cat_tower'|'hammock'|'plant'|'sign'|'fish_rack'|'cushion'|'lantern'|'bench', x: 0~5, y: 0~5, rotation: 0|90|180|270 }

- RemotePlayer = { id, houseNo: number | null, handle: string, x, z, rotY, anim: 'idle'|'walk'|'sit'|'jump', cat: House['cat'] }
- LocalState = { x, z, rotY, anim }

## 씬 인터페이스 (src/scene/index.ts)
createIslandScene(canvas) → IslandScene
- setHouses(houses), setYardItems(houseNo, items), setUnlockedZones(count)
- setTimeOfDay('day'|'night'), focusHouse(houseNo), highlightHouse(houseNo|null)
- highlightRegion(regionId|null)  : 그 지역 집을 밝게, 나머지는 흐리게
- onHouseTap(cb), resize(), dispose()
- (걷기 작업 시 추가) setWalkMode(on, startHouseNo?), onNearHouse(cb(houseNo|null))
- (멀티플레이 작업 시 추가) setRemotePlayers(players: RemotePlayer[]), onLocalMove(cb(state: LocalState)), getLocalState()
- 위치 계산: `houseSlot(houseNo)` → { x, z, zone, neighborhood } (src/scene/layout.ts). 위치는 DB에 저장하지 않는다.

## 설계 결정 (바꾸지 않는다)
- 집은 "동네" 단위로 배치한다. 동네 중심에 광장/연못/큰 나무, 둘레에 집 10채를 느슨하게 둥글게. 격자 도시처럼 보이면 안 된다.
- 시점은 3단계: 전체(동네가 작은 섬 조각) → 동네(기본, 한 번에 20채 이하) → 내 마당(꾸미기).
- 지역은 입주할 때 한 번 정하고 바꾸지 못한다. 지역 깃발은 동네 시점에서만 작게 보이고, 전체 시점에서는 동네 단위 색으로 합친다.
- 집, 고양이, 아이템은 같은 모양을 복제해서 그리는 방식(InstancedMesh). 멀리서는 LOD로 단순화한다.
- 걷기는 섬 전체를 자유롭게 걸어 다니는 3인칭이다(바다, 집 몸체, 큰 나무만 막는다). 점프 버튼이 있다.
- 멀티플레이: 내 주변의 몇 명(NEARBY_MAX)만 실시간으로 보인다. 미니게임 방 안에서는 참가자가 거리와 상관없이 모두 보인다. (아래 "멀티플레이 방침")
- 이번 버전에서 하지 않는 것: 채팅, 상점, 미니게임 본체(방 인프라만 준비), 개인 땅 구매, 그림 그리기, 인스타 DM 자동 인증, 사람 캐릭터.

## 멀티플레이 방침
- 로블록스 같은 완전 오픈 월드가 아니라, **내 주변 몇 명만 보이는** 방식이다. 서버가 각 유저에게 가까운 최대 NEARBY_MAX 명의 위치만 보낸다.
- 씬(`src/scene`)은 네트워크를 모른다. 앱(`src/app/net`)이 서버와 통신하고 `setRemotePlayers` / `onLocalMove` 로만 씬과 주고받는다.
- 서버는 Vercel Functions 의 WebSocket(공식 문서에서 현재 상태와 제한 확인)을 먼저 쓴다. 연결은 함수 최대 실행 시간에 끊기므로 자동 재연결이 필수이고, 여러 인스턴스가 있으면 공유 저장소(예: Redis)로 위치를 나눠야 한다. 막히면 대안을 제안만 하고 임의로 갈아타지 않는다.
- 실시간이 안 되어도 게임은 혼자서 정상 동작해야 한다(실패 시 단독 모드).
- 미니게임: 방(room) 단위. 방 안의 유저는 거리와 상관없이 모두 보인다(ROOM_MAX 이하). 이번 단계에서는 방 인프라와 테스트 방만 만든다.

## 모바일 조건
- 세로 화면, touch-action: none, dvh/innerHeight, safe-area 고려, devicePixelRatio 최대 2.
- 목표: 폰에서 30fps 이상. 프레임이 떨어지면 해상도/디테일을 자동으로 낮춘다.
- 텍스처와 모델은 작게. WebGL 컨텍스트 복구를 고려한다.

## 작업 규칙
- 한 번에 한 가지 작업만 한다. 시작할 때 이 파일과 `src/scene/README-scene.md` 를 읽고 현재 상태를 5줄 이내로 요약한 뒤 작업한다.
- 끝나면 `src/scene/README-scene.md` 의 "현재 상태" 를 갱신한다(구현된 것, 안 된 것, 성능 측정 결과, 알려진 문제).
- 기존 인터페이스(함수 이름과 인자)를 바꾸지 않는다. 새 함수만 추가한다.
- 다 만든 뒤 직접 실행해서 오류가 없는지 확인한다.

## 현재 상태
(작업이 끝날 때마다 `src/scene/README-scene.md` 에 적고, 여기에는 한 줄 요약만 남긴다)
- 씬: 작업 1(동네 단위 배치), 작업 2(3인칭 걷기: `setWalkMode`, `onNearHouse`), 작업 3a(다른 유저 고양이 표시: `setRemotePlayers`, `onLocalMove`, `getLocalState`, 데모의 "다른 유저 20명 시험") 완료. 서버와 통신(작업 3b)은 아직. 실제 폰 fps 는 미측정. `RemotePlayer`, `LocalState`, `NEARBY_MAX` 등이 `src/shared` 에 아직 없어서 씬이 임시로 같은 모양을 둔다(README-scene.md "요청" 참고).
