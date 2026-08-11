import * as THREE from 'three';
import {
  loadSolidUnion,
  SolidGeometryError,
  type SolidUnion,
} from '../manifold';
import type { ObjectStore } from '../ObjectStore';

const MIN_OVERLAP = 0.001;

export type CombineFailureReason =
  | 'invalid-object'
  | 'not-overlapping'
  | 'empty-result'
  | 'evaluation-failed';

export type CombineResult =
  | { ok: true; object: THREE.Mesh; sourceNames: [string, string] }
  | { ok: false; reason: CombineFailureReason };

export type CombineActionStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Boolean-union two overlapping modeling meshes into one selectable result. */
export class CombineAction {
  private unionEngine: SolidUnion | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadStatus: CombineActionStatus = 'idle';
  private readonly firstBounds = new THREE.Box3();
  private readonly secondBounds = new THREE.Box3();
  private readonly overlapBounds = new THREE.Box3();
  private readonly overlapSize = new THREE.Vector3();
  private readonly worldToObjects = new THREE.Matrix4();

  get status(): CombineActionStatus {
    return this.loadStatus;
  }

  /** Load the comparatively heavy CSG runtime only when a combine starts. */
  prepare(): void {
    if (this.loadPromise || this.loadStatus === 'ready') return;
    this.loadStatus = 'loading';
    this.loadPromise = loadSolidUnion()
      .then((unionEngine) => {
        this.unionEngine = unionEngine;
        this.loadStatus = 'ready';
      })
      .catch(() => {
        this.loadStatus = 'error';
      });
  }

  async executeWhenReady(
    first: THREE.Object3D,
    second: THREE.Object3D,
    store: ObjectStore,
  ): Promise<CombineResult> {
    this.prepare();
    await this.loadPromise;
    return this.execute(first, second, store);
  }

  execute(first: THREE.Object3D, second: THREE.Object3D, store: ObjectStore): CombineResult {
    const unionEngine = this.unionEngine;
    if (!unionEngine) {
      return { ok: false, reason: 'evaluation-failed' };
    }

    const firstMesh = modelingMesh(first, store);
    const secondMesh = modelingMesh(second, store);
    if (!firstMesh || !secondMesh || firstMesh === secondMesh) {
      return { ok: false, reason: 'invalid-object' };
    }
    if (!this.overlaps(firstMesh, secondMesh)) {
      return { ok: false, reason: 'not-overlapping' };
    }

    const sourceNames: [string, string] = [
      firstMesh.name || 'First object',
      secondMesh.name || 'Second object',
    ];
    let resultGeometry: THREE.BufferGeometry;

    try {
      resultGeometry = unionEngine.union([firstMesh, secondMesh]);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof SolidGeometryError && error.reason === 'empty-result'
          ? 'empty-result'
          : 'evaluation-failed',
      };
    }

    // Union output is in world coordinates. Convert it back into the
    // ObjectStore group's local frame before adding an identity mesh.
    store.group.updateWorldMatrix(true, false);
    this.worldToObjects.copy(store.group.matrixWorld).invert();
    resultGeometry.applyMatrix4(this.worldToObjects);

    const result = new THREE.Mesh(
      resultGeometry,
      primaryMaterial(firstMesh.material).clone(),
    );
    result.castShadow = true;
    result.receiveShadow = true;
    result.userData.aircadCombined = true;

    store.clearSelection();
    store.remove(firstMesh);
    store.remove(secondMesh);
    store.add(result);
    store.select(result);
    return { ok: true, object: result, sourceNames };
  }

  private overlaps(first: THREE.Object3D, second: THREE.Object3D): boolean {
    this.firstBounds.setFromObject(first);
    this.secondBounds.setFromObject(second);
    this.overlapBounds.copy(this.firstBounds).intersect(this.secondBounds);
    if (this.overlapBounds.isEmpty()) return false;

    this.overlapBounds.getSize(this.overlapSize);
    return (
      this.overlapSize.x > MIN_OVERLAP &&
      this.overlapSize.y > MIN_OVERLAP &&
      this.overlapSize.z > MIN_OVERLAP
    );
  }
}

function modelingMesh(object: THREE.Object3D, store: ObjectStore): THREE.Mesh | null {
  const mesh = object as THREE.Mesh;
  return mesh.parent === store.group && mesh.isMesh && mesh.geometry
    ? mesh
    : null;
}

function primaryMaterial(material: THREE.Material | THREE.Material[]): THREE.Material {
  return Array.isArray(material) ? material[0] : material;
}
