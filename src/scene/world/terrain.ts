import * as THREE from 'three';
import type { Atmosphere } from '../core/atmosphere';
import { GRASS_EDGE, LAND_RANGE, PATH_RANGE, SHORE_D } from './constants';
import { heightFromLand } from './mapField';
import type { MapUniforms } from './mapUniforms';

export interface TerrainBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 섬 하나의 땅 모양: 범위를 격자로 덮고 높이만 준다. 깊은 바닷속은 그리지 않는다 */
export function buildTerrainGeometry(
  b: TerrainBounds,
  landFn: (x: number, z: number) => number,
  cell = 1,
): THREE.BufferGeometry {
  const nx = Math.ceil((b.maxX - b.minX) / cell);
  const nz = Math.ceil((b.maxZ - b.minZ) / cell);
  const verts = (nx + 1) * (nz + 1);
  const pos = new Float32Array(verts * 3);
  const land = new Float32Array(verts);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const x = b.minX + i * cell;
      const z = b.minZ + j * cell;
      const d = landFn(x, z);
      land[k] = d;
      pos[k * 3] = x;
      pos[k * 3 + 1] = heightFromLand(d);
      pos[k * 3 + 2] = z;
    }
  }
  const index: number[] = [];
  const deep = -2.2;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const bb = a + 1;
      const c = a + (nx + 1);
      const d = c + 1;
      if (land[a] < deep && land[bb] < deep && land[c] < deep && land[d] < deep) continue;
      index.push(a, c, bb, bb, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 땅 재질: 모래, 풀밭, 길, 광장을 지도 텍스처의 거리값으로 칠한다.
 * 풀밭 가장자리에는 어두운 테두리와 모래 위 그림자를 그려서 얕은 턱처럼 보이게 한다.
 */
export function createTerrainMaterial(
  map: MapUniforms,
  noise: THREE.Texture,
  atmosphere: Atmosphere,
): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const c = (hex: string) => ({ value: new THREE.Color(hex) });
  const uniforms = {
    uMapTex: map.uMapTex,
    uNoiseTex: { value: noise },
    uMapMin: map.uMapMin,
    uMapSize: map.uMapSize,
    uNight: atmosphere.shared.uNight,
    uLockTint: c('#e6eef2'),
    uSand: c('#f7e6bb'),
    uSandLight: c('#fdf1d2'),
    uSandWet: c('#e3c794'),
    uGrass: c('#a2d977'),
    uGrassLight: c('#b9e58a'),
    uGrassDark: c('#7fc468'),
    uPath: c('#f0dcae'),
    uPathLight: c('#f8e9c4'),
    uPathEdge: c('#d9be8c'),
    uStone: c('#efe6d6'),
    uStoneDark: c('#d8cab4'),
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXZ = transformed.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vXZ;
        uniform sampler2D uMapTex;
        uniform sampler2D uNoiseTex;
        uniform vec2 uMapMin;
        uniform float uMapSize;
        uniform vec3 uSand, uSandLight, uSandWet, uGrass, uGrassLight, uGrassDark;
        uniform vec3 uPath, uPathLight, uPathEdge, uStone, uStoneDark, uLockTint;

        float edgeMask(float d) {
          float aa = max(fwidth(d), 1e-4);
          return smoothstep(-aa, aa, d);
        }

        vec3 groundColor() {
          vec4 m = texture2D(uMapTex, (vXZ - uMapMin) / uMapSize);
          float dLand = (m.r - 0.50196) * 2.0079 * ${LAND_RANGE.toFixed(1)};
          float dPath = (m.g - 0.50196) * 2.0079 * ${PATH_RANGE.toFixed(1)};
          float dPlaza = (m.b - 0.50196) * 2.0079 * ${PATH_RANGE.toFixed(1)};
          vec4 nLow = texture2D(uNoiseTex, vXZ * 0.045);
          vec4 nMid = texture2D(uNoiseTex, vXZ * 0.17 + 0.37);
          vec4 nHi = texture2D(uNoiseTex, vXZ * 0.9);
          float wob = nMid.r - 0.5;

          // 모래: 물가는 젖은 색, 군데군데 밝은 얼룩
          vec3 sand = mix(uSand, uSandLight, smoothstep(0.35, 0.65, nMid.g));
          float wet = 1.0 - smoothstep(${SHORE_D.toFixed(2)} - 0.1, ${SHORE_D.toFixed(2)} + 0.75, dLand + wob * 0.3);
          sand = mix(sand, uSandWet, wet * 0.75);
          sand *= 1.0 - 0.05 * step(0.86, nHi.b);

          // 풀밭: 두 가지 톤의 부드러운 얼룩 + 작은 풀 점
          float ge = dLand - ${GRASS_EDGE.toFixed(2)} + wob * 0.34;
          float grass = edgeMask(ge);
          vec3 g = mix(uGrass, uGrassLight, smoothstep(0.47, 0.53, nLow.r * 0.6 + nMid.g * 0.4));
          g = mix(g, uGrassDark, smoothstep(0.62, 0.66, nMid.a * 0.5 + nHi.g * 0.5) * 0.28);
          g = mix(g, uGrassDark, (1.0 - smoothstep(0.0, 0.34, ge)) * 0.85);
          // 풀밭 턱이 모래에 드리우는 그림자
          sand *= 1.0 - 0.2 * smoothstep(-0.5, 0.0, ge);
          vec3 col = mix(sand, g, grass);

          // 길: 가장자리가 살짝 진한 흙길
          float pe = dPath + wob * 0.2;
          vec3 pc = mix(uPath, uPathLight, smoothstep(0.4, 0.6, nMid.a));
          pc = mix(pc, uPathEdge, (1.0 - smoothstep(0.0, 0.16, pe)) * 0.7);
          pc *= 1.0 - 0.06 * step(0.9, nHi.b);
          col = mix(col, pc, edgeMask(pe) * grass);

          // 광장: 어긋나게 깐 둥근 돌바닥
          vec2 tile = vXZ / 0.82;
          tile.x += step(1.0, mod(tile.y, 2.0)) * 0.5;
          vec2 tf = fract(tile) - 0.5;
          vec2 tid = floor(tile);
          float tRand = texture2D(uNoiseTex, (tid + 0.5) / 128.0).b;
          float joint = max(abs(tf.x), abs(tf.y)) - 0.42;
          float round = length(max(abs(tf) - 0.3, 0.0)) - 0.12;
          vec3 sc = mix(uStone, uStoneDark, tRand * 0.45);
          sc = mix(sc, uStoneDark * 0.86, edgeMask(max(joint, round)));
          sc = mix(sc, uStoneDark * 0.86, (1.0 - smoothstep(0.0, 0.14, dPlaza)) * 0.8);
          col = mix(col, sc, edgeMask(dPlaza) * grass);
          // 아직 열리지 않은 구역은 안개 낀 듯 흐리게
          float lum = dot(col, vec3(0.3, 0.59, 0.11));
          col = mix(col, mix(vec3(lum), uLockTint, 0.6), (1.0 - m.a) * 0.72);
          return col;
        }`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = groundColor();');
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}
