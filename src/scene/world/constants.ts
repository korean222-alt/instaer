import { YARD_SIZE } from '../../shared/config';

/** 마당 한 칸의 실제 길이 */
export const CELL = 1;
/** 마당 한 변의 길이 */
export const YARD_WORLD = YARD_SIZE * CELL;
/** 풀밭 높이 (바다는 y=0) */
export const GROUND_Y = 0.42;
/** 해안선에서 안쪽으로 이만큼 들어온 곳이 물가 */
export const SHORE_D = 0.63;
/** 해안선에서 안쪽으로 이만큼 들어온 곳부터 풀밭 */
export const GRASS_EDGE = 2.3;
/** 지도 텍스처에 담는 해안 거리 범위 (±) */
export const LAND_RANGE = 4;
/** 지도 텍스처에 담는 길/광장 거리 범위 (±) */
export const PATH_RANGE = 2;
/** 마당 가운데에서 집 가운데까지의 z 거리 (집은 마당 뒤쪽에 선다) */
export const HOUSE_OFFSET_Z = -1.3;
