import * as THREE from 'three';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import type {
  Manifold as ManifoldSolid,
  ManifoldToplevel,
} from 'manifold-3d';

export type SolidGeometryFailure =
  | 'invalid-input'
  | 'empty-result'
  | 'operation-failed';

export class SolidGeometryError extends Error {
  constructor(
    message: string,
    readonly reason: SolidGeometryFailure,
  ) {
    super(message);
    this.name = 'SolidGeometryError';
  }
}

let runtimePromise: Promise<ManifoldToplevel> | null = null;

/** Load and initialize the WASM geometry engine once, on first use. */
export function loadSolidUnion(): Promise<SolidUnion> {
  runtimePromise ??= import('manifold-3d')
    .then(({ default: createModule }) => createModule({ locateFile: () => manifoldWasmUrl }))
    .then((runtime) => {
      runtime.setup();
      return runtime;
    });

  return runtimePromise.then((runtime) => new SolidUnion(runtime));
}

/** Convert Three.js meshes to closed solids and return their Boolean union. */
export class SolidUnion {
  constructor(private readonly runtime: ManifoldToplevel) {}

  union(meshes: readonly THREE.Mesh[]): THREE.BufferGeometry {
    if (meshes.length === 0) {
      throw new SolidGeometryError('Create an object before exporting.', 'invalid-input');
    }

    const solids: ManifoldSolid[] = [];
    let result: ManifoldSolid | null = null;
    let ownsResult = false;

    try {
      for (const mesh of meshes) solids.push(this.toSolid(mesh));

      if (solids.length === 1) {
        result = solids[0];
      } else {
        result = this.runtime.Manifold.union(solids);
        ownsResult = true;
      }

      const status = result.status();
      if (status !== 'NoError') {
        throw new SolidGeometryError(
          `The objects could not be joined into a closed solid (${status}).`,
          'operation-failed',
        );
      }
      if (result.isEmpty() || result.numTri() === 0 || result.volume() <= 0) {
        throw new SolidGeometryError(
          'The objects do not enclose a solid volume.',
          'empty-result',
        );
      }

      return geometryFromSolid(result);
    } catch (error) {
      if (error instanceof SolidGeometryError) throw error;
      throw new SolidGeometryError(
        'The objects could not be joined into a closed solid.',
        'operation-failed',
      );
    } finally {
      if (ownsResult) result?.delete();
      for (const solid of solids) solid.delete();
    }
  }

  private toSolid(mesh: THREE.Mesh): ManifoldSolid {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const totalElements = index?.count ?? position?.count ?? 0;
    const objectName = mesh.name || 'An object';

    if (!position || position.itemSize < 3 || totalElements < 3) {
      throw new SolidGeometryError(
        `${objectName} does not contain valid triangles.`,
        'invalid-input',
      );
    }

    const drawStart = Math.min(
      Math.max(Math.floor(geometry.drawRange.start), 0),
      totalElements,
    );
    const requestedCount = Number.isFinite(geometry.drawRange.count)
      ? Math.max(Math.floor(geometry.drawRange.count), 0)
      : totalElements - drawStart;
    const elementCount = Math.min(requestedCount, totalElements - drawStart);
    if (elementCount < 3 || elementCount % 3 !== 0) {
      throw new SolidGeometryError(
        `${objectName} does not contain complete triangles.`,
        'invalid-input',
      );
    }

    mesh.updateWorldMatrix(true, false);
    const reverseWinding = mesh.matrixWorld.determinant() < 0;
    const sourceToOutput = new Map<number, number>();
    const vertices: number[] = [];
    const triangles = new Uint32Array(elementCount);
    const point = new THREE.Vector3();

    const outputIndexFor = (elementOffset: number): number => {
      const sourceIndex = index?.getX(drawStart + elementOffset) ?? drawStart + elementOffset;
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= position.count) {
        throw new SolidGeometryError(
          `${objectName} contains an invalid triangle index.`,
          'invalid-input',
        );
      }

      const existing = sourceToOutput.get(sourceIndex);
      if (existing !== undefined) return existing;

      point.fromBufferAttribute(position, sourceIndex).applyMatrix4(mesh.matrixWorld);
      if (![point.x, point.y, point.z].every(Number.isFinite)) {
        throw new SolidGeometryError(
          `${objectName} contains invalid vertex coordinates.`,
          'invalid-input',
        );
      }

      const outputIndex = vertices.length / 3;
      sourceToOutput.set(sourceIndex, outputIndex);
      vertices.push(point.x, point.y, point.z);
      return outputIndex;
    };

    for (let offset = 0; offset < elementCount; offset += 3) {
      const a = outputIndexFor(offset);
      const b = outputIndexFor(offset + 1);
      const c = outputIndexFor(offset + 2);
      triangles[offset] = a;
      triangles[offset + 1] = reverseWinding ? c : b;
      triangles[offset + 2] = reverseWinding ? b : c;
    }

    const manifoldMesh = new this.runtime.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices),
      triVerts: triangles,
    });
    // Three.js primitives duplicate vertices at UV and normal seams. Restore
    // their shared topological edges before asking Manifold to validate them.
    manifoldMesh.merge();

    let solid: ManifoldSolid;
    try {
      solid = new this.runtime.Manifold(manifoldMesh);
    } catch {
      throw new SolidGeometryError(
        `${objectName} is not a closed solid.`,
        'invalid-input',
      );
    }

    const status = solid.status();
    if (status !== 'NoError') {
      solid.delete();
      throw new SolidGeometryError(
        `${objectName} is not a closed solid (${status}).`,
        'invalid-input',
      );
    }
    if (solid.isEmpty() || solid.numTri() === 0 || solid.volume() <= 0) {
      solid.delete();
      throw new SolidGeometryError(
        `${objectName} does not enclose a solid volume.`,
        'invalid-input',
      );
    }
    return solid;
  }
}

function geometryFromSolid(solid: ManifoldSolid): THREE.BufferGeometry {
  const mesh = solid.getMesh();
  const positions = new Float32Array(mesh.numVert * 3);

  for (let vertex = 0; vertex < mesh.numVert; vertex += 1) {
    const sourceOffset = vertex * mesh.numProp;
    const targetOffset = vertex * 3;
    positions[targetOffset] = mesh.vertProperties[sourceOffset];
    positions[targetOffset + 1] = mesh.vertProperties[sourceOffset + 1];
    positions[targetOffset + 2] = mesh.vertProperties[sourceOffset + 2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
