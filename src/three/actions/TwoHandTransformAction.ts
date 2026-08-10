import * as THREE from 'three';
import {
  normalizedHandSize,
  pinchPoint,
  type Vec3,
} from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import { normalizedToNdc, rayFromNormalizedPoint } from '../selection';

const MIN_DEPTH = 2.5;
const MAX_DEPTH = 24;
const MIN_HAND_SIZE = 0.015;
const MIN_HAND_SEPARATION = 0.06;
const MIN_SCALE_FACTOR = 0.15;
const MAX_SCALE_FACTOR = 6;
const ROTATION_DEAD_ZONE = 0.0025;

/**
 * Direct two-hand manipulation: the midpoint moves the object, the distance
 * between pinches resizes it, and turning the hand-to-hand line rotates it.
 */
export class TwoHandTransformAction {
  private target: THREE.Object3D | null = null;
  private readonly startScale = new THREE.Vector3();
  private readonly startQuaternion = new THREE.Quaternion();
  private readonly worldOffset = new THREE.Vector3();
  private readonly cameraFacingAxis = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly previousLine = new THREE.Vector2(1, 0);
  private readonly currentLine = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private grabDistance = 0;
  private baselineHandSize = 0;
  private baselineSeparation = 0;
  private accumulatedRotation = 0;

  get object(): THREE.Object3D | null {
    return this.target;
  }

  get isActive(): boolean {
    return this.target !== null;
  }

  start(
    object: THREE.Object3D,
    firstHand: HandResult,
    secondHand: HandResult,
    camera: THREE.Camera,
  ): void {
    this.reset();
    this.target = object;
    this.startScale.copy(object.scale);
    this.startQuaternion.copy(object.quaternion);

    const first = pinchPoint(firstHand);
    const second = pinchPoint(secondHand);
    const firstNdc = normalizedToNdc(first);
    const secondNdc = normalizedToNdc(second);
    this.previousLine.copy(secondNdc).sub(firstNdc);
    this.baselineSeparation = Math.max(this.previousLine.length(), MIN_HAND_SEPARATION);
    if (this.previousLine.lengthSq() > 0) this.previousLine.normalize();
    else this.previousLine.set(1, 0);

    const ray = rayFromNormalizedPoint(midpoint(first, second), camera, this.raycaster);
    const objectPosition = new THREE.Vector3();
    object.getWorldPosition(objectPosition);
    this.grabDistance = THREE.MathUtils.clamp(
      objectPosition.distanceTo(ray.origin),
      MIN_DEPTH,
      MAX_DEPTH,
    );
    this.worldOffset
      .copy(objectPosition)
      .sub(ray.origin.clone().addScaledVector(ray.direction, this.grabDistance));
    this.baselineHandSize = Math.max(
      averageHandSize(firstHand, secondHand),
      MIN_HAND_SIZE,
    );

    // Point toward the viewer so positive screen-space angles feel positive
    // from the user's view of the object.
    camera.getWorldDirection(this.cameraFacingAxis).negate().normalize();
  }

  update(firstHand: HandResult, secondHand: HandResult, camera: THREE.Camera): void {
    const object = this.target;
    if (!object) return;

    const first = pinchPoint(firstHand);
    const second = pinchPoint(secondHand);
    const ray = rayFromNormalizedPoint(midpoint(first, second), camera, this.raycaster);
    const currentHandSize = Math.max(
      averageHandSize(firstHand, secondHand),
      MIN_HAND_SIZE,
    );
    const depth = THREE.MathUtils.clamp(
      this.grabDistance * (this.baselineHandSize / currentHandSize),
      MIN_DEPTH,
      MAX_DEPTH,
    );
    const targetWorld = ray.origin
      .clone()
      .addScaledVector(ray.direction, depth)
      .add(this.worldOffset);
    if (object.parent) object.parent.worldToLocal(targetWorld);
    object.position.copy(targetWorld);

    const firstNdc = normalizedToNdc(first);
    const secondNdc = normalizedToNdc(second);
    this.currentLine.copy(secondNdc).sub(firstNdc);
    const separation = this.currentLine.length();
    const factor = THREE.MathUtils.clamp(
      separation / this.baselineSeparation,
      MIN_SCALE_FACTOR,
      MAX_SCALE_FACTOR,
    );
    object.scale.copy(this.startScale).multiplyScalar(factor);

    if (separation > MIN_HAND_SEPARATION / 2) {
      this.currentLine.multiplyScalar(1 / separation);
      // A detector-order swap reverses the line. Flipping it back keeps the
      // incremental angle continuous without relying on array order.
      if (this.currentLine.dot(this.previousLine) < 0) this.currentLine.negate();
      const delta = Math.atan2(
        this.previousLine.x * this.currentLine.y -
          this.previousLine.y * this.currentLine.x,
        this.previousLine.dot(this.currentLine),
      );
      if (Math.abs(delta) >= ROTATION_DEAD_ZONE) this.accumulatedRotation += delta;
      this.previousLine.copy(this.currentLine);
    }

    this.rotation.setFromAxisAngle(this.cameraFacingAxis, this.accumulatedRotation);
    object.quaternion.copy(this.rotation).multiply(this.startQuaternion).normalize();
  }

  reset(): void {
    this.target = null;
    this.startScale.set(1, 1, 1);
    this.startQuaternion.identity();
    this.worldOffset.set(0, 0, 0);
    this.cameraFacingAxis.set(0, 0, 1);
    this.rotation.identity();
    this.previousLine.set(1, 0);
    this.currentLine.set(0, 0);
    this.grabDistance = 0;
    this.baselineHandSize = 0;
    this.baselineSeparation = 0;
    this.accumulatedRotation = 0;
  }
}

function midpoint(first: Vec3, second: Vec3): Vec3 {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    z: (first.z + second.z) / 2,
  };
}

function averageHandSize(firstHand: HandResult, secondHand: HandResult): number {
  return (normalizedHandSize(firstHand) + normalizedHandSize(secondHand)) / 2;
}
