import * as THREE from 'three';
import type { Vec3 } from '../gesture/landmarkUtils';

/** Convert MediaPipe normalized coordinates to the scene's NDC coordinates. */
export function normalizedToNdc(point: Pick<Vec3, 'x' | 'y'>): THREE.Vector2 {
  // The webcam preview is mirrored with CSS; mirror x before raycasting into
  // the unmirrored Three.js canvas so the visible hand and ray agree.
  const mirroredX = 1 - THREE.MathUtils.clamp(point.x, 0, 1);
  const y = THREE.MathUtils.clamp(point.y, 0, 1);
  return new THREE.Vector2(mirroredX * 2 - 1, 1 - y * 2);
}

/** Convert a browser client coordinate to unmirrored canvas NDC. */
export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): THREE.Vector2 {
  const x = THREE.MathUtils.clamp((clientX - rect.left) / rect.width, 0, 1);
  const y = THREE.MathUtils.clamp((clientY - rect.top) / rect.height, 0, 1);
  return new THREE.Vector2(x * 2 - 1, 1 - y * 2);
}

function intersectSelectable(
  raycaster: THREE.Raycaster,
  objects: THREE.Group,
): { object: THREE.Object3D; point: THREE.Vector3 } | null {
  const candidates = objects.children.filter(
    (object) => object.userData.aircadSelectable !== false,
  );

  for (const hit of raycaster.intersectObjects(candidates, true)) {
    const root = selectableRoot(hit.object, objects);
    if (root) return { object: root, point: hit.point.clone() };
  }
  return null;
}

/** Raycast selectable modeling objects from an unmirrored NDC point. */
export function raycastSelectableAtNdc(
  ndc: THREE.Vector2,
  camera: THREE.Camera,
  objects: THREE.Group,
  raycaster = new THREE.Raycaster(),
): { ray: THREE.Ray; object: THREE.Object3D; point: THREE.Vector3 } | null {
  raycaster.setFromCamera(ndc, camera);
  const hit = intersectSelectable(raycaster, objects);
  return hit ? { ray: raycaster.ray.clone(), ...hit } : null;
}

/** Build a world-space ray from a normalized webcam point. */
export function rayFromNormalizedPoint(
  point: Pick<Vec3, 'x' | 'y'>,
  camera: THREE.Camera,
  raycaster = new THREE.Raycaster(),
): THREE.Ray {
  raycaster.setFromCamera(normalizedToNdc(point), camera);
  return raycaster.ray.clone();
}

/**
 * Return the closest modeling hit under a normalized screen point.
 *
 * The raw intersection is useful to the gesture cursor because it gives us the
 * exact 3D point where the visible pointing ray meets an object.
 */
export function raycastSelectableAtNormalizedPoint(
  point: Pick<Vec3, 'x' | 'y'>,
  camera: THREE.Camera,
  objects: THREE.Group,
  raycaster = new THREE.Raycaster(),
): { ray: THREE.Ray; object: THREE.Object3D; point: THREE.Vector3 } | null {
  raycaster.setFromCamera(normalizedToNdc(point), camera);
  const hit = intersectSelectable(raycaster, objects);
  return hit ? { ray: raycaster.ray.clone(), ...hit } : null;
}

/** Return the closest selectable object under a normalized screen point. */
export function selectObjectAtNormalizedPoint(
  point: Pick<Vec3, 'x' | 'y'>,
  camera: THREE.Camera,
  objects: THREE.Group,
  raycaster = new THREE.Raycaster(),
): THREE.Object3D | null {
  return raycastSelectableAtNormalizedPoint(point, camera, objects, raycaster)?.object ?? null;
}

/** Return a point some distance along a ray when it misses every object. */
export function rayEndpoint(ray: THREE.Ray, distance: number): THREE.Vector3 {
  return ray.origin.clone().addScaledVector(ray.direction, distance);
}

/** Build the same ray used for selection, for cursor visualization. */
export function selectionRayAtNormalizedPoint(
  point: Pick<Vec3, 'x' | 'y'>,
  camera: THREE.Camera,
): THREE.Ray {
  return rayFromNormalizedPoint(point, camera);
}

function selectableRoot(object: THREE.Object3D, group: THREE.Group): THREE.Object3D | null {
  let root = object;
  while (root.parent && root.parent !== group) root = root.parent;
  if (root.parent !== group || root.userData.aircadSelectable === false) return null;
  return root;
}
