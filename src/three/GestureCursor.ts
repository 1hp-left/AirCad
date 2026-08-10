import * as THREE from 'three';

const BEAM_RADIUS = 0.012;
const RING_INNER_RADIUS = 0.1;
const RING_OUTER_RADIUS = 0.14;

export interface GestureCursorOptions {
  name?: string;
  hitColor?: number;
  missColor?: number;
  showBeam?: boolean;
  markerScale?: number;
}

/**
 * Visualizes the current pointing ray in the Three.js scene.
 *
 * The ray is deliberately rendered as a depth-independent beam so it remains
 * visible while it passes through the scene. The endpoint ring changes color
 * depending on whether the ray currently hits a selectable object.
 */
export class GestureCursor {
  readonly group: THREE.Group;

  private readonly beam: THREE.Mesh;
  private readonly beamMaterial: THREE.MeshBasicMaterial;
  private readonly reticle: THREE.Mesh;
  private readonly reticleMaterial: THREE.MeshBasicMaterial;
  private readonly center: THREE.Mesh;
  private readonly centerMaterial: THREE.MeshBasicMaterial;
  private readonly direction = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly midpoint = new THREE.Vector3();
  private readonly backward = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly hitColor: number;
  private readonly missColor: number;
  private readonly markerScale: number;

  constructor(scene: THREE.Scene, options: GestureCursorOptions = {}) {
    this.hitColor = options.hitColor ?? 0xa8bd68;
    this.missColor = options.missColor ?? 0x9aa6b5;
    this.markerScale = options.markerScale ?? 1;
    this.group = new THREE.Group();
    this.group.name = options.name ?? '__aircad-gesture-cursor';
    this.group.visible = false;
    this.group.renderOrder = 1000;

    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xa8bd68,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false,
    });
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, 1, 8, 1, true),
      this.beamMaterial,
    );
    this.beam.visible = options.showBeam ?? true;
    this.beam.renderOrder = 1000;

    this.reticleMaterial = new THREE.MeshBasicMaterial({
      color: 0xa8bd68,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(RING_INNER_RADIUS, RING_OUTER_RADIUS, 32),
      this.reticleMaterial,
    );
    this.reticle.renderOrder = 1001;

    this.centerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    this.center = new THREE.Mesh(new THREE.CircleGeometry(0.025, 20), this.centerMaterial);
    this.center.renderOrder = 1002;
    this.reticle.scale.setScalar(this.markerScale);
    this.center.scale.setScalar(this.markerScale);

    this.group.add(this.beam, this.reticle, this.center);
    scene.add(this.group);
  }

  /** Show the ray and place its reticle at the current hit or fallback point. */
  show(ray: THREE.Ray, endpoint: THREE.Vector3, hit: boolean): void {
    const direction = this.direction.copy(ray.direction).normalize();
    const start = this.start.copy(ray.origin).addScaledVector(direction, 0.35);
    const length = Math.max(start.distanceTo(endpoint), 0.01);

    this.beam.position.copy(this.midpoint.copy(start).lerp(endpoint, 0.5));
    this.beam.scale.set(1, length, 1);
    this.beam.quaternion.setFromUnitVectors(this.yAxis, direction);

    const color = hit ? this.hitColor : this.missColor;
    this.beamMaterial.color.setHex(color);
    this.reticleMaterial.color.setHex(color);

    this.reticle.position.copy(endpoint);
    this.center.position.copy(endpoint);
    // RingGeometry lies in the XY plane; face it back toward the camera ray.
    this.reticle.quaternion.setFromUnitVectors(
      this.zAxis,
      this.backward.copy(direction).negate(),
    );
    this.center.quaternion.copy(this.reticle.quaternion);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.group.remove(this.beam, this.reticle, this.center);
    this.beam.geometry.dispose();
    this.beamMaterial.dispose();
    this.reticle.geometry.dispose();
    this.reticleMaterial.dispose();
    this.center.geometry.dispose();
    this.centerMaterial.dispose();
    this.group.parent?.remove(this.group);
  }
}
