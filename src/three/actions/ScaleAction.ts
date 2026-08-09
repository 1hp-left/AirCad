import * as THREE from 'three';
import { normalizedHandSize, pinchDistance } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import type { MouseTransformAction } from './TransformAction';

const MIN_SIGNAL = 1e-4;
const MIN_SCALE_FACTOR = 0.1;
const MAX_SCALE_FACTOR = 10;
const SCALE_PER_PIXEL = 0.01;

type SignalKind = 'pinch' | 'hand-size';

/** Uniformly scales the selected object from a captured hand baseline. */
export class ScaleAction implements MouseTransformAction {
  private target: THREE.Object3D | null = null;
  private readonly startScale = new THREE.Vector3();
  private baselineSignal = 0;
  private signalKind: SignalKind = 'pinch';

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
  }

  update(hand: HandResult, _camera: THREE.Camera): void {
    if (!this.target) return;
    this.applyFactor(signalFor(hand, this.signalKind) / this.baselineSignal);
  }

  startFromDrag(object: THREE.Object3D): void {
    this.reset();
    this.target = object;
    this.startScale.copy(object.scale);
  }

  updateFromDrag(_deltaX: number, deltaY: number): void {
    if (!this.target) return;
    this.applyFactor(Math.exp(-deltaY * SCALE_PER_PIXEL));
  }

  reset(): void {
    this.target = null;
    this.startScale.set(1, 1, 1);
    this.baselineSignal = 0;
    this.signalKind = 'pinch';
  }

  private applyFactor(rawFactor: number): void {
    if (!this.target || !Number.isFinite(rawFactor)) return;
    const factor = THREE.MathUtils.clamp(rawFactor, MIN_SCALE_FACTOR, MAX_SCALE_FACTOR);
    this.target.scale.copy(this.startScale).multiplyScalar(factor);
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
