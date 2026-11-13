import * as THREE from 'three';

/**
 * 밤 효과. 진짜 조명을 늘리지 않고 "빛나 보이게" 만드는 가벼운 장치들.
 * - GlowPools : 창문/등불 앞 바닥에 번지는 따뜻한 빛 웅덩이
 * - Fireflies : 풀밭 위를 떠다니는 반딧불
 */
function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Pool {
  x: number;
  y: number;
  z: number;
  /** 가로, 세로 크기 */
  sx: number;
  sz: number;
}

export class GlowPools {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(capacity: number) {
    this.material = new THREE.MeshBasicMaterial({
      map: radialTexture(),
      color: '#ffb95e',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
  }

  set(pools: Pool[]) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    pools.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, 1, p.sz));
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.count = pools.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(night: number) {
    this.material.opacity = night * 0.42;
    this.mesh.visible = night > 0.01;
  }

  dispose() {
    this.material.map?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

export class Fireflies {
  readonly points: THREE.Points;
  private readonly uniforms: {
    uTime: { value: number };
    uNight: { value: number };
    uScale: { value: number };
  };

  constructor(spots: Array<[number, number, number]>, shared: { uTime: { value: number }; uNight: { value: number } }) {
    const pos = new Float32Array(spots.length * 3);
    const seed = new Float32Array(spots.length);
    spots.forEach((s, i) => {
      pos.set(s, i * 3);
      seed[i] = (i * 0.618034) % 1;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = { uTime: shared.uTime, uNight: shared.uNight, uScale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uScale;
        varying float vTwinkle;
        void main() {
          vec3 p = position;
          float s = aSeed * 40.0;
          p.x += sin(uTime * 0.45 + s) * 0.9 + sin(uTime * 0.2 + s * 2.0) * 0.5;
          p.y += sin(uTime * 0.8 + s * 1.7) * 0.35;
          p.z += cos(uTime * 0.38 + s * 1.3) * 0.9;
          vTwinkle = 0.45 + 0.55 * sin(uTime * (1.6 + aSeed * 2.0) + s);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(2.0, 0.34 * uScale / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vTwinkle;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a = a * a * vTwinkle * uNight;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.55) * a * 1.6, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** 화면 높이(px)와 시야각에 맞춰 점 크기를 맞춘다 */
  resize(viewportH: number, fovDeg: number) {
    this.uniforms.uScale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
