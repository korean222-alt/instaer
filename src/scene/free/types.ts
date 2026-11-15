// 임시: Opus 가 이어서 확장
// 자유 배치(작업 4)에 쓰는 타입. 원래 자리는 src/shared/types.ts 인데 아직 그 파일에 없어서
// 씬 안에 임시로 둔다. shared 에 같은 모양으로 생기면 이 파일은 그쪽 것을 다시 내보내기만 한다.
// → README-scene.md "앱 쪽에 알릴 것 / 요청"

/**
 * 자유롭게 놓은 아이템 하나 (마당 또는 집 안).
 *
 * 좌표는 "그 공간의 가운데"가 (0, 0) 이고 단위는 미터(소수)다.
 * - 마당: 가로세로 6. x 는 -3(왼쪽) ~ 3(오른쪽), z 는 -3(뒤, 집 쪽) ~ 3(앞, 대문 쪽)
 * - 집 안: 가로세로 8. x 는 -4(왼쪽 벽) ~ 4, z 는 -4(뒤쪽 벽) ~ 4(앞, 문 쪽)
 * rotY 는 라디안이고 0 이면 앞(+z)을 본다. RemotePlayer.rotY 와 같은 기준이다.
 * 벽에 거는 것(액자, 창문)은 뒤쪽 벽이면 z = -4, rotY = 0 / 왼쪽 벽이면 x = -4, rotY = π/2 다.
 */
export interface PlacedItem {
  /** 아이템마다 고유한 값. 새로 놓을 때 씬이 만들어서 onPlace 로 알려 준다 */
  id: string;
  /** 아이템 종류 이름 (free/catalog.ts 의 FREE_ITEMS 참고). 모르는 이름은 선물 상자로 그린다 */
  type: string;
  x: number;
  z: number;
  rotY: number;
  /** 직접 그린 그림을 붙일 때 (액자, 간판, 러그). setDrawings 로 넘긴 그림의 id */
  drawingId?: string;
}

/** 집 안에 놓는 아이템. 모양은 PlacedItem 과 같다 */
export type InteriorItem = PlacedItem;

/** 직접 그린 그림 한 장: 32x32 픽셀, 16색 */
export interface Drawing {
  id: string;
  /**
   * 픽셀 1024개를 4비트씩 담은 512바이트의 base64.
   * 왼쪽 위에서 시작해 오른쪽으로, 한 줄이 끝나면 아래 줄로 간다.
   * 바이트 하나에 픽셀 둘: 앞 픽셀이 위쪽 4비트, 뒤 픽셀이 아래쪽 4비트. 값은 palette 의 순번(0~15)
   */
  pixels: string;
  /** 색 16개 (hex, 예: '#ff8f7a') */
  palette: string[];
}
