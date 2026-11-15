import * as THREE from 'three';
import { linearColor } from '../util/geo';
import { CAT_DIM } from './catGeometry';

/**
 * 고양이 재질.
 * 한 번의 그리기(InstancedMesh)로 수백 마리를 그리면서 마리마다
 * 털 색/무늬/눈 색/움직임이 다르게 보이도록 전부 셰이더에서 처리한다.
 *
 * 인스턴스(마리)마다 넣는 속성
 * - iFur  : 털 색 (선형 rgb)
 * - iEye  : 눈 색 (선형 rgb)
 * - iPat  : x=무늬 번호, y=시드(0~1, 같은 번지는 항상 같은 값), z=앉은 정도(식빵 자세, 0~1), w=하품(0~1)
 * - iAnim : x=걸음 위상, y=걷는 정도(0~1), z=자는 정도(0~1), w=행복(눈웃음, 0~1)
 */

export const PATTERN_INDEX = { cheese: 0, black: 1, calico: 2, white: 3, gray: 4, tuxedo: 5 } as const;

export interface CatShared {
  uTime: { value: number };
}

const vec3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

const VERT_PARS = /* glsl */ `
attribute float aPart;
attribute float aW;
attribute vec3 aPivot;
attribute vec3 iFur;
attribute vec3 iEye;
attribute vec4 iPat;
attribute vec4 iAnim;
uniform float uTime;
varying vec3 vRest;
varying vec3 vFur;
varying vec3 vEye;
varying vec4 vInfo;   // x=부위, y=꼬리 위치, z=무늬, w=시드
varying vec3 vFace;   // x=눈 감은 정도, y=눈웃음, z=하품

const vec3 CAT_NECK = ${vec3(CAT_DIM.neck)};

vec2 catRot(vec2 v, float a) {
  float s = sin(a), c = cos(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

vec3 catDeform(vec3 p, out float closed) {
  float seed = iPat.y;
  float t = uTime;
  float ph = iAnim.x;
  float walk = iAnim.y;
  float sleep = iAnim.z;
  float awake = 1.0 - sleep;
  float yawn = iPat.w;
  // 앉기(식빵 자세): 잘 때처럼 다리를 접고 몸을 낮추지만 고개는 들고 눈은 뜬다
  float low = max(sleep, iPat.z);
  float breath = sin(t * mix(2.4, 1.2, sleep) + seed * 6.283);

  // 눈 깜빡임: 몇 초에 한 번 짧게
  float bt = fract((t + seed * 9.7) / mix(3.2, 4.6, seed));
  float blink = 1.0 - smoothstep(0.0, 0.03, abs(bt - 0.5));
  closed = max(max(blink, smoothstep(0.25, 0.6, sleep)), smoothstep(0.25, 0.6, yawn));

  if (aPart > 4.5) {
    // 다리: 대각선 다리끼리 같이 움직인다
    float diag = (aPart < 5.5 || aPart > 7.5) ? 0.0 : 3.14159;
    vec3 q = p - aPivot;
    q.yz = catRot(q.yz, sin(ph + diag) * 0.62 * walk);
    p = aPivot + q;
    p.y *= mix(1.0, 0.34, low);
  } else {
    if (aPart < 0.5) {
      // 몸: 숨쉬기 + 잘 때 납작하게
      float k = p.y - 0.09;
      p.y = 0.09 + k * (1.0 + 0.035 * breath) * mix(1.0, 0.9, low);
      p.x *= 1.0 + 0.02 * breath + 0.07 * low;
    } else if (aPart > 3.5) {
      // 꼬리: 뿌리는 고정, 끝으로 갈수록 크게 살랑
      vec3 q = p - aPivot;
      float sway = sin(t * mix(2.7, 0.8, sleep) + seed * 6.283 - aW * 2.2);
      q.x += sway * (0.1 + 0.05 * walk) * aW * aW * mix(1.0, 0.25, sleep);
      // 잘 때는 꼬리를 뒤로 눕힌 다음 몸 옆으로 감는다
      q.yz = catRot(q.yz, -1.35 * sleep);
      float curlSide = seed > 0.5 ? 1.0 : -1.0;
      q.xz = catRot(q.xz, curlSide * sleep * (0.5 + aW * 2.3));
      q.y = mix(q.y, max(q.y, -0.2), sleep);
      p = aPivot + q;
    } else {
      if (aPart > 1.5) {
        // 귀: 가끔 쫑긋, 잘 때는 살짝 눕는다
        float tw = fract((t + seed * 17.0) / mix(4.1, 6.7, seed));
        float pulse = smoothstep(0.0, 0.015, tw) * (1.0 - smoothstep(0.02, 0.07, tw));
        float side = sign(aPivot.x);
        vec3 q = p - aPivot;
        q.xy = catRot(q.xy, -side * (0.3 * pulse * step(0.5, fract(seed * 5.0 + side * 0.25)) + 0.28 * sleep));
        p = aPivot + q;
      }
      // 머리(귀 포함): 갸웃, 끄덕, 잘 때는 앞으로 숙임
      vec3 q = p - CAT_NECK;
      float tilt = sin(t * 0.7 + seed * 11.0) * 0.075 * awake * (1.0 - walk) + 0.09 * sleep;
      float nod = (sin(t * 0.9 + seed * 3.0) * 0.03 - 0.1) * awake + 0.2 * sleep + sin(ph * 2.0) * 0.035 * walk - 0.34 * yawn;
      q.xy = catRot(q.xy, tilt);
      q.yz = catRot(q.yz, nod);
      p = CAT_NECK + q;
      p.y -= 0.03 * sleep;
    }
    p.y -= 0.1 * low;
    p.y += abs(sin(ph)) * 0.016 * walk;
  }
  return p;
}
`;

