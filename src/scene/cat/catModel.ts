import * as THREE from 'three';
import { buildCatGeometry } from './catGeometry';
import { createCatMaterial, type CatShared } from './catMaterial';

/**
 * 고양이 "모델"을 만드는 곳.
 * 지금은 코드로 만든 젤리 고양이를 쓴다. 나중에 외부 3D 모델(GLB)로 바꾸고 싶으면
 * 같은 모양(CatModel)을 돌려주는 함수를 하나 더 만들어서 CatFlock 에 넘기면 된다.
 * (CatFlock 은 모델이 어떻게 만들어졌는지 모른다)
 */
export interface CatModel {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** 그림자용 재질 (없으면 기본값) */
  depthMaterial?: THREE.Material;
  /** 발바닥 기준으로 세웠을 때의 대략적인 키 (모델 단위) */
  height: number;
}

export function createProceduralCatModel(shared: CatShared): CatModel {
  const { material, depthMaterial } = createCatMaterial(shared);
  return { geometry: buildCatGeometry(), material, depthMaterial, height: 1 };
}
