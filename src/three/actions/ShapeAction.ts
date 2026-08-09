import * as THREE from 'three';
import { palmCenter } from '../../gesture/landmarkUtils';
import { LANDMARK } from '../../gesture/types';
import type { HandResult } from '../../gesture/types';
import type { MouseTransformAction } from './TransformAction';

const MIN_STRETCH = 0.2;
const MAX_STRETCH = 5;
const STRETCH_PER_PIXEL = 0.01;
const STRETCH_PER_SCREEN = 4;

export type ShapeAxis = 'X' | 'Y';

/** Stretches one local object axis while compensating the other two axes. */
export class ShapeAction implements MouseTransformAction {
  private target: THREE.Object3D | null = null;
  private readonly startScale = new THREE.Vector3();
  private readonly nextScale = new THREE.Vector3();
  private startPalmY = 0;
  private axisIndex: 0 | 1 = 1;

  get object(): THREE.Object3D | null {
    return this.target;
  }

  get isActive(): boolean {
    return this.target !== null;
  }

  get axisLabel(): ShapeAxis {
    return this.axisIndex === 0 ? 'X' : 'Y';
  }

  start(object: THREE.Object3D, hand: HandResult, _camera: THREE.Camera): void {
    this.reset();
    this.target = object;
    this.startScale.copy(object.scale);
    this.startPalmY = palmCenter(hand).y;
    this.axisIndex = axisForHand(hand);
  }

  update(hand: HandResult, _camera: THREE.Camera): void {
    if (!this.target) return;
    const upwardMotion = this.startPalmY - palmCenter(hand).y;
    this.applyStretch(Math.exp(upwardMotion * STRETCH_PER_SCREEN));
  }

  startFromDrag(object: THREE.Object3D): void {
    this.reset();
    this.target = object;
    this.startScale.copy(object.scale);
    this.axisIndex = 1;
  }

  updateFromDrag(_deltaX: number, deltaY: number): void {
    if (!this.target) return;
    this.applyStretch(Math.exp(-deltaY * STRETCH_PER_PIXEL));
  }

  reset(): void {
    this.target = null;
    this.startScale.set(1, 1, 1);
    this.startPalmY = 0;
    this.axisIndex = 1;
  }

  private applyStretch(rawStretch: number): void {
    if (!this.target || !Number.isFinite(rawStretch)) return;
    const stretch = THREE.MathUtils.clamp(rawStretch, MIN_STRETCH, MAX_STRETCH);
    const perpendicular = 1 / Math.sqrt(stretch);
    const nextScale = this.nextScale.copy(this.startScale);

    nextScale.setComponent(this.axisIndex, this.startScale.getComponent(this.axisIndex) * stretch);
    for (let axis = 0; axis < 3; axis += 1) {
      if (axis !== this.axisIndex) {
        nextScale.setComponent(axis, this.startScale.getComponent(axis) * perpendicular);
      }
    }
    this.target.scale.copy(nextScale);
  }
}

function axisForHand(hand: HandResult): 0 | 1 {
  const wrist = hand.landmarks[LANDMARK.WRIST];
  const middle = hand.landmarks[LANDMARK.MIDDLE_MCP];
  return Math.abs(middle.x - wrist.x) > Math.abs(middle.y - wrist.y) ? 0 : 1;
}
