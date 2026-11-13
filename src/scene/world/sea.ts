import * as THREE from 'three';
import type { Atmosphere } from '../core/atmosphere';
import { LAND_RANGE, SHORE_D } from './constants';
import type { MapUniforms } from './mapUniforms';

/**
 * 바다. 큰 평면 한 장에 색만 칠한다(조명 계산 없음).
 * - 해안에서 멀어질수록 얕은 색 → 깊은 색
 * - 물가의 흰 거품 띠와 밀려오는 잔물결
 * - 낮에는 햇빛 반짝임, 밤에는 물에 비친 별빛
 * - 아주 먼 곳은 수평선 색으로 흐려진다
 */
export function createSea(map: MapUniforms, noise: THREE.Texture, atmosphere: Atmosphere) {
  const uniforms = {
    uMapTex: map.uMapTex,
    uNoiseTex: { value: noise },
    uMapMin: map.uMapMin,
    uMapSize: map.uMapSize,
    uTime: atmosphere.shared.uTime,
    uNight: atmosphere.shared.uNight,
    uShallow: { value: atmosphere.seaShallow },
    uDeep: { value: atmosphere.seaDeep },
    uFoam: { value: atmosphere.foam },
    uHorizon: { value: atmosphere.horizon },
    uFocus: { value: new THREE.Vector2() },
    uFade: { value: new THREE.Vector2(60, 260) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vXZ;
      uniform sampler2D uMapTex;
      uniform sampler2D uNoiseTex;
      uniform vec2 uMapMin;
      uniform float uMapSize;
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uShallow, uDeep, uFoam, uHorizon;
      uniform vec2 uFocus;
      uniform vec2 uFade;

      void main() {
        float land = (texture2D(uMapTex, (vXZ - uMapMin) / uMapSize).r - 0.50196) * 2.0079 * ${LAND_RANGE.toFixed(1)};
        float d = land - ${SHORE_D.toFixed(2)};        // 0 이 물가, 바다 쪽이 -
        float n1 = texture2D(uNoiseTex, vXZ * 0.021 + uTime * 0.006).r;
        float n2 = texture2D(uNoiseTex, vXZ * 0.075 - uTime * 0.011).g;
        float n3 = texture2D(uNoiseTex, vXZ * 0.16 + vec2(uTime * 0.02, -uTime * 0.014)).a;

        // 깊이에 따른 물 색
        float depth = clamp(-d / ${(LAND_RANGE + SHORE_D).toFixed(2)}, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth * 1.05 + (n1 - 0.5) * 0.1));
        // 먼바다의 잔잔한 물결 무늬
        // 먼바다의 잔물결: 노이즈의 등고선을 따라 그린 가는 곡선을 군데군데만 보이게
        float nA = texture2D(uNoiseTex, vXZ * 0.052 + vec2(uTime * 0.012, uTime * 0.005)).r;
        float nB = texture2D(uNoiseTex, vXZ * 0.047 - vec2(uTime * 0.008, uTime * 0.011) + 0.4).g;
        float lineD = abs(nA - nB);
        float lw = max(fwidth(lineD), 1e-4);
        float ripple = (1.0 - smoothstep(0.012 - lw, 0.012 + lw, lineD)) * smoothstep(0.5, 0.62, n3)
          * smoothstep(-1.0, -3.0, d);
        col = mix(col, mix(uShallow, vec3(1.0), 0.55), ripple * mix(0.4, 0.26, uNight));

        // 물가 거품: 가장자리 띠 + 밀려오는 물결 두 줄
        float breathe = sin(uTime * 0.9 + n1 * 6.0) * 0.08;
        float edge = smoothstep(-0.34 + breathe, -0.06, d + (n2 - 0.5) * 0.28);
        float wave = sin(d * 3.4 + uTime * 1.15 + n2 * 5.0);
        float bands = smoothstep(0.82, 0.95, wave) * smoothstep(-3.4, -0.5, d) * (0.35 + 0.65 * n3);
        float foam = clamp(max(edge, bands * 0.75), 0.0, 1.0);
        col = mix(col, uFoam, foam * 0.9);

        // 반짝임: 칸마다 하나씩, 제각각 깜빡인다
        vec2 g = vXZ * mix(0.55, 0.95, uNight);
        vec2 id = floor(g);
        vec4 rnd = texture2D(uNoiseTex, (id + 0.5) / 128.0);
        vec2 off = (vec2(rnd.b, fract(rnd.b * 7.31)) - 0.5) * 0.7;
        float tw = 0.5 + 0.5 * sin(uTime * (1.0 + rnd.b * 2.5) + rnd.b * 50.0);
        float dotR = mix(0.05, 0.075, fract(rnd.b * 3.7));
        float sparkle = (1.0 - smoothstep(dotR * 0.4, dotR, length(fract(g) - 0.5 - off)))
          * step(mix(0.9, 0.62, uNight), fract(rnd.b * 13.7)) * tw * smoothstep(-0.8, -2.6, d);
        col += sparkle * mix(vec3(0.55), vec3(1.0, 0.95, 0.78) * 0.95, uNight);

        // 물가는 맑아서 모래가 비쳐 보인다
        float alpha = mix(0.3, 1.0, smoothstep(0.0, -1.5, d));
        alpha = max(alpha, foam * 0.85);

        // 먼 곳은 수평선 색으로
        float far = smoothstep(uFade.x, uFade.y, length(vXZ - uFocus));
        col = mix(col, uHorizon, far);

        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
