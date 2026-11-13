import * as THREE from 'three';
import { GROUND_Y, HOUSE_OFFSET_Z, YARD_WORLD } from '../world/constants';
import { HOUSE_DIM } from './houseGeometry';

/**
 * "오늘의 특이한 집" 표시: 마당을 두르는 금색 테두리 + 지붕 위에서 도는 금색 별.
 * 집 한 채에만 쓰는 장식이라 그리기 2번.
 */
export class HighlightMark {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly star: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;

  constructor() {
    const half = YARD_WORLD / 2 + 0.28;
    const rounded = (h: number, r: number, path: THREE.Path | THREE.Shape) => {
      path.moveTo(-h + r, -h);
      path.lineTo(h - r, -h);
      path.quadraticCurveTo(h, -h, h, -h + r);
      path.lineTo(h, h - r);
      path.quadraticCurveTo(h, h, h - r, h);
      path.lineTo(-h + r, h);
      path.quadraticCurveTo(-h, h, -h, h - r);
      path.lineTo(-h, -h + r);
      path.quadraticCurveTo(-h, -h, -h + r, -h);
      return path;
    };
    const shape = rounded(half, 1.0, new THREE.Shape()) as THREE.Shape;
    shape.holes.push(rounded(half - 0.3, 0.8, new THREE.Path()) as THREE.Path);
    const ringGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 8 });
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffcb47', transparent: true, opacity: 0.95 });
    this.ring = new THREE.Mesh(ringGeo, this.ringMaterial);
    this.ring.position.y = GROUND_Y + 0.05;

    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 0.62 : 0.3;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    const starGeo = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    starGeo.translate(0, 0, -0.08);
    this.star = new THREE.Mesh(starGeo, new THREE.MeshLambertMaterial({ color: '#ffd24a', emissive: '#f0a020', emissiveIntensity: 0.55 }));
    this.group.add(this.ring, this.star);
    this.group.visible = false;
  }

  /** 마당 가운데 좌표. null 이면 숨긴다 */
  set(pos: { x: number; z: number } | null) {
    this.group.visible = !!pos;
    if (pos) this.group.position.set(pos.x, 0, pos.z);
  }

  update(t: number, dist: number) {
    if (!this.group.visible) return;
    // 멀리서도 보이게 카메라가 멀어지면 키운다
    const far = THREE.MathUtils.smoothstep(dist, 70, 300);
    const pulse = 1 + Math.sin(t * 3.2) * 0.025;
    this.ring.scale.setScalar((1 + far * 0.7) * pulse);
    this.ringMaterial.opacity = 0.8 + Math.sin(t * 3.2) * 0.18;
    this.star.position.set(0, GROUND_Y + HOUSE_DIM.labelY + 1.5 + Math.sin(t * 2) * 0.15 + far * 3, HOUSE_OFFSET_Z);
    this.star.rotation.y = t * 1.6;
    this.star.scale.setScalar(1 + far * 4);
  }

  dispose() {
    this.ring.geometry.dispose();
    this.ringMaterial.dispose();
    this.star.geometry.dispose();
    (this.star.material as THREE.Material).dispose();
  }
}
