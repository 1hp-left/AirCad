import * as THREE from 'three';
import { loadSolidUnion, SolidGeometryError } from './manifold';

export type ExportFormat = 'stl' | 'obj' | 'glb';

export interface ExportFile {
  blob: Blob;
  filename: string;
  format: ExportFormat;
}

const FILE_DETAILS: Record<ExportFormat, { filename: string; mimeType: string }> = {
  stl: { filename: 'aircad-model.stl', mimeType: 'model/stl' },
  obj: { filename: 'aircad-model.obj', mimeType: 'text/plain' },
  glb: { filename: 'aircad-model.glb', mimeType: 'model/gltf-binary' },
};

export class ModelExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelExportError';
  }
}

/**
 * Snapshot every modeling root, then serialize it without scene helpers such
 * as selection boxes, cursors, lights, or the floor grid. Exporters load only
 * when requested, so they do not increase the editor's startup cost.
 */
export async function createExportFile(
  objects: readonly THREE.Object3D[],
  format: ExportFormat,
): Promise<ExportFile> {
  const model = snapshotModel(objects);
  const details = FILE_DETAILS[format];

  if (format === 'stl') {
    const solidModel = await prepareStlModel(model);
    const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
    const data = new STLExporter().parse(solidModel, { binary: true });
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return {
      blob: new Blob([bytes], { type: details.mimeType }),
      filename: details.filename,
      format,
    };
  }

  if (format === 'obj') {
    const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
    const data = new OBJExporter().parse(model);
    return {
      blob: new Blob([data], { type: details.mimeType }),
      filename: details.filename,
      format,
    };
  }

  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const data = await new GLTFExporter().parseAsync(model, {
    binary: true,
    onlyVisible: false,
  });
  if (!(data instanceof ArrayBuffer)) {
    throw new ModelExportError('The GLB exporter returned an unexpected result.');
  }
  return {
    blob: new Blob([data], { type: details.mimeType }),
    filename: details.filename,
    format,
  };
}

/** Trigger a normal browser download for a previously generated file. */
export function downloadExportFile(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function snapshotModel(objects: readonly THREE.Object3D[]): THREE.Group {
  const model = new THREE.Group();
  model.name = 'AirCad model';

  for (const source of objects) {
    source.updateWorldMatrix(true, true);
    const clone = source.clone(true);
    source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.traverse((child) => {
      child.userData = {};
    });
    model.add(clone);
  }

  model.updateMatrixWorld(true);
  let meshCount = 0;
  model.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });
  if (meshCount === 0) {
    throw new ModelExportError('Create an object before exporting.');
  }
  return model;
}

/** Fuse overlaps into a temporary closed solid; OBJ and GLB stay untouched. */
async function prepareStlModel(model: THREE.Object3D): Promise<THREE.Group> {
  model.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });

  try {
    const union = await loadSolidUnion();
    const geometry = union.union(meshes);
    const solidModel = new THREE.Group();
    solidModel.name = 'AirCad STL model';
    const solid = new THREE.Mesh(geometry);
    solid.name = 'AirCad solid';
    solidModel.add(solid);
    solidModel.updateMatrixWorld(true);
    return solidModel;
  } catch (error) {
    if (error instanceof SolidGeometryError) {
      throw new ModelExportError(error.message);
    }
    throw new ModelExportError('The model could not be prepared as a closed STL solid.');
  }
}