const VERT_MAIN = /* glsl */ `
float catClosed;
vec3 transformed = catDeform(position, catClosed);
vRest = position;
vFur = iFur;
vEye = iEye;
vInfo = vec4(aPart, aW, iPat.x, iPat.y);
vFace = vec3(catClosed, iAnim.w, iPat.w);
`;

const VERT_MAIN_DEPTH = /* glsl */ `
float catClosed;
vec3 transformed = catDeform(position, catClosed);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vRest;
varying vec3 vFur;
varying vec3 vEye;
varying vec4 vInfo;
varying vec3 vFace;
uniform vec3 uCream;
uniform vec3 uPink;
uniform vec3 uInk;
uniform vec3 uInkLight;
uniform vec3 uBlush;
uniform vec3 uCalicoDark;
uniform vec3 uRimColor;

const vec3 CAT_HEAD = ${vec3(CAT_DIM.headCenter)};

float catHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float catNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(catHash(i), catHash(i + vec3(1, 0, 0)), f.x),
        mix(catHash(i + vec3(0, 1, 0)), catHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(catHash(i + vec3(0, 0, 1)), catHash(i + vec3(1, 0, 1)), f.x),
        mix(catHash(i + vec3(0, 1, 1)), catHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// 가장자리가 매끈한 도형 마스크 (d: 0보다 작으면 안쪽)
float catFill(float d) {
  float aa = max(fwidth(d), 1e-5);
  return 1.0 - smoothstep(-aa, aa, d);
}

vec3 catAlbedo() {
  vec3 p = vRest;
  float part = vInfo.x;
  float w = vInfo.y;
  float pat = vInfo.z;
  float seed = vInfo.w;
  vec3 fur = vFur;
  vec3 hp = p - CAT_HEAD;
  bool isBody = part < 0.5;
  bool isHead = part > 0.5 && part < 1.5;
  bool isEar = part > 1.5 && part < 2.5;
  bool isEarInner = part > 2.5 && part < 3.5;
  bool isTail = part > 3.5 && part < 4.5;
  bool isLeg = part > 4.5;
  float front = smoothstep(0.0, 0.07, hp.z);

  // ── 흰 부분(가슴, 배, 주둥이, 양말, 꼬리 끝) ──
  float white = 0.0;
  float muzzle = 0.0;
  if (isBody) {
    float chest = smoothstep(-0.03, 0.08, p.z) * (1.0 - smoothstep(0.36, 0.47, p.y + abs(p.x) * 0.35));
    float belly = 1.0 - smoothstep(0.13, 0.19, p.y);
    white = max(chest, belly);
  } else if (isHead) {
    vec2 m = vec2(hp.x / 0.165, (hp.y + 0.085) / 0.115);
    muzzle = (1.0 - smoothstep(0.82, 1.0, length(m))) * front;
    vec2 bl = vec2(hp.x / (0.035 + 0.05 * smoothstep(0.1, -0.1, hp.y)), (hp.y - 0.04) / 0.2);
    float blaze = (1.0 - smoothstep(0.75, 1.0, length(bl))) * front;
    white = max(muzzle, blaze);
  } else if (isLeg) {
    white = 1.0 - smoothstep(0.1, 0.118, p.y);
  } else if (isTail) {
    white = smoothstep(0.8, 0.86, w);
  }

  // ── 줄무늬 ──
  float stripe = 0.0;
  if (isBody) {
    float band = sin(p.z * 31.0 + seed * 6.283 + sin(p.x * 11.0) * 0.5);
    stripe = smoothstep(0.42, 0.62, band) * smoothstep(0.3, 0.4, p.y) * (1.0 - smoothstep(0.02, 0.12, p.z));
  } else if (isHead) {
    float ax = abs(hp.x);
    float line = min(ax, abs(ax - 0.082));
    float len = smoothstep(0.125, 0.165, hp.y) * smoothstep(-0.2, -0.05, hp.z);
    stripe = (1.0 - smoothstep(0.014, 0.024, line)) * len * (1.0 - smoothstep(0.1, 0.13, ax));
    // 볼 줄무늬
    float cheekLine = abs(hp.y + 0.015 + (ax - 0.25) * 0.5);
    stripe = max(stripe, (1.0 - smoothstep(0.008, 0.017, cheekLine)) * smoothstep(0.235, 0.27, ax) * front);
  } else if (isTail) {
    stripe = smoothstep(0.35, 0.6, sin(w * 24.0 + 1.0));
  } else if (isLeg) {
    stripe = smoothstep(0.4, 0.65, sin(p.y * 62.0 + 2.2)) * smoothstep(0.1, 0.13, p.y);
  }

  // ── 무늬별 색 ──
  vec3 col = fur;
  if (pat < 0.5) {
    // 치즈: 진한 줄무늬 + 크림색 가슴/주둥이/양말
    col = mix(fur, fur * vec3(0.78, 0.66, 0.6), stripe * 0.85);
    col = mix(col, uCream, white);
  } else if (pat < 1.5) {
    // 검정: 한 가지 색
    col = fur;
  } else if (pat < 2.5) {
    // 삼색: 흰 바탕에 털 색 얼룩 + 어두운 얼룩 (마리마다 얼룩 위치가 다름)
    vec3 q = p * 4.4;
    float n1 = catNoise(q + seed * 13.1);
    float n2 = catNoise(q + 40.0 + seed * 7.7);
    float o = smoothstep(0.5, 0.515, n1);
    float k = smoothstep(0.58, 0.595, n2);
    if (isHead || isEar || isEarInner) {
      // 머리는 한쪽 귀+눈은 털 색, 반대쪽은 어두운 색 (어느 쪽인지는 마리마다 다름)
      float flip = seed > 0.5 ? 1.0 : -1.0;
      vec2 a = vec2(hp.x * flip - 0.2, hp.y - 0.17);
      vec2 b2 = vec2(hp.x * flip + 0.2, hp.y - 0.19);
      float wob = (catNoise(p * 9.0 + seed * 5.0) - 0.5) * 0.05;
      o = 1.0 - smoothstep(0.0, 0.012, length(a * vec2(1.0, 0.8)) - 0.21 + wob);
      k = 1.0 - smoothstep(0.0, 0.012, length(b2 * vec2(1.0, 0.85)) - 0.2 - wob);
    }
    col = mix(uCream, fur, o);
    col = mix(col, uCalicoDark, k);
    col = mix(col, uCream, isHead ? muzzle : max(white, isLeg ? 1.0 : 0.0));
  } else if (pat < 3.5) {
    // 흰색
    col = fur;
  } else if (pat < 4.5) {
    // 회색: 은은한 줄무늬 + 밝은 주둥이
    col = mix(fur, fur * 0.7, stripe * 0.75);
    col = mix(col, mix(fur, uCream, 0.72), max(muzzle, isBody ? white * 0.8 : 0.0));
  } else {
    // 턱시도: 검정 바탕에 흰 가슴/주둥이/양말
    col = mix(fur, uCream, white);
  }
  float lum = dot(col, vec3(0.3, 0.59, 0.11));

  if (isEarInner) {
    col = mix(uPink, col, 0.18 + 0.3 * (1.0 - smoothstep(0.0, 0.1, lum)));
  }

  // ── 얼굴 ──
  const float EYE_SCALE = 1.32;
  if (isHead) {
    vec2 f = hp.xy;
    float closed = vFace.x;
    float happy = vFace.y;
    vec3 ink = mix(uInkLight, uInk, smoothstep(0.03, 0.12, lum));

    // 볼터치
    vec2 b = vec2(abs(f.x) - 0.213, f.y + 0.082) / vec2(0.06, 0.036);
    col = mix(col, uBlush, (1.0 - smoothstep(0.3, 1.0, length(b))) * 0.6 * front * smoothstep(0.02, 0.12, lum + 0.05));

    // 눈
    float sx = sign(f.x);
    // 눈은 크게 그린다 (카드처럼 작게 볼 때도 또렷하게). 아래 크기 값은 전부 1/EYE_SCALE 배로 줄인 좌표 기준이다
    vec2 e = vec2(f.x - sx * 0.146, f.y - 0.014) / EYE_SCALE;
    float shut = max(closed, happy);
    if (shut > 0.5) {
      // 감은 눈: 자거나 깜빡일 때는 ‿, 기분 좋을 때는 ︵
      float up = step(closed, 0.5) * step(0.5, happy);
      vec2 q = e - vec2(0.0, mix(0.03, -0.035, up));
      float arc = abs(length(q) - 0.046) - 0.0085;
      float cut = mix(q.y + 0.012, -q.y + 0.012, up);
      col = mix(col, ink, catFill(max(arc, cut)) * front);
    } else {
      float squash = 1.0 - shut * 1.6;
      vec2 es = vec2(e.x, e.y / max(squash, 0.2));
      float dEye = length(es / vec2(0.053, 0.066)) - 1.0;
      float dIris = length(es / vec2(0.044, 0.057)) - 1.0;
      float dPupil = length((es - vec2(0.0, -0.002)) / vec2(0.031, 0.045)) - 1.0;
      vec3 iris = mix(vEye * 0.55, vEye * 1.15, smoothstep(0.05, -0.05, es.y));
      vec3 eyeCol = ink;
      eyeCol = mix(eyeCol, iris, catFill(dIris));
      eyeCol = mix(eyeCol, uInk * 0.6, catFill(dPupil));
      // 눈 반짝임 두 개
      float h1 = length(es - vec2(-0.016, 0.024)) - 0.0165;
      float h2 = length(es - vec2(0.017, -0.022)) - 0.008;
      eyeCol = mix(eyeCol, vec3(1.0), max(catFill(h1), catFill(h2) * 0.85));
      col = mix(col, eyeCol, catFill(dEye * 0.05) * front);
    }

    // 코
    vec2 n = vec2(f.x, f.y + 0.07) / vec2(0.026, 0.017);
    float dNose = length(n) + n.y * 0.28 - 1.0;
    col = mix(col, uPink * 0.92, catFill(dNose * 0.02) * front);

    // 입 (ω)
    vec2 mq = vec2(abs(f.x) - 0.027, f.y + 0.09);
    float dMouth = max(abs(length(mq) - 0.027) - 0.0062, mq.y - 0.004);
    float dLine = max(abs(f.x) - 0.0055, abs(f.y + 0.089) - 0.008);
    col = mix(col, ink, catFill(min(dMouth, dLine)) * front * 0.9 * (1.0 - vFace.z));
    // 하품: 입을 크게 벌린다
    vec2 yq = vec2(f.x, f.y + 0.1 + 0.02 * vFace.z) / vec2(0.034, 0.008 + 0.04 * vFace.z);
    col = mix(col, uPink * 0.62, catFill((length(yq) - 1.0) * 0.02) * front * step(0.08, vFace.z));
  }
  return col;
}
`;

export function createCatMaterial(shared: CatShared): {
  material: THREE.MeshLambertMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
} {
  const uniforms = {
    uTime: shared.uTime,
    uCream: { value: linearColor('#fff6e6') },
    uPink: { value: linearColor('#f7a1ae') },
    uInk: { value: linearColor('#3a2a2c') },
    uInkLight: { value: linearColor('#b9a9a6') },
    uBlush: { value: linearColor('#ff9fa8') },
    uCalicoDark: { value: linearColor('#4a3a36') },
    uRimColor: { value: new THREE.Vector3(1, 0.96, 0.9) },
  };

  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = catAlbedo();`)
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        // 가장자리를 살짝 밝혀서 말랑한 젤리 느낌을 낸다
        float catRim = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.6);
        outgoingLight += (diffuseColor.rgb * 0.55 + 0.035) * uRimColor * catRim;
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'cat-lambert-v3';

  // 그림자에도 같은 움직임이 반영되도록 깊이 재질에도 같은 변형을 넣는다
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', VERT_MAIN_DEPTH);
  };
  depthMaterial.customProgramCacheKey = () => 'cat-depth-v2';

  return { material, depthMaterial };
}
