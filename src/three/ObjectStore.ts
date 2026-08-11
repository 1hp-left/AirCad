import * as THREE from 'three';
import { isPrimitiveType, PRIMITIVE_LABELS } from './primitives';

/**
 * Owns selectable modeling objects and the current selection decoration.
 *
 * The store deliberately has no React state. SceneController mutates it from
 * the Three.js render loop, keeping selection and transforms off the HUD path.
 */
export class ObjectStore {
  private selectedObject: THREE.Object3D | null = null;
  private selectionOutline: THREE.BoxHelper | null = null;
  private readonly nameCounts = new Map<string, number>();

  constructor(readonly group: THREE.Group) {
    group.name = group.name || 'objects';
  }

  get selected(): THREE.Object3D | null {
    return this.selectedObject;
  }

  /** Modeling roots only; selection helpers and gesture feedback are excluded. */
  get objects(): readonly THREE.Object3D[] {
    return this.group.children.filter(
      (child) => child.userData.aircadSelectable === true,
    );
  }

  get size(): number {
    return this.objects.length;
  }

  /** Add a modeling object and mark it as eligible for gesture selection. */
  add<T extends THREE.Object3D>(object: T): T {
    object.userData.aircadSelectable = true;
    if (!object.name) object.name = this.nextObjectName(object);
    this.group.add(object);
    return object;
  }

  /** Remove a modeling root and release all geometry/material resources it owns. */
  remove(object: THREE.Object3D): string | null {
    if (object.parent !== this.group || object.userData.aircadSelectable === false) return null;
    const name = object.name || 'Object';
    if (object === this.selectedObject) this.clearSelection();
    this.group.remove(object);
    disposeObjectResources(object);
    return name;
  }

  deleteSelected(): string | null {
    return this.selectedObject ? this.remove(this.selectedObject) : null;
  }

  select(object: THREE.Object3D | null): void {
    if (
      object &&
      (object.parent !== this.group || object.userData.aircadSelectable === false)
    ) return;
    if (object === this.selectedObject) {
      this.selectionOutline?.update();
      return;
    }

    this.removeSelectionOutline();
    this.selectedObject = object;

    if (object) {
      this.selectionOutline = new THREE.BoxHelper(object, 0xe68a2e);
      this.selectionOutline.name = '__aircad-selection-outline';
      this.selectionOutline.userData.aircadSelectable = false;
      this.group.add(this.selectionOutline);
    }
  }

  clearSelection(): void {
    this.select(null);
  }

  /** Keep the outline aligned after a gesture changes an object's transform. */
  updateSelectionOutline(): void {
    this.selectionOutline?.update();
  }

  dispose(): void {
    this.removeSelectionOutline();
    this.selectedObject = null;
  }

  private removeSelectionOutline(): void {
    const outline = this.selectionOutline;
    if (!outline) return;
    this.group.remove(outline);
    outline.geometry.dispose();
    const material = outline.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
    this.selectionOutline = null;
  }

  private nextObjectName(object: THREE.Object3D): string {
    const primitive = object.userData.aircadPrimitive;
    const baseName = object.userData.aircadCombined
      ? 'Combined'
      : isPrimitiveType(primitive)
        ? PRIMITIVE_LABELS[primitive]
        : 'Object';
    const nextCount = (this.nameCounts.get(baseName) ?? 0) + 1;
    this.nameCounts.set(baseName, nextCount);
    return `${baseName} ${nextCount}`;
  }
}

function disposeObjectResources(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}
