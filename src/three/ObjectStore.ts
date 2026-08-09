import * as THREE from 'three';

/**
 * Owns selectable modeling objects and the current selection decoration.
 *
 * The store deliberately has no React state. SceneController mutates it from
 * the Three.js render loop, keeping selection and transforms off the HUD path.
 */
export class ObjectStore {
  private selectedObject: THREE.Object3D | null = null;
  private selectionOutline: THREE.BoxHelper | null = null;

  constructor(readonly group: THREE.Group) {
    group.name = group.name || 'objects';
  }

  get selected(): THREE.Object3D | null {
    return this.selectedObject;
  }

  /** Add a modeling object and mark it as eligible for gesture selection. */
  add<T extends THREE.Object3D>(object: T): T {
    object.userData.aircadSelectable = true;
    this.group.add(object);
    return object;
  }

  /** Direct children are modeling roots; the outline is explicitly excluded. */
  getSelectableObjects(): THREE.Object3D[] {
    return this.group.children.filter(
      (object) =>
        object !== this.selectionOutline && object.userData.aircadSelectable !== false,
    );
  }

  select(object: THREE.Object3D | null): void {
    if (object && !this.getSelectableObjects().includes(object)) return;
    if (object === this.selectedObject) {
      this.selectionOutline?.update();
      return;
    }

    this.removeSelectionOutline();
    this.selectedObject = object;

    if (object) {
      this.selectionOutline = new THREE.BoxHelper(object, 0x4fd1c5);
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
}
