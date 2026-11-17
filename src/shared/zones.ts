// 열린 구역(섬 조각) 수. 서버(입주 검사, 마을 목록)와 화면(빈 집 채우기, "다음 섬까지")이 같이 쓴다.
import { ZONE_CAPACITY } from './config';

/**
 * 입주한 집이 total 채이고 가장 큰 번지가 maxNo 일 때 열린 구역 수.
 * 입주할 때 집을 직접 고르므로 번지가 띄엄띄엄 찰 수 있다. 그래서 "가장 큰 번지"가 아니라
 * "입주 수"로 센다: 지금 구역이 다 차면(100채) 다음 구역이 열린다.
 */
export function openZoneCount(total: number, maxNo: number): number {
  return Math.max(1, Math.floor(total / ZONE_CAPACITY) + 1, Math.ceil(maxNo / ZONE_CAPACITY));
}

/** 지금 고를 수 있는 가장 큰 번지 */
export const maxPickableHouseNo = (total: number, maxNo: number) => openZoneCount(total, maxNo) * ZONE_CAPACITY;
