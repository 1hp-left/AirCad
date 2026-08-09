import * as THREE from 'three';
import { GESTURE_CONFIG, type ActionId } from '../config/gestures';
import { GestureEngine } from '../gesture/GestureEngine';
import { fingertipScreen } from '../gesture/landmarkUtils';
import type { GestureFrame, HandResult } from '../gesture/types';
import { MoveAction } from './actions/MoveAction';
import { RotateAction } from './actions/RotateAction';
import { ScaleAction } from './actions/ScaleAction';
import { ShapeAction, type ShapeAxis } from './actions/ShapeAction';
import type { TransformAction } from './actions/TransformAction';
import { ObjectStore } from './ObjectStore';
import { raycastSelectableAtNormalizedPoint } from './selection';
import { SceneManager } from './SceneManager';

export interface SceneControllerSnapshot {
  action: ActionId;
  selectedName: string | null;
  isMoving: boolean;
  shapeAxis: ShapeAxis | null;
  input: 'gesture' | 'mouse' | null;
}

export type SceneControllerListener = (snapshot: SceneControllerSnapshot) => void;

const MIN_GESTURE_SCORE = 0.45;
const MIN_RELEASE_SCORE = 0.6;
const MAX_SELECTION_MISSES = 8;
const ACTION_START_MS = 70;
const ACTION_RELEASE_MS = 180;
const HAND_LOST_GRACE_MS = 300;

type TransformActionId = 'move' | 'rotate' | 'scale' | 'shape';

/**
 * Bridges gesture frames into the Three.js scene loop.
 *
 * GestureEngine only records the latest frame here. Scene mutations happen from
 * SceneManager's `onBeforeRender`, never from React or the camera callback.
 */
export class SceneController {
  private latestFrame: GestureFrame | null = null;
  private previousAction: ActionId = 'none';
  private selectionMisses = 0;
  private lastSnapshotKey = '';
  private activeAction: TransformAction | null = null;
  private activeActionId: TransformActionId | 'none' = 'none';
  private activeHandedness: string | null = null;
  private candidateAction: TransformActionId | 'none' = 'none';
  private candidateSinceMs = 0;
  private releaseSinceMs = 0;
  private lastActiveHandSeenMs = 0;
  private lastFrameTimestamp = -1;
  private disposed = false;
  private readonly shapeAction = new ShapeAction();
  private readonly actions: Record<TransformActionId, TransformAction> = {
    move: new MoveAction(),
    rotate: new RotateAction(),
    scale: new ScaleAction(),
    shape: this.shapeAction,
  };
  private readonly unsubscribe: () => void;
  private readonly manager: SceneManager;
  private readonly store: ObjectStore;
  private readonly listeners = new Set<SceneControllerListener>();
  private readonly selectionRaycaster = new THREE.Raycaster();
  private readonly missEndpoint = new THREE.Vector3();

  constructor(manager: SceneManager, engine: GestureEngine) {
    this.manager = manager;
    this.store = manager.objectStore;
    this.unsubscribe = engine.on((frame) => {
      this.latestFrame = frame;
    });
    manager.onBeforeRender = this.handleFrame;
    this.emitSnapshot();
  }

