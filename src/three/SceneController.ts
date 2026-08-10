import * as THREE from 'three';
import { GESTURE_CONFIG, type ActionId } from '../config/gestures';
import { GestureEngine } from '../gesture/GestureEngine';
import { fingertipScreen, pinchPoint } from '../gesture/landmarkUtils';
import type { GestureFrame, HandResult } from '../gesture/types';
import { CombineGesture } from './actions/CombineGesture';
import { CreateAction } from './actions/CreateAction';
import { MoveAction } from './actions/MoveAction';
import { RotateAction } from './actions/RotateAction';
import { ScaleAction } from './actions/ScaleAction';
import { ShapeAction, type ShapeAxis } from './actions/ShapeAction';
import { TwoHandTransformAction } from './actions/TwoHandTransformAction';
import type { TransformAction } from './actions/TransformAction';
import { ObjectStore } from './ObjectStore';
import type { PrimitiveType } from './primitives';
import { normalizedToNdc, raycastSelectableAtNormalizedPoint } from './selection';
import { SceneManager } from './SceneManager';

export interface SceneControllerSnapshot {
  action: ActionId;
  selectedName: string | null;
  isMoving: boolean;
  shapeAxis: ShapeAxis | null;
  input: 'gesture' | 'mouse' | null;
  notice: string | null;
}

export type SceneControllerListener = (snapshot: SceneControllerSnapshot) => void;

const MIN_GESTURE_SCORE = 0.45;
const MIN_RELEASE_SCORE = 0.6;
const MAX_SELECTION_MISSES = 8;
const ACTION_START_MS = 70;
const ACTION_RELEASE_MS = 180;
const HAND_LOST_GRACE_MS = 300;
const PINCH_START_MS = 55;
const PINCH_RELEASE_MS = 90;
const CURSOR_DEPTH = 12;
const ONE_SHOT_HOLD_MS = 220;
const ONE_SHOT_RELEASE_MS = 180;

