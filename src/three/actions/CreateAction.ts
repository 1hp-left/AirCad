import * as THREE from 'three';
import { palmCenter } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';
import type { ObjectStore } from '../ObjectStore';
import { createPrimitive, primitiveHalfHeight, type PrimitiveType } from '../primitives';
import { rayFromNormalizedPoint } from '../selection';

const PLACEMENT_CENTER = new THREE.Vector3(0, 1, 0);
const FALLBACK_DEPTH = 10;
const PLACEMENT_LIMIT = 8;

/** One-shot Open Palm action that creates and selects the chosen primitive. */
export class CreateAction {
  private readonly raycaster = new THREE.Raycaster();
  private readonly placementPlane = new THREE.Plane();
  private readonly viewDirection = new THREE.Vector3();
  private readonly position = new THREE.Vector3();

  execute(
    type: PrimitiveType,
    hand: HandResult,
    camera: THREE.Camera,
    store: ObjectStore,
  ): THREE.Mesh {
    const mesh = createPrimitive(type);
    const ray = rayFromNormalizedPoint(palmCenter(hand), camera, this.raycaster);

    camera.getWorldDirection(this.viewDirection);
    this.placementPlane.setFromNormalAndCoplanarPoint(this.viewDirection, PLACEMENT_CENTER);
    if (!ray.intersectPlane(this.placementPlane, this.position)) {
      ray.at(FALLBACK_DEPTH, this.position);
    }

    const halfHeight = primitiveHalfHeight(mesh);
    this.position.set(
      THREE.MathUtils.clamp(this.position.x, -PLACEMENT_LIMIT, PLACEMENT_LIMIT),
      THREE.MathUtils.clamp(this.position.y, halfHeight, PLACEMENT_LIMIT),
      THREE.MathUtils.clamp(this.position.z, -PLACEMENT_LIMIT, PLACEMENT_LIMIT),
    );
    mesh.position.copy(this.position);
    store.add(mesh);
    store.select(mesh);
    return mesh;
  }
}
