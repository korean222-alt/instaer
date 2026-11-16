// 공통 설정. 씬(src/scene)과 앱(src/app), 서버(api)가 같이 쓰는 값이라 바꿀 때는 CLAUDE.md 도 같이 고친다.
// 이 파일은 Opus 담당이고 씬은 읽기만 한다.

/** 한 구역당 집 수 */
export const ZONE_CAPACITY = 100;
/** 마당 한 변의 칸 수 (6x6) */
export const YARD_SIZE = 6;
/** 창립 주민으로 치는 마지막 번지 */
export const FOUNDER_MAX = 100;

/** 동네 하나의 집 수 (구역 하나 = 동네 10개) */
export const NEIGHBORHOOD_SIZE = 10;

/**
 * 입주 전에 팔로우해 달라고 보낼 인스타 계정 (@ 없이). 비워 두면 팔로우 단계를 건너뛴다.
 * 팔로우했는지는 확인하지 않는다(인스타 메시지 API 는 사업자 인증이 필요해서 못 쓴다). 2026-11-15
 */
export const FOLLOW_HANDLE = 'goyangi.seom';

/** 실시간: 내 주변에서 보이는 다른 유저 수 상한 */
export const NEARBY_MAX = 20;
/** 실시간: 주변으로 치는 거리 (월드 단위) */
export const NEARBY_RADIUS = 40;
/** 실시간: 내 위치를 1초에 보내는 최대 횟수 */
export const MOVE_SEND_HZ = 8;
/** 미니게임 방 인원 상한 */
export const ROOM_MAX = 12;

/** 지붕 색 팔레트 (꾸미기에서 고르는 12색) */
export const ROOF_COLORS = [
  '#ff8f7a', '#f6a55c', '#ffd166', '#c5e17a', '#7fd8b0', '#5cc2b5',
  '#8fd3e8', '#7cc4f2', '#9fa8f0', '#b79cf0', '#ff9ec2', '#d9a37e',
] as const;

/** 꾸미기 아이템 (이름은 화면에 쓰는 한국어) */
export const YARD_ITEMS = [
  { type: 'cat_tower', label: '캣타워' },
  { type: 'hammock', label: '해먹' },
  { type: 'plant', label: '화분' },
  { type: 'sign', label: '간판' },
  { type: 'fish_rack', label: '생선 건조대' },
  { type: 'cushion', label: '방석' },
  { type: 'lantern', label: '등불' },
  { type: 'bench', label: '벤치' },
] as const;
/** 마당 한 곳에 놓을 수 있는 아이템 수 */
export const YARD_ITEM_MAX = 16;
/** 집 몸체가 차지하는 마당 칸 (여기에는 아이템을 못 놓는다) */
export const HOUSE_CELLS = { x0: 1, x1: 4, y0: 0, y1: 2 } as const;

/** 지역 (17개 시도 + 기타). 깃발 색과 지역 대항전에 쓴다 */
export const REGIONS = [
  { id: 'seoul', label: '서울', color: '#ff5d73' },
  { id: 'busan', label: '부산', color: '#2f9bff' },
  { id: 'daegu', label: '대구', color: '#ff9f1c' },
  { id: 'incheon', label: '인천', color: '#19c6c2' },
  { id: 'gwangju', label: '광주', color: '#ffd23f' },
  { id: 'daejeon', label: '대전', color: '#8e6bff' },
  { id: 'ulsan', label: '울산', color: '#3a6ff7' },
  { id: 'sejong', label: '세종', color: '#ff7bd5' },
  { id: 'gyeonggi', label: '경기', color: '#3fc35f' },
  { id: 'gangwon', label: '강원', color: '#1f9d6b' },
  { id: 'chungbuk', label: '충북', color: '#b8d532' },
  { id: 'chungnam', label: '충남', color: '#f2743a' },
  { id: 'jeonbuk', label: '전북', color: '#c05be8' },
  { id: 'jeonnam', label: '전남', color: '#e63b4a' },
  { id: 'gyeongbuk', label: '경북', color: '#8a5a3c' },
  { id: 'gyeongnam', label: '경남', color: '#5ad1f0' },
  { id: 'jeju', label: '제주', color: '#ff8a3d' },
  { id: 'other', label: '기타', color: '#9aa3ad' },
] as const;

