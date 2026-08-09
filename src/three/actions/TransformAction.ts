import * as THREE from 'three';
import type { HandResult } from '../../gesture/types';

/** Gesture-facing lifecycle shared by continuous scene transforms. */
export interface TransformAction {
  readonly object: THREE.Object3D | null;
  readonly isActive: boolean;
  start(object: THREE.Object3D, hand: HandResult, camera: THREE.Camera): void;
  update(hand: HandResult, camera: THREE.Camera): void;
  reset(): void;
}

/** Optional pointer-drag surface used by mouse parity for transform actions. */
export interface MouseTransformAction extends TransformAction {
  startFromDrag(object: THREE.Object3D): void;
  updateFromDrag(deltaX: number, deltaY: number): void;
}
