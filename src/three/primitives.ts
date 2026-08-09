import * as THREE from 'three';

export const PRIMITIVE_TYPES = ['box', 'sphere', 'cylinder', 'torus'] as const;
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

export const PRIMITIVE_LABELS: Record<PrimitiveType, string> = {
  box: 'Box',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  torus: 'Torus',
};

const MATERIAL_OPTIONS: THREE.MeshStandardMaterialParameters = {
  color: 0x9aa6b5,
  roughness: 0.4,
  metalness: 0.15,
};

/** Create a centered, transform-ready modeling primitive. */
export function createPrimitive(type: PrimitiveType): THREE.Mesh {
  const mesh = new THREE.Mesh(
    createGeometry(type),
    new THREE.MeshStandardMaterial(MATERIAL_OPTIONS),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.aircadPrimitive = type;
  return mesh;
}

export function primitiveHalfHeight(mesh: THREE.Mesh): number {
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox;
  return bounds ? Math.max((bounds.max.y - bounds.min.y) / 2, 0.05) : 0.5;
}

export function isPrimitiveType(value: unknown): value is PrimitiveType {
  return typeof value === 'string' && PRIMITIVE_TYPES.includes(value as PrimitiveType);
}

function createGeometry(type: PrimitiveType): THREE.BufferGeometry {
  switch (type) {
    case 'sphere':
      return new THREE.SphereGeometry(0.8, 32, 20);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.72, 0.72, 1.6, 32);
    case 'torus':
      return new THREE.TorusGeometry(0.68, 0.24, 16, 48);
    default:
      return new THREE.BoxGeometry(1.4, 1.4, 1.4);
  }
}
