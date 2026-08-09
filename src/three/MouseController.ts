import * as THREE from 'three';
import type { SceneControllerListener, SceneControllerSnapshot } from './SceneController';
import { MoveAction } from './actions/MoveAction';
import { RotateAction } from './actions/RotateAction';
import { ScaleAction } from './actions/ScaleAction';
import { ShapeAction } from './actions/ShapeAction';
import type { MouseTransformAction } from './actions/TransformAction';
import {
  clientToNdc,
  raycastSelectableAtNdc,
} from './selection';
import { SceneManager } from './SceneManager';

const DRAG_THRESHOLD_PX = 5;
type TransformActionId = 'rotate' | 'scale' | 'shape';

/**
 * Bridges pointer input into the same select/move scene actions as gestures.
 *
 * Pointer events are staged and applied by this scene-side controller, never by
 * React. The left mouse button is reserved for modeling; OrbitControls keeps
 * right/middle drag and wheel navigation.
 */
export class MouseController {
  private readonly manager: SceneManager;
  private readonly moveAction = new MoveAction();
  private readonly transformActions: Record<TransformActionId, MouseTransformAction> = {
    rotate: new RotateAction(),
    scale: new ScaleAction(),
    shape: new ShapeAction(),
  };
  private readonly listeners = new Set<SceneControllerListener>();
  private readonly heldKeys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private pointerId: number | null = null;
  private pointerDown = new THREE.Vector2();
  private dragging = false;
  private pressedObject: THREE.Object3D | null = null;
  private pressedTransform: TransformActionId | null = null;
  private activeTransform: TransformActionId | null = null;
  private lastSnapshotKey = '';

  constructor(manager: SceneManager) {
    this.manager = manager;
    this.canvas = manager.renderer.domElement;
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('lostpointercapture', this.handleLostPointerCapture);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    this.emitSnapshot('none');
  }

  on(listener: SceneControllerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): SceneControllerSnapshot {
    const selected = this.manager.objectStore.selected;
    const transformActive = this.activeTransform !== null;
    return {
      action: transformActive
        ? this.activeTransform!
        : this.moveAction.isActive
          ? 'move'
          : this.pointerId !== null
            ? 'select'
            : 'none',
      selectedName: selected?.name ?? null,
      isMoving: this.moveAction.isActive || transformActive,
    };
  }

  get isInteracting(): boolean {
    return this.pointerId !== null;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  dispose(): void {
    this.finishPointer();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.handleLostPointerCapture);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.listeners.clear();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.heldKeys.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  private readonly handleWindowBlur = (): void => {
    this.heldKeys.clear();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointerId !== null) return;

    const hit = this.hitAt(event);
    this.pointerId = event.pointerId;
    this.pointerDown.set(event.clientX, event.clientY);
    this.dragging = false;
    this.pressedObject = hit?.object ?? null;
    this.pressedTransform = hit ? this.transformForHeldKeys() : null;
    this.activeTransform = null;
    this.manager.mouseInteractionActive = true;
    this.canvas.setPointerCapture(event.pointerId);

    if (hit) {
      this.manager.objectStore.select(hit.object);
      this.emitSnapshot('select');
    } else {
      this.manager.objectStore.clearSelection();
      this.emitSnapshot('none');
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || !this.pressedObject) return;

    const distance = Math.hypot(
      event.clientX - this.pointerDown.x,
      event.clientY - this.pointerDown.y,
    );
    if (!this.dragging && distance < DRAG_THRESHOLD_PX) return;

    if (!this.dragging) {
      this.dragging = true;
      this.manager.controls.enabled = false;
      if (this.pressedTransform) {
        this.activeTransform = this.pressedTransform;
        this.transformActions[this.activeTransform].startFromDrag(this.pressedObject);
      } else {
        this.moveAction.startFromRay(
          this.pressedObject,
          this.rayAt(this.pointerDown.x, this.pointerDown.y),
        );
      }
    }

    if (this.activeTransform) {
      this.transformActions[this.activeTransform].updateFromDrag(
        event.clientX - this.pointerDown.x,
        event.clientY - this.pointerDown.y,
      );
      this.emitSnapshot(this.activeTransform);
    } else {
      this.moveAction.updateFromRay(this.rayAt(event.clientX, event.clientY));
      this.emitSnapshot('move');
    }
    this.manager.objectStore.updateSelectionOutline();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.finishPointer();
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.finishPointer();
  };

  private readonly handleLostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.finishPointer();
  };

  private finishPointer(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
    this.pressedObject = null;
    this.pressedTransform = null;
    this.dragging = false;
    this.moveAction.reset();
    if (this.activeTransform) this.transformActions[this.activeTransform].reset();
    this.activeTransform = null;
    this.manager.controls.enabled = true;

    // Emit the final mouse snapshot while mouse ownership is still active. If
    // ownership is cleared first, App would immediately replace this selected
    // state with the last gesture snapshot and make the object look deselected.
    this.emitSnapshot('select');
    this.manager.mouseInteractionActive = false;
  }

  private transformForHeldKeys(): TransformActionId | null {
    if (this.heldKeys.has('KeyR')) return 'rotate';
    if (this.heldKeys.has('KeyS')) {
      return this.heldKeys.has('ShiftLeft') || this.heldKeys.has('ShiftRight')
        ? 'shape'
        : 'scale';
    }
    return null;
  }

  private hitAt(event: PointerEvent): ReturnType<typeof raycastSelectableAtNdc> {
    const rect = this.canvas.getBoundingClientRect();
    return raycastSelectableAtNdc(
      clientToNdc(event.clientX, event.clientY, rect),
      this.manager.camera,
      this.manager.objectStore.group,
    );
  }

  private rayAt(clientX: number, clientY: number): THREE.Ray {
    const rect = this.canvas.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      clientToNdc(clientX, clientY, rect),
      this.manager.camera,
    );
    return raycaster.ray.clone();
  }

  private emitSnapshot(action: SceneControllerSnapshot['action']): void {
    const snapshot = this.snapshot();
    const next = {
      ...snapshot,
      action: snapshot.isMoving ? (this.activeTransform ?? (this.moveAction.isActive ? 'move' : action)) : action,
    } satisfies SceneControllerSnapshot;
    const key = `${next.action}:${next.selectedName ?? ''}:${next.isMoving}`;
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.listeners.forEach((listener) => listener(next));
  }
}
