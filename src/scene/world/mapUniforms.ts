import * as THREE from 'three';
import type { MapField } from './mapField';

/**
 * 땅과 바다 셰이더가 같이 읽는 지도 값.
 * 구역이 새로 열려서 지도를 다시 만들면 여기 값만 바꿔 주면 된다 (재질은 그대로).
 */
export interface MapUniforms {
  uMapTex: { value: THREE.Texture | null };
  uMapMin: { value: THREE.Vector2 };
  uMapSize: { value: number };
}

export function createMapUniforms(): MapUniforms {
  return { uMapTex: { value: null }, uMapMin: { value: new THREE.Vector2() }, uMapSize: { value: 1 } };
}

export function applyMap(u: MapUniforms, map: MapField) {
  u.uMapTex.value = map.texture;
  u.uMapMin.value.set(map.minX, map.minZ);
  u.uMapSize.value = map.size;
}
