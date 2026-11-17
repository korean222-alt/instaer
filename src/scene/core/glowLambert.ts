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

/**
 * 겨울 (2026-11-16, 크리스마스). uWinter 를 1 로 두면 위를 보는 면에 눈이 쌓인다.
 * 재질마다 어디에 쌓이는지(snow)가 다르다:
 * - 'decor' : 섬 장식. 나무(aSnow=1)는 늘, 나머지(바위, 덤불, 주민 집 지붕 등)는 밤에만, 물(aSnow=-1)은 쌓이지 않는다
 * - 'night' : 마당(잔디, 울타리, 디딤돌). 밤에만
 * - 'house' : 집. 빈 집(iState.x)의 지붕(aMask.x)에만, 밤에만
 * 없으면 눈이 쌓이지 않는다 (고양이, 집 안, 가구).
 */
export const SNOW = { uWinter: { value: 0 } };
export type SnowMode = 'decor' | 'night' | 'house';

export function createGlowLambert(shared: GlowShared, opts: { instanced: boolean; snow?: SnowMode }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const snow = opts.snow;
  const uniforms = {
    uWinter: SNOW.uWinter,
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
        varying vec2 vRegionFx; // x=다른 지역이라 흐리게, y=강조 지역이라 밝게
        ${snow ? `varying vec2 vSnowK; // x=늘 쌓임, y=밤에 쌓임
        varying float vSnowUp;
        varying vec2 vSnowXZ;` : ''}
        ${snow === 'decor' ? 'attribute float aSnow;' : ''}`,
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
    if (snow) {
      const k =
        snow === 'decor'
          ? 'vec2(max(aSnow, 0.0), step(-0.5, aSnow) * (1.0 - step(0.5, aSnow))) * (1.0 - aMask.y)'
          : snow === 'night'
            ? 'vec2(0.0, 1.0 - aMask.y)'
            : inst
              ? 'vec2(0.0, step(0.5, aMask.x) * step(0.5, iState.x))'
              : 'vec2(0.0)';
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        /* glsl */ `#include <worldpos_vertex>
        vec4 snowWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          snowWP = instanceMatrix * snowWP;
        #endif
        snowWP = modelMatrix * snowWP;
        vSnowXZ = snowWP.xz;
        // 화면 기준 법선을 세계 기준으로 (viewMatrix 는 회전이라 뒤집으면 전치)
        vSnowUp = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz).y;
        vSnowK = ${k};`,
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uNight;
        uniform vec3 uGlowColor;
        uniform vec3 uFadeColor;
        varying vec3 vGlowInfo;
        varying vec2 vRegionFx;
        ${snow ? `uniform float uWinter;
        varying vec2 vSnowK;
        varying float vSnowUp;
        varying vec2 vSnowXZ;` : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(gLum), uFadeColor, 0.45), vGlowInfo.y * 0.62);
        // 지역 강조: 다른 지역은 살짝 흐리고 어둡게, 강조 지역은 조금 밝게
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(gLum), uFadeColor, 0.35) * 0.84, vRegionFx.x * 0.64);
        diffuseColor.rgb *= 1.0 + 0.1 * vRegionFx.y;
        ${snow ? `{
          // 눈: 위를 볼수록, 군데군데 얼룩지게
          float sN = 0.5 + 0.25 * sin(vSnowXZ.x * 2.3 + sin(vSnowXZ.y * 1.7)) + 0.25 * sin(vSnowXZ.y * 2.9 + vSnowXZ.x * 0.7);
          // 나무는 꼭대기 쪽만 하얗게 (잎이 다 덮이면 초록이 안 보인다), 나머지는 밤에 위를 보는 면 전부
          float sTree = vSnowK.x * smoothstep(0.66 + sN * 0.2, 0.86 + sN * 0.1, vSnowUp);
          float sGround = vSnowK.y * uNight * smoothstep(0.32 + sN * 0.22, 0.6 + sN * 0.14, vSnowUp);
          float sAmt = uWinter * max(sTree, sGround);
          vec3 sCol = mix(vec3(0.95, 0.97, 1.0), vec3(0.86, 0.91, 0.99), sN * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, sCol, clamp(sAmt, 0.0, 1.0));
        }` : ''}
        float gOn = vGlowInfo.x * uNight * vGlowInfo.z * (1.0 - 0.7 * vRegionFx.x);
        diffuseColor.rgb *= 1.0 - 0.75 * gOn;
        totalEmissiveRadiance += uGlowColor * gOn * 1.25;`,
      );
  };
  mat.customProgramCacheKey = () => `glow-lambert-v3-${inst ? 'inst' : 'static'}-${snow ?? 'nosnow'}`;
  return mat;
}

/** 조각 하나에 색과 마스크를 붙이는 도우미 */
export const GLOW_ATTRS = { position: 3, normal: 3, color: 3, aMask: 2 } as const;
