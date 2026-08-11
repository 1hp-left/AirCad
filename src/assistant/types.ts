import type { PrimitiveType } from '../three/primitives';

export type VectorTuple = [number, number, number];
export type AssistantPhase =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'acknowledging'
  | 'speaking'
  | 'planning'
  | 'applying'
  | 'complete'
  | 'error';

export interface SceneContextObject {
  name: string;
  primitive: string;
  position: VectorTuple;
  rotation: VectorTuple;
  scale: VectorTuple;
  size: VectorTuple;
}

export interface SceneContext {
  selectedName: string | null;
  objects: SceneContextObject[];
}

export interface ModelingAction {
  kind: 'create' | 'select' | 'move' | 'rotate' | 'scale' | 'delete' | 'combine';
  target?: string;
  targets?: [string, string];
  primitive?: PrimitiveType;
  position?: VectorTuple;
  rotation?: VectorTuple;
  scale?: VectorTuple;
}

export interface ModelingPlan {
  summary: string;
  actions: ModelingAction[];
}

export interface ApplyPlanResult {
  summary: string;
  details: string[];
  actionCount: number;
}

export interface AssistantEntry {
  id: number;
  kind: 'user' | 'acknowledgement' | 'result' | 'error';
  text: string;
  meta?: string;
}

export interface AssistantConfig {
  ready: boolean;
  openRouterConfigured: boolean;
  nvidiaConfigured: boolean;
  models: {
    transcription: string;
    transcriptionFallback: string | null;
    speech: string;
    planner: string;
  };
}
