import * as THREE from 'three';
import { palmCenter } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import type { MouseTransformAction } from './TransformAction';

const ROTATION_PER_PIXEL = 0.01;
const ROTATION_PER_SCREEN = Math.PI * 2;
const MOTION_DEAD_ZONE = 0.012;

/** Rotates an object by using palm movement like a virtual trackball. */
export class RotateAction implements MouseTransformAction {
  private target: THREE.Object3D | null = null;
  private readonly startQuaternion = new THREE.Quaternion();
  private readonly startPalm = new THREE.Vector2();
  private readonly dragDelta = new THREE.Quaternion();
  private readonly yaw = new THREE.Quaternion();
  private readonly pitch = new THREE.Quaternion();
  private readonly cameraUp = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly dragEuler = new THREE.Euler(0, 0, 0, 'XYZ');

  get object(): THREE.Object3D | null {
    return this.target;
  }

  get isActive(): boolean {
    return this.target !== null;
  }

  start(object: THREE.Object3D, hand: HandResult, camera: THREE.Camera): void {
    this.reset();
    this.target = object;
    this.startQuaternion.copy(object.quaternion);
    const palm = palmCenter(hand);
    // MediaPipe is unmirrored while the preview is mirrored. Store screen-space
    // coordinates so moving right in the preview rotates right in the scene.
    this.startPalm.set(1 - palm.x, palm.y);
    this.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    this.cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  }

  update(hand: HandResult, _camera: THREE.Camera): void {
    if (!this.target) return;

    const palm = palmCenter(hand);
    const horizontal = removeDeadZone(1 - palm.x - this.startPalm.x);
    const vertical = removeDeadZone(this.startPalm.y - palm.y);

    this.yaw.setFromAxisAngle(this.cameraUp, horizontal * ROTATION_PER_SCREEN);
    this.pitch.setFromAxisAngle(this.cameraRight, -vertical * ROTATION_PER_SCREEN);
    this.dragDelta.copy(this.yaw).multiply(this.pitch);
    this.target.quaternion.copy(this.dragDelta).multiply(this.startQuaternion).normalize();
  }

  startFromDrag(object: THREE.Object3D): void {
    this.reset();
    this.target = object;
    this.startQuaternion.copy(object.quaternion);
  }

  updateFromDrag(deltaX: number, deltaY: number): void {
    if (!this.target) return;

    this.dragEuler.set(deltaY * ROTATION_PER_PIXEL, deltaX * ROTATION_PER_PIXEL, 0);
    this.dragDelta.setFromEuler(this.dragEuler);
    this.target.quaternion.copy(this.startQuaternion).multiply(this.dragDelta).normalize();
  }

  reset(): void {
    this.target = null;
    this.startQuaternion.identity();
    this.startPalm.set(0, 0);
    this.dragDelta.identity();
    this.yaw.identity();
    this.pitch.identity();
  }
}

function removeDeadZone(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= MOTION_DEAD_ZONE) return 0;
  return Math.sign(value) * (magnitude - MOTION_DEAD_ZONE);
}
