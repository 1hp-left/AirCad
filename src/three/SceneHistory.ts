import * as THREE from 'three';
import type { SceneManager } from './SceneManager';

interface SceneSnapshot {
  objects: THREE.Object3D[];
  selectedName: string | null;
}

interface HistoryEntry {
  label: string;
  snapshot: SceneSnapshot;
}

export interface SceneHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

type HistoryListener = (state: SceneHistoryState) => void;

const MAX_HISTORY = 40;

/** Transactional, bounded scene history for menu and assistant operations. */
export class SceneHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<HistoryListener>();

  constructor(private readonly manager: SceneManager) {}

  get state(): SceneHistoryState {
    const undoEntry = this.undoStack[this.undoStack.length - 1];
    const redoEntry = this.redoStack[this.redoStack.length - 1];
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: undoEntry?.label ?? null,
      redoLabel: redoEntry?.label ?? null,
    };
  }

  onChange(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async perform<T>(label: string, operation: () => T | Promise<T>): Promise<T> {
    const before = captureScene(this.manager);
    try {
      const result = await operation();
      this.pushUndo({ label, snapshot: before });
      disposeEntries(this.redoStack);
      this.redoStack.length = 0;
      this.emit();
      return result;
    } catch (error) {
      restoreScene(this.manager, before);
      disposeSnapshot(before);
      this.emit();
      throw error;
    }
  }

  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const current = captureScene(this.manager);
    restoreScene(this.manager, entry.snapshot);
    disposeSnapshot(entry.snapshot);
    this.redoStack.push({ label: entry.label, snapshot: current });
    this.emit();
    return entry.label;
  }

  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const current = captureScene(this.manager);
    restoreScene(this.manager, entry.snapshot);
    disposeSnapshot(entry.snapshot);
    this.pushUndo({ label: entry.label, snapshot: current });
    this.emit();
    return entry.label;
  }

  dispose(): void {
    disposeEntries(this.undoStack);
    disposeEntries(this.redoStack);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.listeners.clear();
  }

  private pushUndo(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    while (this.undoStack.length > MAX_HISTORY) {
      const discarded = this.undoStack.shift();
      if (discarded) disposeSnapshot(discarded.snapshot);
    }
  }

  private emit(): void {
    const state = this.state;
    this.listeners.forEach((listener) => listener(state));
  }
}

function captureScene(manager: SceneManager): SceneSnapshot {
  return {
    objects: manager.objectStore.objects.map(cloneModelObject),
    selectedName: manager.objectStore.selected?.name ?? null,
  };
}

function restoreScene(manager: SceneManager, snapshot: SceneSnapshot): void {
  const store = manager.objectStore;
  [...store.objects].forEach((object) => store.remove(object));
  const restored = snapshot.objects.map((object) => store.add(cloneModelObject(object)));
  store.select(restored.find((object) => object.name === snapshot.selectedName) ?? null);
}

function cloneModelObject(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  clone.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone();
  });
  return clone;
}

function disposeEntries(entries: readonly HistoryEntry[]): void {
  entries.forEach((entry) => disposeSnapshot(entry.snapshot));
}

function disposeSnapshot(snapshot: SceneSnapshot): void {
  snapshot.objects.forEach((object) => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
  });
}
