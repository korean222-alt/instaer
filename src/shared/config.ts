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
