import * as THREE from 'three';
import { normalizedHandSize, palmNormalVector3, pinchDistance } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import type { MouseTransformAction } from './TransformAction';

const MIN_SIGNAL = 1e-4;
const MIN_STRETCH = 0.2;
const MAX_STRETCH = 5;
const STRETCH_PER_PIXEL = 0.01;

type SignalKind = 'pinch' | 'hand-size';

/** Stretches one local object axis while compensating the other two axes. */
export class ShapeAction implements MouseTransformAction {
  private target: THREE.Object3D | null = null;
  private readonly startScale = new THREE.Vector3();
  private baselineSignal = 0;
  private signalKind: SignalKind = 'pinch';
  private axisIndex = 1;

  get object(): THREE.Object3D | null {
    return this.target;
  }

  get isActive(): boolean {
    return this.target !== null;
  }

  start(object: THREE.Object3D, hand: HandResult, _camera: THREE.Camera): void {
    this.reset();
    this.target = object;
    this.startScale.copy(object.scale);
    this.signalKind = signalKindFor(hand);
    this.baselineSignal = Math.max(signalFor(hand, this.signalKind), MIN_SIGNAL);
    this.axisIndex = dominantLocalAxis(object, palmNormalVector3(hand));
  }

  update(hand: HandResult, _camera: THREE.Camera): void {
    if (!this.target) return;
    this.applyStretch(signalFor(hand, this.signalKind) / this.baselineSignal);
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
    this.baselineSignal = 0;
    this.signalKind = 'pinch';
    this.axisIndex = 1;
  }

  private applyStretch(rawStretch: number): void {
    if (!this.target || !Number.isFinite(rawStretch)) return;
    const stretch = THREE.MathUtils.clamp(rawStretch, MIN_STRETCH, MAX_STRETCH);
    const perpendicular = 1 / Math.sqrt(stretch);
    const nextScale = this.startScale.clone();

    nextScale.setComponent(this.axisIndex, this.startScale.getComponent(this.axisIndex) * stretch);
    for (let axis = 0; axis < 3; axis += 1) {
      if (axis !== this.axisIndex) {
        nextScale.setComponent(axis, this.startScale.getComponent(axis) * perpendicular);
      }
    }
    this.target.scale.copy(nextScale);
  }
}

function signalKindFor(hand: HandResult): SignalKind {
  const pinch = pinchDistance(hand);
  return Number.isFinite(pinch) && pinch > MIN_SIGNAL ? 'pinch' : 'hand-size';
}

function signalFor(hand: HandResult, kind?: SignalKind): number {
  const pinch = pinchDistance(hand);
  if ((kind ?? 'pinch') === 'pinch' && Number.isFinite(pinch) && pinch > MIN_SIGNAL) {
    return pinch;
  }
  return Math.max(normalizedHandSize(hand), MIN_SIGNAL);
}

function dominantLocalAxis(object: THREE.Object3D, worldAxis: THREE.Vector3): number {
  object.updateMatrixWorld(true);
  const localAxis = worldAxis
    .clone()
    .transformDirection(object.matrixWorld.clone().invert())
    .normalize();
  const values = [Math.abs(localAxis.x), Math.abs(localAxis.y), Math.abs(localAxis.z)];
  return values[0] >= values[1] && values[0] >= values[2]
    ? 0
    : values[1] >= values[2]
      ? 1
      : 2;
}

