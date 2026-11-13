import * as THREE from 'three';

/**
 * 집, 소품, 장식에 같이 쓰는 재질.
 * - 꼭짓점 색으로 칠한다 (텍스처 없음)
 * - aMask.x: 인스턴스 색(iTint, 예: 지붕 색)을 받는 정도
 * - aMask.y: 밤에 빛나는 정도 (창문, 등불). 진짜 조명 대신 재질 자체를 밝힌다
 * - iState.x: 흐리게(빈 집), iState.y: 불 켜짐(0~1)
 */
export interface GlowShared {
  uNight: { value: number };
  uTime: { value: number };
}

export function createGlowLambert(shared: GlowShared, opts: { instanced: boolean }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = {
    uNight: shared.uNight,
    uTime: shared.uTime,
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
        ${inst ? 'attribute vec3 iTint;\nattribute vec2 iState;' : ''}
        varying vec3 vGlowInfo; // x=빛남, y=흐림, z=불 켜짐`,
      )
      .replace(
        '#include <color_vertex>',
        /* glsl */ `#include <color_vertex>
        ${inst ? 'vColor.rgb *= mix(vec3(1.0), iTint, aMask.x);' : ''}
        vGlowInfo = vec3(aMask.y, ${inst ? 'iState.x, iState.y' : '0.0, 1.0'});`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uNight;
        uniform vec3 uGlowColor;
        uniform vec3 uFadeColor;
        varying vec3 vGlowInfo;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(gLum), uFadeColor, 0.45), vGlowInfo.y * 0.62);
        float gOn = vGlowInfo.x * uNight * vGlowInfo.z;
        diffuseColor.rgb *= 1.0 - 0.75 * gOn;
        totalEmissiveRadiance += uGlowColor * gOn * 1.25;`,
      );
  };
  mat.customProgramCacheKey = () => `glow-lambert-${inst ? 'inst' : 'static'}`;
  return mat;
}

/** 조각 하나에 색과 마스크를 붙이는 도우미 */
export const GLOW_ATTRS = { position: 3, normal: 3, color: 3, aMask: 2 } as const;
