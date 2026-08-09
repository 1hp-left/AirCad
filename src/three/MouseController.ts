import * as THREE from 'three';
import type { SceneControllerListener, SceneControllerSnapshot } from './SceneController';
import { MoveAction } from './actions/MoveAction';
import {
  clientToNdc,
  raycastSelectableAtNdc,
} from './selection';
import { SceneManager } from './SceneManager';

const DRAG_THRESHOLD_PX = 5;

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
  private readonly listeners = new Set<SceneControllerListener>();
  private readonly canvas: HTMLCanvasElement;
  private pointerId: number | null = null;
  private pointerDown = new THREE.Vector2();
  private dragging = false;
  private pressedObject: THREE.Object3D | null = null;
  private lastSnapshotKey = '';

  constructor(manager: SceneManager) {
    this.manager = manager;
    this.canvas = manager.renderer.domElement;
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.emitSnapshot('none');
  }

  on(listener: SceneControllerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): SceneControllerSnapshot {
    const selected = this.manager.objectStore.selected;
    return {
      action: this.moveAction.isActive
        ? 'move'
        : this.pointerId !== null
          ? 'select'
          : 'none',
      selectedName: selected?.name ?? null,
      isMoving: this.moveAction.isActive,
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
    this.listeners.clear();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointerId !== null) return;

    const hit = this.hitAt(event);
    this.pointerId = event.pointerId;
    this.pointerDown.set(event.clientX, event.clientY);
    this.dragging = false;
    this.pressedObject = hit?.object ?? null;
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
      const initialRay = this.rayAt(this.pointerDown.x, this.pointerDown.y);
      this.moveAction.startFromRay(this.pressedObject, initialRay);
      this.manager.controls.enabled = false;
    }

    this.moveAction.updateFromRay(this.rayAt(event.clientX, event.clientY));
    this.manager.objectStore.updateSelectionOutline();
    this.emitSnapshot('move');
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.finishPointer();
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.finishPointer();
  };

  private finishPointer(): void {
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
      this.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.pressedObject = null;
    this.dragging = false;
    this.moveAction.reset();
    this.manager.controls.enabled = true;
    this.manager.mouseInteractionActive = false;
    this.emitSnapshot('select');
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
      action: snapshot.isMoving ? 'move' : action,
    } satisfies SceneControllerSnapshot;
    const key = `${next.action}:${next.selectedName ?? ''}:${next.isMoving}`;
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.listeners.forEach((listener) => listener(next));
  }
}
