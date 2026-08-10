import * as THREE from 'three';
import { pinchPoint } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import type { GestureCursor } from '../GestureCursor';
import type { ObjectStore } from '../ObjectStore';
import { raycastSelectableAtNormalizedPoint } from '../selection';
import { CombineAction, type CombineFailureReason } from './CombineAction';

const HOLD_MS = 420;
const RELEASE_MS = 180;
const CANDIDATE_GRACE_MS = 180;
const CURSOR_DEPTH = 12;
const TARGET_COLORS = [0x7c9fe8, 0xa8bd68] as const;

type CombineCursor = Pick<GestureCursor, 'show' | 'hide'>;

export interface CombineGestureUpdate {
  consumed: boolean;
  released: boolean;
  notice: string | null;
}

/** Owns two-pinch targeting, intent timing, visual feedback, and union latching. */
export class CombineGesture {
  private readonly action = new CombineAction();
  private readonly raycasters = [new THREE.Raycaster(), new THREE.Raycaster()] as const;
  private readonly missEndpoints = [new THREE.Vector3(), new THREE.Vector3()] as const;
  private readonly outlines: THREE.BoxHelper[] = [];
  private candidateKey = '';
  private candidateSinceMs = 0;
  private candidateLastSeenMs = 0;
  private resultLatched = false;
  private releaseSinceMs = 0;
  private engaged = false;
  private currentNotice: string | null = null;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly store: ObjectStore,
    private readonly cursors: readonly [CombineCursor, CombineCursor],
  ) {}

  get active(): boolean {
    return this.engaged || this.resultLatched || Boolean(this.candidateKey);
  }

  update(pinchHands: HandResult[], timestampMs: number): CombineGestureUpdate {
    const hasTwoPinches = pinchHands.length >= 2;

    if (this.resultLatched) {
      this.resetCandidate();
      if (hasTwoPinches) {
        this.releaseSinceMs = 0;
        return this.state(true);
      }

      if (!this.releaseSinceMs) this.releaseSinceMs = timestampMs;
      if (timestampMs - this.releaseSinceMs < RELEASE_MS) return this.state(true);

      this.resultLatched = false;
      this.releaseSinceMs = 0;
      this.engaged = false;
      this.currentNotice = null;
      return this.state(false, true);
    }

    if (!hasTwoPinches) {
      if (this.candidateKey && timestampMs - this.candidateLastSeenMs < CANDIDATE_GRACE_MS) {
        return this.state(true);
      }

      const released = this.active;
      this.resetCandidate();
      this.hideCursors();
      this.engaged = false;
      this.currentNotice = null;
      return this.state(false, released);
    }

    const [firstTarget, secondTarget] = this.findTargets(pinchHands[0], pinchHands[1]);

    // Two pinches on one object belong to direct two-hand transform, not union.
    if (firstTarget && firstTarget === secondTarget) {
      this.resetCandidate();
      this.hideCursors();
      this.engaged = false;
      this.currentNotice = null;
      return this.state(false);
    }

    this.engaged = true;
    if (!firstTarget || !secondTarget) {
      if (this.candidateKey && timestampMs - this.candidateLastSeenMs < CANDIDATE_GRACE_MS) {
        this.currentNotice = 'Keep each pinch on its object';
        return this.state(true);
      }
      this.resetCandidate();
      this.currentNotice = 'Pinch a different object with each hand';
      return this.state(true);
    }
    const targets: [THREE.Object3D, THREE.Object3D] = [firstTarget, secondTarget];

    this.action.prepare();
    const key = `${targets[0].uuid}:${targets[1].uuid}`;
    if (key !== this.candidateKey) {
      this.candidateKey = key;
      this.candidateSinceMs = timestampMs;
      this.candidateLastSeenMs = timestampMs;
      this.showTargets(targets);
      this.currentNotice = `Hold steady to combine ${targets[0].name} and ${targets[1].name}`;
      return this.state(true);
    }

    this.candidateLastSeenMs = timestampMs;
    this.outlines.forEach((outline) => outline.update());
    if (timestampMs - this.candidateSinceMs < HOLD_MS) return this.state(true);

    if (this.action.status === 'error') {
      return this.latchResult('Could not load the combine tool');
    }
    if (this.action.status !== 'ready') {
      this.currentNotice = 'Preparing combine';
      return this.state(true);
    }

    const result = this.action.execute(targets[0], targets[1], this.store);
    return this.latchResult(
      result.ok
        ? `${result.sourceNames[0]} and ${result.sourceNames[1]} combined`
        : failureMessage(result.reason),
    );
  }

  reset(): void {
    this.resetCandidate();
    this.hideCursors();
    this.resultLatched = false;
    this.releaseSinceMs = 0;
    this.engaged = false;
    this.currentNotice = null;
  }

  private findTargets(
    firstHand: HandResult,
    secondHand: HandResult,
  ): [THREE.Object3D | null, THREE.Object3D | null] {
    const firstTarget = this.targetFor(firstHand, 0);
    const secondTarget = this.targetFor(secondHand, 1);
    return [firstTarget, secondTarget];
  }

  private targetFor(hand: HandResult, index: 0 | 1): THREE.Object3D | null {
    const raycaster = this.raycasters[index];
    const hit = raycastSelectableAtNormalizedPoint(
      pinchPoint(hand),
      this.camera,
      this.store.group,
      raycaster,
    );
    const ray = raycaster.ray;
    const endpoint =
      hit?.point ??
      this.missEndpoints[index].copy(ray.origin).addScaledVector(ray.direction, CURSOR_DEPTH);
    this.cursors[index].show(ray, endpoint, hit !== null);
    return hit?.object ?? null;
  }

  private latchResult(notice: string): CombineGestureUpdate {
    this.resetCandidate();
    this.hideCursors();
    this.resultLatched = true;
    this.releaseSinceMs = 0;
    this.currentNotice = notice;
    return this.state(true);
  }

  private state(consumed: boolean, released = false): CombineGestureUpdate {
    return { consumed, released, notice: this.currentNotice };
  }

  private resetCandidate(): void {
    this.candidateKey = '';
    this.candidateSinceMs = 0;
    this.candidateLastSeenMs = 0;
    this.clearTargets();
  }

  private showTargets(targets: [THREE.Object3D, THREE.Object3D]): void {
    this.clearTargets();
    targets.forEach((target, index) => {
      const outline = new THREE.BoxHelper(target, TARGET_COLORS[index]);
      outline.name = '__aircad-combine-target';
      outline.userData.aircadSelectable = false;
      outline.renderOrder = 998;
      outline.material.depthTest = false;
      outline.material.transparent = true;
      outline.material.opacity = 0.9;
      this.store.group.add(outline);
      this.outlines.push(outline);
    });
  }

  private clearTargets(): void {
    this.outlines.forEach((outline) => {
      this.store.group.remove(outline);
      outline.geometry.dispose();
      outline.material.dispose();
    });
    this.outlines.length = 0;
  }

  private hideCursors(): void {
    this.cursors.forEach((cursor) => cursor.hide());
  }
}

function failureMessage(reason: CombineFailureReason): string {
  switch (reason) {
    case 'not-overlapping':
      return 'Move the objects so they overlap, then try again';
    case 'invalid-object':
      return 'Those objects cannot be combined';
    default:
      return 'Could not combine those objects';
  }
}