  on(listener: SceneControllerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): SceneControllerSnapshot {
    const selected = this.store.selected;
    return {
      action: this.activeAction ? this.activeActionId : this.previousAction,
      selectedName: selected?.name ?? null,
      isMoving: this.activeAction !== null,
      shapeAxis: this.activeActionId === 'shape' ? this.shapeAction.axisLabel : null,
      input: this.activeAction ? 'gesture' : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.latestFrame = null;
    this.resetActiveAction();
    this.manager.gestureCursor.hide();
    this.listeners.clear();
    if (this.manager.onBeforeRender === this.handleFrame) {
      this.manager.onBeforeRender = null;
    }
  }

  private readonly handleFrame = (): void => {
    if (this.manager.mouseInteractionActive) {
      this.resetActiveAction();
      this.manager.gestureCursor.hide();
      this.previousAction = 'none';
      this.emitSnapshot();
      return;
    }

    const frame = this.latestFrame;
    if (!frame || frame.timestampMs === this.lastFrameTimestamp) return;
    this.lastFrameTimestamp = frame.timestampMs;

    if (this.activeAction) {
      this.updateActiveAction(frame);
      return;
    }

    if (!frame.hands.length) {
      this.resetCandidate();
      this.manager.gestureCursor.hide();
      this.previousAction = 'none';
      this.emitSnapshot();
      return;
    }

    const pointingHand = frame.hands.find((hand) => actionFor(hand) === 'select');
    if (pointingHand) {
      this.resetCandidate();
      const fingertip = fingertipScreen(pointingHand);
      const hit = raycastSelectableAtNormalizedPoint(
        fingertip,
        this.manager.camera,
        this.store.group,
        this.selectionRaycaster,
      );
      const ray = this.selectionRaycaster.ray;

      // Make the exact selection ray visible so pointing can be debugged and
      // aimed without relying on the gesture label alone.
      this.manager.gestureCursor.show(
        ray,
        hit?.point ?? this.missEndpoint.copy(ray.origin).addScaledVector(ray.direction, 12),
        hit !== null,
      );

      if (hit) {
        this.store.select(hit.object);
        this.selectionMisses = 0;
      } else if (++this.selectionMisses >= MAX_SELECTION_MISSES) {
        this.store.clearSelection();
        this.selectionMisses = 0;
      }
      this.previousAction = 'select';
      this.emitSnapshot();
      return;
    }

    this.manager.gestureCursor.hide();
    this.selectionMisses = 0;

    const primaryHand = frame.hands[0];
    const action = actionFor(primaryHand);
    const selected = this.store.selected;

    if (selected && isTransformAction(action)) {
      if (this.advanceCandidate(action, frame.timestampMs)) {
        const nextAction = this.actions[action];
        nextAction.start(selected, primaryHand, this.manager.camera);
        this.activeAction = nextAction;
        this.activeActionId = action;
        this.activeHandedness = primaryHand.handedness;
        this.lastActiveHandSeenMs = frame.timestampMs;
        this.resetCandidate();
      }
    } else {
      this.resetCandidate();
    }

    this.previousAction = action;
    this.emitSnapshot();
  };

  private updateActiveAction(frame: GestureFrame): void {
    const activeHand = this.findActiveHand(frame.hands);
    if (!activeHand) {
      if (frame.timestampMs - this.lastActiveHandSeenMs >= HAND_LOST_GRACE_MS) {
        this.resetActiveAction();
        this.previousAction = 'none';
        this.emitSnapshot();
      }
      return;
    }

    this.lastActiveHandSeenMs = frame.timestampMs;
    const recognizedAction = actionFor(activeHand);
    const releaseRequested =
      activeHand.score >= MIN_RELEASE_SCORE &&
      (recognizedAction === 'create' || recognizedAction === 'select');

    if (releaseRequested) {
      if (!this.releaseSinceMs) this.releaseSinceMs = frame.timestampMs;
      if (frame.timestampMs - this.releaseSinceMs >= ACTION_RELEASE_MS) {
        this.resetActiveAction();
        this.previousAction = 'none';
        this.emitSnapshot();
      }
      return;
    }
    this.releaseSinceMs = 0;

    this.activeAction?.update(activeHand, this.manager.camera);
    this.store.updateSelectionOutline();
    this.previousAction = this.activeActionId;
    this.emitSnapshot();
  }

  private findActiveHand(hands: HandResult[]): HandResult | null {
    if (!hands.length) return null;
    return (
      hands.find((hand) => hand.handedness === this.activeHandedness) ??
      (hands.length === 1 ? hands[0] : null)
    );
  }

  private advanceCandidate(action: TransformActionId, timestampMs: number): boolean {
    if (this.candidateAction !== action) {
      this.candidateAction = action;
      this.candidateSinceMs = timestampMs;
      return false;
    }
    return timestampMs - this.candidateSinceMs >= ACTION_START_MS;
  }

  private resetCandidate(): void {
    this.candidateAction = 'none';
    this.candidateSinceMs = 0;
  }

  private resetActiveAction(): void {
    this.activeAction?.reset();
    this.activeAction = null;
    this.activeActionId = 'none';
    this.activeHandedness = null;
    this.releaseSinceMs = 0;
    this.lastActiveHandSeenMs = 0;
    this.resetCandidate();
  }

  private emitSnapshot(): void {
    const snapshot = this.snapshot();
    const key = `${snapshot.action}:${snapshot.selectedName ?? ''}:${snapshot.isMoving}:${snapshot.shapeAxis ?? ''}:${snapshot.input ?? ''}`;
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function actionFor(hand: HandResult): ActionId {
  if (hand.score < MIN_GESTURE_SCORE) return 'none';
  return GESTURE_CONFIG[hand.gesture]?.action ?? 'none';
}

function isTransformAction(action: ActionId): action is TransformActionId {
  return action === 'move' || action === 'rotate' || action === 'scale' || action === 'shape';
}
