import * as THREE from 'three';
import { LANDMARK } from '../../gesture/types';
import { palmNormalVector3 } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import type { MouseTransformAction } from './TransformAction';

const ROTATION_PER_PIXEL = 0.01;

/** Rotates an object from the change in the hand's palm frame. */
export class RotateAction implements MouseTransformAction {
  private target: THREE.Object3D | null = null;
  private readonly startQuaternion = new THREE.Quaternion();
  private readonly baselineFrame = new THREE.Matrix4();
  private readonly dragDelta = new THREE.Quaternion();

  get object(): THREE.Object3D | null {
    return this.target;
  }

  get isActive(): boolean {
    return this.target !== null;
  }

  start(object: THREE.Object3D, hand: HandResult, _camera: THREE.Camera): void {
    this.reset();
    this.target = object;
    this.startQuaternion.copy(object.quaternion);
    this.baselineFrame.copy(frameForHand(hand));
  }

  update(hand: HandResult, _camera: THREE.Camera): void {
    if (!this.target) return;

    const currentFrame = frameForHand(hand);
    const delta = currentFrame.multiply(this.baselineFrame.clone().invert());
    this.dragDelta.setFromRotationMatrix(delta).normalize();
    this.target.quaternion.copy(this.startQuaternion).multiply(this.dragDelta).normalize();
  }

  startFromDrag(object: THREE.Object3D): void {
    this.reset();
    this.target = object;
    this.startQuaternion.copy(object.quaternion);
  }

  updateFromDrag(deltaX: number, deltaY: number): void {
    if (!this.target) return;

    this.dragDelta.setFromEuler(
      new THREE.Euler(deltaY * ROTATION_PER_PIXEL, deltaX * ROTATION_PER_PIXEL, 0, 'XYZ'),
    );
    this.target.quaternion.copy(this.startQuaternion).multiply(this.dragDelta).normalize();
  }

  reset(): void {
    this.target = null;
    this.startQuaternion.identity();
    this.baselineFrame.identity();
    this.dragDelta.identity();
  }
}

function frameForHand(hand: HandResult): THREE.Matrix4 {
  const normal = palmNormalVector3(hand).normalize();
  const wrist = hand.landmarks[LANDMARK.WRIST];
  const middle = hand.landmarks[LANDMARK.MIDDLE_MCP];
  const up = new THREE.Vector3(middle.x - wrist.x, middle.y - wrist.y, middle.z - wrist.z);

  // Remove the normal component so the frame remains orthonormal even when the
  // landmark hand is viewed at an oblique angle.
  up.addScaledVector(normal, -up.dot(normal));
  if (up.lengthSq() < 1e-8) up.set(0, 1, 0);
  up.normalize();

  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(normal, right).normalize();
  return new THREE.Matrix4().makeBasis(right, correctedUp, normal);
}
