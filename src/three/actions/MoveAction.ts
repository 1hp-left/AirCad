import * as THREE from 'three';
import { normalizedHandSize, palmCenter } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import { rayFromNormalizedPoint } from '../selection';
import type { TransformAction } from './TransformAction';

const MIN_DEPTH = 2.5;
const MAX_DEPTH = 24;
const MIN_HAND_SIZE = 0.015;

/** Stateful closed-fist grab that moves one selected object at a time. */
export class MoveAction implements TransformAction {
  private grabbedObject: THREE.Object3D | null = null;
  private readonly worldOffset = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private grabDistance = 0;
  private baselineHandSize = 0;

  get object(): THREE.Object3D | null {
    return this.grabbedObject;
  }

  get isActive(): boolean {
    return this.grabbedObject !== null;
  }

  /** Capture the object/ray relationship at the instant the fist closes. */
  start(object: THREE.Object3D, hand: HandResult, camera: THREE.Camera): void {
    this.reset();
    const ray = rayFromNormalizedPoint(palmCenter(hand), camera, this.raycaster);
    this.capture(object, ray);
    this.baselineHandSize = Math.max(normalizedHandSize(hand), MIN_HAND_SIZE);
  }

  /** Move the grabbed object while preserving the gesture's hand-size depth behavior. */
  update(hand: HandResult, camera: THREE.Camera): void {
    const currentHandSize = Math.max(normalizedHandSize(hand), MIN_HAND_SIZE);
    const depth = THREE.MathUtils.clamp(
      this.grabDistance * (this.baselineHandSize / currentHandSize),
      MIN_DEPTH,
      MAX_DEPTH,
    );
    this.updateAtDepth(
      rayFromNormalizedPoint(palmCenter(hand), camera, this.raycaster),
      depth,
    );
  }

  /** Capture a fixed-depth grab for mouse/pointer movement. */
  startFromRay(object: THREE.Object3D, ray: THREE.Ray): void {
    this.reset();
    this.capture(object, ray);
  }

  /** Update a pointer grab at its original camera-ray depth. */
  updateFromRay(ray: THREE.Ray): void {
    this.updateAtDepth(ray, this.grabDistance);
  }

  /** Move the grabbed object along a ray at an explicit depth. */
  updateAtDepth(ray: THREE.Ray, depth: number): void {
    const object = this.grabbedObject;
    if (!object) return;

    const targetWorld = ray.origin
      .clone()
      .addScaledVector(ray.direction, THREE.MathUtils.clamp(depth, MIN_DEPTH, MAX_DEPTH))
      .add(this.worldOffset);

    if (object.parent) object.parent.worldToLocal(targetWorld);
    object.position.copy(targetWorld);
  }

  reset(): void {
    this.grabbedObject = null;
    this.worldOffset.set(0, 0, 0);
    this.grabDistance = 0;
    this.baselineHandSize = 0;
  }

  private capture(object: THREE.Object3D, ray: THREE.Ray): void {
    const objectPosition = new THREE.Vector3();
    object.getWorldPosition(objectPosition);
    this.grabDistance = THREE.MathUtils.clamp(
      objectPosition.distanceTo(ray.origin),
      MIN_DEPTH,
      MAX_DEPTH,
    );
    const rayPoint = ray.origin.clone().addScaledVector(ray.direction, this.grabDistance);
    this.worldOffset.copy(objectPosition).sub(rayPoint);
    this.grabbedObject = object;
  }
}