// ── 자유 배치 꾸미기 (씬 작업 4) ──

/**
 * 자유 배치 아이템 전체. 씬의 src/scene/free/catalog.ts 와 종류 이름이 같아야 한다.
 * - mount: floor(바닥), rug(깔개), wall(벽, 집 안만)
 * - art: 직접 그린 그림을 붙일 수 있는지
 * - price: 상점 가격(츄르). null 이면 처음부터 가진 기본 아이템
 * - quest: 퀘스트로도 받을 수 있으면 true (상점에서도 살 수 있다)
 */
export const DECOR_ITEMS = [
  { type: 'cushion', label: '방석', mount: 'floor', art: false, price: null },
  { type: 'sign', label: '간판', mount: 'floor', art: true, price: null },
  { type: 'lantern', label: '등불', mount: 'floor', art: false, price: null },
  { type: 'bench', label: '벤치', mount: 'floor', art: false, price: null },
  { type: 'chair', label: '의자', mount: 'floor', art: false, price: null },
  { type: 'table', label: '탁자', mount: 'floor', art: false, price: null },
  { type: 'rug', label: '러그', mount: 'rug', art: true, price: null },
  { type: 'frame', label: '액자', mount: 'wall', art: true, price: null },
  { type: 'plant', label: '화분', mount: 'floor', art: false, price: 40 },
  { type: 'window', label: '창문', mount: 'wall', art: false, price: 50 },
  { type: 'fish_rack', label: '생선 건조대', mount: 'floor', art: false, price: 60 },
  { type: 'floor_lamp', label: '스탠드 조명', mount: 'floor', art: false, price: 70 },
  { type: 'hammock', label: '해먹', mount: 'floor', art: false, price: 90 },
  { type: 'bookshelf', label: '책장', mount: 'floor', art: false, price: 100 },
  { type: 'cat_tower', label: '캣타워', mount: 'floor', art: false, price: 130 },
  { type: 'bed', label: '침대', mount: 'floor', art: false, price: 140 },
  { type: 'sofa', label: '소파', mount: 'floor', art: false, price: 160 },
  // 2026-11-16: 그림을 걸어 두는 캔버스 (누르면 크게 본다)
  { type: 'easel', label: '그림 캔버스', mount: 'floor', art: true, price: 80 },
] as const;
export type DecorType = (typeof DECOR_ITEMS)[number]['type'];
/** 처음부터 가진 아이템 */
export const STARTER_ITEMS: readonly string[] = DECOR_ITEMS.filter((i) => i.price === null).map((i) => i.type);
export const decorItem = (type: string) => DECOR_ITEMS.find((i) => i.type === type);

/** 마당 한 변의 절반 (자유 배치 좌표 -3 ~ 3) */
export const YARD_HALF = 3.6;
/** 집 안 한 변의 절반 (자유 배치 좌표 -4 ~ 4) */
export const ROOM_HALF = 4;
/** 마당 / 집 안에 놓을 수 있는 아이템 수 */
export const FREE_YARD_MAX = 20;
export const FREE_ROOM_MAX = 30;

/** 벽지, 바닥 기본 무늬 (씬의 ROOM_STYLES 와 같다). 이 밖에 '#rrggbb' 와 'drawing:그림id' 도 된다 */
export const WALLPAPERS = [
  { id: 'cream', label: '크림' },
  { id: 'stripe', label: '줄무늬' },
  { id: 'dots', label: '물방울' },
] as const;
export const FLOORS = [
  { id: 'wood', label: '나무' },
  { id: 'tile', label: '타일' },
  { id: 'carpet', label: '카펫' },
] as const;
/** 벽지/바닥 단색 고르기 */
export const ROOM_COLORS = ['#fff4e0', '#ffe1d6', '#e6f2d9', '#d9ecf2', '#e8e0f5', '#f2e6c9', '#d8c3a5', '#bfd8c9'] as const;

/** 직접 그린 그림: 32x32 픽셀, 16색, 512바이트 */
export const DRAWING_SIZE = 32;
export const DRAWING_BYTES = 512;
/** 집 한 채가 가질 수 있는 그림 수 */
export const DRAWING_MAX = 12;
