import { GESTURE_CONFIG, type ActionId } from '../config/gestures';
import { GestureEngine } from '../gesture/GestureEngine';
import { fingertipScreen } from '../gesture/landmarkUtils';
import type { GestureFrame, HandResult } from '../gesture/types';
import { MoveAction } from './actions/MoveAction';
import { RotateAction } from './actions/RotateAction';
import { ScaleAction } from './actions/ScaleAction';
import { ShapeAction } from './actions/ShapeAction';
import type { TransformAction } from './actions/TransformAction';
import { ObjectStore } from './ObjectStore';
import {
  raycastSelectableAtNormalizedPoint,
  rayEndpoint,
  selectionRayAtNormalizedPoint,
} from './selection';
import { SceneManager } from './SceneManager';

export interface SceneControllerSnapshot {
  action: ActionId;
  selectedName: string | null;
  isMoving: boolean;
}

export type SceneControllerListener = (snapshot: SceneControllerSnapshot) => void;

const MIN_GESTURE_SCORE = 0.45;
const MAX_SELECTION_MISSES = 8;

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
  private activeActionId: ActionId = 'none';
  private readonly actions: Partial<Record<ActionId, TransformAction>> = {
    move: new MoveAction(),
    rotate: new RotateAction(),
    scale: new ScaleAction(),
    shape: new ShapeAction(),
  };
  private readonly unsubscribe: () => void;
  private readonly manager: SceneManager;
  private readonly store: ObjectStore;
  private readonly listeners = new Set<SceneControllerListener>();

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
    };
  }

  dispose(): void {
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
    const frame = this.latestFrame;
    if (this.manager.mouseInteractionActive) {
      this.resetActiveAction();
      this.manager.gestureCursor.hide();
      this.previousAction = 'none';
      this.emitSnapshot();
      return;
    }

    if (!frame || frame.hands.length === 0) {
      this.resetActiveAction();
      this.manager.gestureCursor.hide();
      this.previousAction = 'none';
      this.emitSnapshot();
      return;
    }

    const pointingHand = frame.hands.find((hand) => actionFor(hand) === 'select');
    if (pointingHand) {
      this.resetActiveAction();
      const fingertip = fingertipScreen(pointingHand);
      const ray = selectionRayAtNormalizedPoint(fingertip, this.manager.camera);
      const hit = raycastSelectableAtNormalizedPoint(
        fingertip,
        this.manager.camera,
        this.store.group,
      );

      // Make the exact selection ray visible so pointing can be debugged and
      // aimed without relying on the gesture label alone.
      this.manager.gestureCursor.show(
        ray,
        hit?.point ?? rayEndpoint(ray, 12),
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
    const nextAction = this.actions[action];
    const selected = this.store.selected;

    if (nextAction && selected) {
      if (this.activeAction !== nextAction || nextAction.object !== selected) {
        this.resetActiveAction();
        nextAction.start(selected, primaryHand, this.manager.camera);
        this.activeAction = nextAction;
        this.activeActionId = action;
      }
      nextAction.update(primaryHand, this.manager.camera);
      this.store.updateSelectionOutline();
    } else {
      this.resetActiveAction();
    }

    this.previousAction = action;
    this.emitSnapshot();
  };

  private resetActiveAction(): void {
    this.activeAction?.reset();
    this.activeAction = null;
    this.activeActionId = 'none';
  }

  private emitSnapshot(): void {
    const snapshot = this.snapshot();
    const key = `${snapshot.action}:${snapshot.selectedName ?? ''}:${snapshot.isMoving}`;
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function actionFor(hand: HandResult): ActionId {
  if (hand.score < MIN_GESTURE_SCORE) return 'none';
  return GESTURE_CONFIG[hand.gesture]?.action ?? 'none';
}
