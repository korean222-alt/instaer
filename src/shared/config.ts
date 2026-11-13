// 공통 설정. 씬(src/scene)과 앱(src/app, api)이 같이 쓰는 값이라 바꿀 때는 양쪽 지시문도 같이 고친다.
// (앱 쪽 작업이 아직 없어서 씬 작업에서 같은 값으로 임시 생성함)

/** 한 구역당 집 수 */
export const ZONE_CAPACITY = 100;
/** 마당 한 변의 칸 수 (6x6) */
export const YARD_SIZE = 6;
/** 창립 주민으로 치는 마지막 번지 */
export const FOUNDER_MAX = 100;

/**
 * 지역 (17개 시도 + 기타). 깃발 색과 지역 대항전에 쓴다.
 * (앱 쪽 파일이 아직 없어서 씬 작업에서 같은 모양으로 임시 생성함. 색은 앱 쪽에서 바꿔도 된다)
 */
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