type TransformActionId = 'move' | 'rotate' | 'scale' | 'shape';
type OneShotActionId = 'create' | 'delete';
type PinchMode = 'none' | 'move' | 'transform';

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
  private oneShotCandidate: OneShotActionId | 'none' = 'none';
  private oneShotCandidateSinceMs = 0;
  private oneShotLatch: OneShotActionId | null = null;
  private oneShotReleaseSinceMs = 0;
  private releaseSinceMs = 0;
  private lastActiveHandSeenMs = 0;
  private pinchMode: PinchMode = 'none';
  private pinchHandedness: string | null = null;
  private pinchCandidateKey = '';
  private pinchCandidateSinceMs = 0;
  private pinchReleaseSinceMs = 0;
  private lastFrameTimestamp = -1;
  private disposed = false;
  private primitiveType: PrimitiveType;
  private notice: string | null = null;
  private readonly combineGesture: CombineGesture;
  private readonly createAction = new CreateAction();
  private readonly moveAction = new MoveAction();
  private readonly shapeAction = new ShapeAction();
  private readonly twoHandTransformAction = new TwoHandTransformAction();
  private readonly actions: Record<TransformActionId, TransformAction> = {
    move: this.moveAction,
    rotate: new RotateAction(),
    scale: new ScaleAction(),
    shape: this.shapeAction,
  };
  private readonly unsubscribe: () => void;
  private readonly manager: SceneManager;
  private readonly store: ObjectStore;
  private readonly listeners = new Set<SceneControllerListener>();
  private readonly selectionRaycaster = new THREE.Raycaster();
  private readonly pinchRaycasters = [new THREE.Raycaster(), new THREE.Raycaster()] as const;
  private readonly missEndpoint = new THREE.Vector3();

  constructor(manager: SceneManager, engine: GestureEngine, primitiveType: PrimitiveType = 'box') {
    this.manager = manager;
    this.store = manager.objectStore;
    this.combineGesture = new CombineGesture(
      manager.camera,
      this.store,
      manager.combineCursors,
    );
    this.primitiveType = primitiveType;
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
    const pinchAction: ActionId | null = this.pinchMode === 'transform'
      ? 'transform'
      : this.pinchMode === 'move'
        ? 'move'
        : null;
    const combining =
      this.combineGesture.active ||
      (this.previousAction === 'combine' && Boolean(this.notice));
    const action = pinchAction ?? (
      this.activeAction
        ? this.activeActionId
        : combining
          ? 'combine'
          : this.notice && this.oneShotLatch
            ? this.oneShotLatch
            : this.previousAction
    );
    return {
      action,
      selectedName: selected?.name ?? null,
      isMoving: this.pinchMode !== 'none' || this.activeAction !== null,
      shapeAxis: this.activeActionId === 'shape' ? this.shapeAction.axisLabel : null,
      input: this.pinchMode !== 'none' || this.activeAction ? 'gesture' : null,
      notice: this.notice,
    };
  }

  setPrimitiveType(type: PrimitiveType): void {
    this.primitiveType = type;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.latestFrame = null;
    this.resetActiveAction();
    this.resetPinchManipulation();
    this.combineGesture.reset();
    this.manager.gestureCursor.hide();
    this.listeners.clear();
    if (this.manager.onBeforeRender === this.handleFrame) {
      this.manager.onBeforeRender = null;
    }
  }

  private readonly handleFrame = (): void => {
    if (this.manager.mouseInteractionActive) {
      const wasCombining = this.combineGesture.active || this.previousAction === 'combine';
      this.resetActiveAction();
      this.resetPinchManipulation();
      this.combineGesture.reset();
      if (wasCombining) this.notice = null;
      this.manager.gestureCursor.hide();
      this.previousAction = 'none';
      this.emitSnapshot();
      return;
    }

    const frame = this.latestFrame;
    if (!frame || frame.timestampMs === this.lastFrameTimestamp) return;
    this.lastFrameTimestamp = frame.timestampMs;

    const pinchingHands = frame.hands
      .filter((hand) => hand.pinching)
      .sort(compareHands);

    // Once a two-hand transform starts, it owns both pinches until one opens.
    // This avoids accidentally switching to Combine when a rotating ray slips
    // off the object for a frame.
    if (
      this.pinchMode === 'transform' &&
      this.handlePinchManipulation(frame, pinchingHands)
    ) return;

    if (this.handleCombineGesture(frame, pinchingHands)) return;
    if (this.handlePinchManipulation(frame, pinchingHands)) return;

    if (this.activeAction) {
      this.updateActiveAction(frame);
      return;
    }

    if (!frame.hands.length) {
      this.resetCandidate();
      this.resetOneShotCandidate();
      this.updateOneShotLatch('none', frame.timestampMs);
      this.manager.gestureCursor.hide();
      this.previousAction = 'none';
      this.emitSnapshot();
      return;
    }

    const primaryHand = frame.hands[0];
    const action = actionFor(primaryHand);
    this.updateOneShotLatch(action, frame.timestampMs);

    const pointingHand = frame.hands.find((hand) => actionFor(hand) === 'select');
    if (pointingHand) {
      this.resetCandidate();
      this.resetOneShotCandidate();
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

    if (isOneShotAction(action)) {
      this.resetCandidate();
      this.handleOneShotAction(action, primaryHand, frame.timestampMs);
      this.previousAction = action;
      this.emitSnapshot();
      return;
    }

    this.resetOneShotCandidate();
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
        const releasedWithOpenPalm = recognizedAction === 'create';
        this.resetActiveAction();
        if (releasedWithOpenPalm) this.blockOneShotUntilRelease('create');
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

  private handleCombineGesture(
    frame: GestureFrame,
    pinchingHands: HandResult[],
  ): boolean {
    if (pinchingHands.length < 2 && !this.combineGesture.active) return false;

    const update = this.combineGesture.update(pinchingHands, frame.timestampMs);
    this.notice = update.notice;
    if (update.released && frame.hands[0] && actionFor(frame.hands[0]) === 'create') {
      this.blockOneShotUntilRelease('create');
    }
    if (!update.consumed) return false;

    this.resetActiveAction();
    this.resetPinchManipulation();
    this.resetOneShotCandidate();
    this.blockOneShotUntilRelease('create');
    this.manager.gestureCursor.hide();
    this.previousAction = 'combine';
    this.emitSnapshot();
    return true;
  }

  private handlePinchManipulation(
    frame: GestureFrame,
    pinchingHands: HandResult[],
  ): boolean {
    if (this.pinchMode === 'transform') {
      return this.updateTwoHandTransform(frame, pinchingHands);
    }
    if (this.pinchMode === 'move') {
      return this.updatePinchMove(frame, pinchingHands);
    }

    if (!pinchingHands.length) {
      this.resetPinchCandidate();
      return false;
    }

    this.resetActiveAction();
    this.blockOneShotUntilRelease('create');
    this.notice = null;

    if (pinchingHands.length >= 2) {
      const target = this.sharedPinchTarget(pinchingHands[0], pinchingHands[1]);
      if (target) this.startTwoHandTransform(target, pinchingHands[0], pinchingHands[1]);
      else {
        this.manager.gestureCursor.hide();
        this.previousAction = 'none';
        this.emitSnapshot();
      }
      return true;
    }

    return this.advancePinchMove(pinchingHands[0], frame.timestampMs);
  }

  private advancePinchMove(hand: HandResult, timestampMs: number): boolean {
    const hit = raycastSelectableAtNormalizedPoint(
      pinchPoint(hand),
      this.manager.camera,
      this.store.group,
      this.selectionRaycaster,
    );
    const ray = this.selectionRaycaster.ray;
    this.manager.gestureCursor.show(
      ray,
      hit?.point ?? this.missEndpoint.copy(ray.origin).addScaledVector(ray.direction, CURSOR_DEPTH),
      hit !== null,
    );

    if (!hit) {
      this.resetPinchCandidate();
      this.previousAction = 'none';
      this.emitSnapshot();
      return true;
    }

    this.store.select(hit.object);
    const candidateKey = `${hand.handedness}:${hit.object.uuid}`;
    if (candidateKey !== this.pinchCandidateKey) {
      this.pinchCandidateKey = candidateKey;
      this.pinchCandidateSinceMs = timestampMs;
      this.previousAction = 'move';
      this.emitSnapshot();
      return true;
    }
    if (timestampMs - this.pinchCandidateSinceMs < PINCH_START_MS) return true;

    this.resetActiveAction();
    this.resetPinchManipulation();
    this.moveAction.start(hit.object, hand, this.manager.camera);
    this.pinchMode = 'move';
    this.pinchHandedness = hand.handedness;
    this.notice = null;
    this.blockOneShotUntilRelease('create');
    this.previousAction = 'move';
    this.emitSnapshot();
    return true;
  }

  private updatePinchMove(frame: GestureFrame, pinchingHands: HandResult[]): boolean {
    if (pinchingHands.length >= 2) {
      const target = this.sharedPinchTarget(pinchingHands[0], pinchingHands[1]);
      if (target) {
        this.startTwoHandTransform(target, pinchingHands[0], pinchingHands[1]);
      }
      return true;
    }

    const activeHand = pinchingHands.find(
      (hand) => hand.handedness === this.pinchHandedness,
    ) ?? (pinchingHands.length === 1 ? pinchingHands[0] : null);

    if (activeHand) {
      this.pinchReleaseSinceMs = 0;
      this.moveAction.update(activeHand, this.manager.camera);
      this.showActivePinchCursor(activeHand, this.moveAction.object);
      this.store.updateSelectionOutline();
      this.previousAction = 'move';
      this.emitSnapshot();
      return true;
    }

    const activeHandStillTracked = frame.hands.some(
      (hand) => hand.handedness === this.pinchHandedness,
    );
    const releaseDelay = activeHandStillTracked ? PINCH_RELEASE_MS : HAND_LOST_GRACE_MS;
    if (!this.pinchReleaseSinceMs) this.pinchReleaseSinceMs = frame.timestampMs;
    if (frame.timestampMs - this.pinchReleaseSinceMs < releaseDelay) return true;

    this.resetPinchManipulation();
    this.previousAction = 'none';
    this.emitSnapshot();
    return true;
  }

  private startTwoHandTransform(
    target: THREE.Object3D,
    firstHand: HandResult,
    secondHand: HandResult,
  ): void {
    this.resetActiveAction();
    this.resetPinchManipulation();
    this.store.select(target);
    this.twoHandTransformAction.start(target, firstHand, secondHand, this.manager.camera);
    this.pinchMode = 'transform';
    this.notice = null;
    this.blockOneShotUntilRelease('create');
    this.manager.gestureCursor.hide();
    this.previousAction = 'transform';
    this.emitSnapshot();
  }

  private updateTwoHandTransform(
    frame: GestureFrame,
    pinchingHands: HandResult[],
  ): boolean {
    if (pinchingHands.length >= 2) {
      this.pinchReleaseSinceMs = 0;
      this.twoHandTransformAction.update(
        pinchingHands[0],
        pinchingHands[1],
        this.manager.camera,
      );
      this.store.updateSelectionOutline();
      this.previousAction = 'transform';
      this.emitSnapshot();
      return true;
    }

    const releaseDelay = frame.hands.length >= 2 ? PINCH_RELEASE_MS : HAND_LOST_GRACE_MS;
    if (!this.pinchReleaseSinceMs) this.pinchReleaseSinceMs = frame.timestampMs;
    if (frame.timestampMs - this.pinchReleaseSinceMs < releaseDelay) return true;

    const target = this.twoHandTransformAction.object;
    if (target && pinchingHands.length === 1) {
      const remainingHand = pinchingHands[0];
      this.twoHandTransformAction.reset();
      this.moveAction.start(target, remainingHand, this.manager.camera);
      this.pinchMode = 'move';
      this.pinchHandedness = remainingHand.handedness;
      this.pinchReleaseSinceMs = 0;
      this.previousAction = 'move';
      this.emitSnapshot();
      return true;
    }

    this.resetPinchManipulation();
    this.previousAction = 'none';
    this.emitSnapshot();
    return true;
  }

  private sharedPinchTarget(
    firstHand: HandResult,
    secondHand: HandResult,
  ): THREE.Object3D | null {
    const first = raycastSelectableAtNormalizedPoint(
      pinchPoint(firstHand),
      this.manager.camera,
      this.store.group,
      this.pinchRaycasters[0],
    )?.object ?? null;
    const second = raycastSelectableAtNormalizedPoint(
      pinchPoint(secondHand),
      this.manager.camera,
      this.store.group,
      this.pinchRaycasters[1],
    )?.object ?? null;
    return first && first === second ? first : null;
  }

  private showActivePinchCursor(
    hand: HandResult,
    target: THREE.Object3D | null,
  ): void {
    this.selectionRaycaster.setFromCamera(
      normalizedToNdc(pinchPoint(hand)),
      this.manager.camera,
    );
    const ray = this.selectionRaycaster.ray;
    const endpoint = target
      ? target.getWorldPosition(this.missEndpoint)
      : this.missEndpoint.copy(ray.origin).addScaledVector(ray.direction, CURSOR_DEPTH);
    this.manager.gestureCursor.show(ray, endpoint, target !== null);
  }

  private resetPinchCandidate(): void {
    this.pinchCandidateKey = '';
    this.pinchCandidateSinceMs = 0;
  }

  private resetPinchManipulation(): void {
    this.moveAction.reset();
    this.twoHandTransformAction.reset();
    this.pinchMode = 'none';
    this.pinchHandedness = null;
    this.pinchReleaseSinceMs = 0;
    this.resetPinchCandidate();
    this.manager.gestureCursor.hide();
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

  private handleOneShotAction(
    action: OneShotActionId,
    hand: HandResult,
    timestampMs: number,
  ): void {
    if (this.oneShotLatch) {
      this.resetOneShotCandidate();
      return;
    }

    if (this.oneShotCandidate !== action) {
      this.oneShotCandidate = action;
      this.oneShotCandidateSinceMs = timestampMs;
      this.notice = null;
      return;
    }
    if (timestampMs - this.oneShotCandidateSinceMs < ONE_SHOT_HOLD_MS) return;

    if (action === 'create') {
      const object = this.createAction.execute(
        this.primitiveType,
        hand,
        this.manager.camera,
        this.store,
      );
      this.notice = `${object.name} created`;
    } else {
      const deletedName = this.store.deleteSelected();
      this.notice = deletedName ? `${deletedName} deleted` : 'Select an object before deleting';
    }

    this.oneShotLatch = action;
    this.oneShotReleaseSinceMs = 0;
    this.resetOneShotCandidate();
  }

  private updateOneShotLatch(action: ActionId, timestampMs: number): void {
    if (!this.oneShotLatch) return;
    if (action === this.oneShotLatch) {
      this.oneShotReleaseSinceMs = 0;
      return;
    }
    if (!this.oneShotReleaseSinceMs) this.oneShotReleaseSinceMs = timestampMs;
    if (timestampMs - this.oneShotReleaseSinceMs < ONE_SHOT_RELEASE_MS) return;

    this.oneShotLatch = null;
    this.oneShotReleaseSinceMs = 0;
    this.notice = null;
  }

  private blockOneShotUntilRelease(action: OneShotActionId): void {
    this.oneShotLatch = action;
    this.oneShotReleaseSinceMs = 0;
    this.resetOneShotCandidate();
  }

  private resetOneShotCandidate(): void {
    this.oneShotCandidate = 'none';
    this.oneShotCandidateSinceMs = 0;
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
    const key = `${snapshot.action}:${snapshot.selectedName ?? ''}:${snapshot.isMoving}:${snapshot.shapeAxis ?? ''}:${snapshot.input ?? ''}:${snapshot.notice ?? ''}`;
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

function isOneShotAction(action: ActionId): action is OneShotActionId {
  return action === 'create' || action === 'delete';
}

function compareHands(first: HandResult, second: HandResult): number {
  const byHandedness = first.handedness.localeCompare(second.handedness);
  return byHandedness || pinchPoint(first).x - pinchPoint(second).x;
}
