import * as THREE from 'three';

/**
 * 집, 소품, 장식에 같이 쓰는 재질.
 * - 꼭짓점 색으로 칠한다 (텍스처 없음)
 * - aMask.x: 인스턴스 색(iTint, 예: 지붕 색)을 받는 정도
 * - aMask.y: 밤에 빛나는 정도 (창문, 등불). 진짜 조명 대신 재질 자체를 밝힌다
 *
 * 인스턴스(집)마다 넣는 값 (instanced 일 때)
 * - iTint  : 지붕 색
 * - iState : x=흐리게(빈 집), y=불 켜짐(0~1), z=지역 번호(없으면 -2), w=숨김(1이면 안 그림)
 *
 * 지역 강조(highlightRegion)는 집마다 값을 바꾸지 않는다.
 * 공용 값 uRegion(x=지역 번호, y=강조 정도 0~1) 하나만 바꾸면 셰이더가
 * "내 지역 번호와 같은가"를 보고 밝게/흐리게 칠한다. 그래서 3,000채여도 비용이 같다.
 */
export interface GlowShared {
  uNight: { value: number };
  uTime: { value: number };
  /** x=강조할 지역 번호, y=강조 정도(0~1) */
  uRegion: { value: THREE.Vector2 };
}

export function createGlowLambert(shared: GlowShared, opts: { instanced: boolean }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = {
    uNight: shared.uNight,
    uTime: shared.uTime,
    uRegion: shared.uRegion,
    uGlowColor: { value: new THREE.Color('#ffc766') },
    uFadeColor: { value: new THREE.Color('#dfe9e2') },
  };
  const inst = opts.instanced;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec2 aMask;
        ${inst ? 'attribute vec3 iTint;\nattribute vec4 iState;\nuniform vec2 uRegion;' : ''}
        varying vec3 vGlowInfo; // x=빛남, y=흐림, z=불 켜짐
        varying vec2 vRegionFx; // x=다른 지역이라 흐리게, y=강조 지역이라 밝게`,
      )
      .replace(
        '#include <color_vertex>',
        /* glsl */ `#include <color_vertex>
        ${
          inst
            ? `vColor.rgb *= mix(vec3(1.0), iTint, aMask.x);
        vGlowInfo = vec3(aMask.y, iState.x, iState.y);
        float sameRegion = 1.0 - step(0.5, abs(iState.z - uRegion.x));
        vRegionFx = vec2((1.0 - sameRegion) * uRegion.y, sameRegion * uRegion.y);`
            : `vGlowInfo = vec3(aMask.y, 0.0, 1.0);
        vRegionFx = vec2(0.0);`
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${inst ? 'transformed *= 1.0 - iState.w;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uNight;
        uniform vec3 uGlowColor;
        uniform vec3 uFadeColor;
        varying vec3 vGlowInfo;
        varying vec2 vRegionFx;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(gLum), uFadeColor, 0.45), vGlowInfo.y * 0.62);
        // 지역 강조: 다른 지역은 살짝 흐리고 어둡게, 강조 지역은 조금 밝게
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(gLum), uFadeColor, 0.35) * 0.84, vRegionFx.x * 0.64);
        diffuseColor.rgb *= 1.0 + 0.1 * vRegionFx.y;
        float gOn = vGlowInfo.x * uNight * vGlowInfo.z * (1.0 - 0.7 * vRegionFx.x);
        diffuseColor.rgb *= 1.0 - 0.75 * gOn;
        totalEmissiveRadiance += uGlowColor * gOn * 1.25;`,
      );
  };
  mat.customProgramCacheKey = () => `glow-lambert-v2-${inst ? 'inst' : 'static'}`;
  return mat;
}

/** 조각 하나에 색과 마스크를 붙이는 도우미 */
export const GLOW_ATTRS = { position: 3, normal: 3, color: 3, aMask: 2 } as const;
