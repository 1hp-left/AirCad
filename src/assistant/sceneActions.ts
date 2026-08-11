import * as THREE from 'three';
import type { ApplyPlanResult, ModelingPlan, SceneContext, VectorTuple } from './types';
import { createPrimitive, primitiveHalfHeight, type PrimitiveType } from '../three/primitives';
import type { SceneManager } from '../three/SceneManager';
import { CombineAction, type CombineFailureReason } from '../three/actions/CombineAction';

export function buildSceneContext(manager: SceneManager): SceneContext {
  const bounds = new THREE.Box3();
  const size = new THREE.Vector3();
  return {
    selectedName: manager.objectStore.selected?.name ?? null,
    objects: manager.objectStore.objects.map((object) => {
      bounds.setFromObject(object).getSize(size);
      return {
        name: object.name || 'Object',
        primitive: typeof object.userData.aircadPrimitive === 'string'
          ? object.userData.aircadPrimitive
          : 'combined',
        position: tuple(object.position.x, object.position.y, object.position.z),
        rotation: tuple(
          THREE.MathUtils.radToDeg(object.rotation.x),
          THREE.MathUtils.radToDeg(object.rotation.y),
          THREE.MathUtils.radToDeg(object.rotation.z),
        ),
        scale: tuple(object.scale.x, object.scale.y, object.scale.z),
        size: tuple(size.x, size.y, size.z),
      };
    }),
  };
}

export async function applyModelingPlan(
  manager: SceneManager,
  plan: ModelingPlan,
): Promise<ApplyPlanResult> {
  const details: string[] = [];
  const combineAction = new CombineAction();

  for (const action of plan.actions) {
    switch (action.kind) {
      case 'create': {
        const primitive = requiredPrimitive(action.primitive);
        const object = createPrimitive(primitive);
        applyScale(object, action.scale ?? [1, 1, 1]);
        applyRotation(object, action.rotation ?? [0, 0, 0]);
        if (action.position) applyPosition(object, action.position);
        else object.position.set(0, primitiveHalfHeight(object) * object.scale.y, 0);
        manager.objectStore.add(object);
        manager.objectStore.select(object);
        details.push(`Created ${object.name}`);
        break;
      }
      case 'select': {
        const object = resolveTarget(manager, action.target);
        manager.objectStore.select(object);
        details.push(`Selected ${object.name}`);
        break;
      }
      case 'move': {
        const object = resolveTarget(manager, action.target);
        applyPosition(object, requiredVector(action.position, 'move position'));
        manager.objectStore.select(object);
        details.push(`Moved ${object.name}`);
        break;
      }
      case 'rotate': {
        const object = resolveTarget(manager, action.target);
        applyRotation(object, requiredVector(action.rotation, 'rotation'));
        manager.objectStore.select(object);
        details.push(`Rotated ${object.name}`);
        break;
      }
      case 'scale': {
        const object = resolveTarget(manager, action.target);
        applyScale(object, requiredVector(action.scale, 'scale'));
        manager.objectStore.select(object);
        details.push(`Scaled ${object.name}`);
        break;
      }
      case 'delete': {
        const object = resolveTarget(manager, action.target);
        const name = object.name || 'Object';
        manager.objectStore.remove(object);
        details.push(`Deleted ${name}`);
        break;
      }
      case 'combine': {
        const targets = action.targets;
        if (!targets) throw new Error('Combine requires two object names.');
        const first = resolveTarget(manager, targets[0]);
        const second = resolveTarget(manager, targets[1]);
        const result = await combineAction.executeWhenReady(first, second, manager.objectStore);
        if (!result.ok) throw new Error(combineFailureMessage(result.reason));
        details.push(`Combined ${result.sourceNames[0]} and ${result.sourceNames[1]}`);
        break;
      }
    }
    manager.objectStore.updateSelectionOutline();
  }

  return {
    summary: plan.summary,
    details,
    actionCount: plan.actions.length,
  };
}

export function addPrimitiveAtWorkbench(manager: SceneManager, primitive: PrimitiveType): THREE.Mesh {
  const object = createPrimitive(primitive);
  const selected = manager.objectStore.selected;
  object.position.set(
    selected ? selected.position.x + 1.8 : 0,
    primitiveHalfHeight(object),
    selected?.position.z ?? 0,
  );
  manager.objectStore.add(object);
  manager.objectStore.select(object);
  return object;
}

function resolveTarget(manager: SceneManager, target: string | undefined): THREE.Object3D {
  if (!target) throw new Error('The modeling action is missing its target.');
  if (target.toLowerCase() === 'selected') {
    const selected = manager.objectStore.selected;
    if (!selected) throw new Error('No object is selected.');
    return selected;
  }
  const normalized = target.trim().toLowerCase();
  const object = manager.objectStore.objects.find((candidate) => candidate.name.toLowerCase() === normalized);
  if (!object) throw new Error(`Could not find ${target} in the scene.`);
  return object;
}

function applyPosition(object: THREE.Object3D, value: VectorTuple): void {
  object.position.set(...value);
  object.updateMatrixWorld(true);
}

function applyRotation(object: THREE.Object3D, value: VectorTuple): void {
  object.rotation.set(...value.map(THREE.MathUtils.degToRad) as VectorTuple);
  object.updateMatrixWorld(true);
}

function applyScale(object: THREE.Object3D, value: VectorTuple): void {
  object.scale.set(...value);
  object.updateMatrixWorld(true);
}

function requiredVector(value: VectorTuple | undefined, label: string): VectorTuple {
  if (!value) throw new Error(`The modeling action is missing its ${label}.`);
  return value;
}

function requiredPrimitive(value: PrimitiveType | undefined): PrimitiveType {
  if (!value) throw new Error('The create action is missing its primitive.');
  return value;
}

function combineFailureMessage(reason: CombineFailureReason): string {
  switch (reason) {
    case 'not-overlapping':
      return 'The requested objects do not overlap, so they cannot be combined.';
    case 'invalid-object':
      return 'Only two valid modeling objects can be combined.';
    case 'empty-result':
      return 'The combine operation did not produce a closed solid.';
    default:
      return 'The objects could not be combined.';
  }
}

function tuple(x: number, y: number, z: number): VectorTuple {
  return [round(x), round(y), round(z)];
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
