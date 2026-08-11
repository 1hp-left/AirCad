import type { AssistantConfig, ModelingPlan, SceneContext, VectorTuple } from './types';

const PRIMITIVES = new Set(['box', 'sphere', 'cylinder', 'torus']);
const ACTIONS = new Set(['create', 'select', 'move', 'rotate', 'scale', 'delete', 'combine']);

export async function getAssistantConfig(signal?: AbortSignal): Promise<AssistantConfig> {
  return requestJson('/api/assistant/status', { signal });
}

export async function transcribeRecording(
  recording: Blob,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  const audioBase64 = await blobToBase64(recording);
  return requestJson('/api/assistant/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64,
      format: audioFormat(recording.type),
    }),
    signal,
  });
}

export async function requestAcknowledgement(
  instruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await requestJson<{ acknowledgement: string }>('/api/assistant/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
    signal,
  });
  return result.acknowledgement;
}

export async function requestModelingPlan(
  instruction: string,
  scene: SceneContext,
  signal?: AbortSignal,
): Promise<ModelingPlan> {
  const result = await requestJson<{ plan: unknown }>('/api/assistant/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, scene }),
    signal,
  });
  return validateModelingPlan(result.plan);
}

export async function requestSpeech(text: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/assistant/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text }),
    signal,
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.blob();
}

function validateModelingPlan(value: unknown): ModelingPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The modeling model returned an invalid plan.');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.summary !== 'string' || !Array.isArray(candidate.actions)) {
    throw new Error('The modeling plan is missing its summary or actions.');
  }
  if (candidate.actions.length === 0 || candidate.actions.length > 16) {
    throw new Error('The modeling plan has an invalid number of actions.');
  }

  const actions = candidate.actions.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Modeling action ${index + 1} is invalid.`);
    }
    const action = value as Record<string, unknown>;
    if (typeof action.kind !== 'string' || !ACTIONS.has(action.kind)) {
      throw new Error(`Modeling action ${index + 1} is unsupported.`);
    }
    const result = { kind: action.kind } as ModelingPlan['actions'][number];
    if (typeof action.target === 'string') result.target = action.target;
    if (Array.isArray(action.targets) && action.targets.length === 2 && action.targets.every((item) => typeof item === 'string')) {
      result.targets = [action.targets[0], action.targets[1]] as [string, string];
    }
    if (typeof action.primitive === 'string' && PRIMITIVES.has(action.primitive)) {
      result.primitive = action.primitive as ModelingPlan['actions'][number]['primitive'];
    }
    if (action.position !== undefined) result.position = vector(action.position, -20, 20, 'position');
    if (action.rotation !== undefined) result.rotation = vector(action.rotation, -360, 360, 'rotation');
    if (action.scale !== undefined) result.scale = vector(action.scale, 0.05, 10, 'scale');
    return result;
  });

  return { summary: candidate.summary.trim().slice(0, 220), actions };
}

function vector(value: unknown, min: number, max: number, label: string): VectorTuple {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`The plan contains an invalid ${label}.`);
  const result = value.map(Number);
  if (result.some((item) => !Number.isFinite(item) || item < min || item > max)) {
    throw new Error(`The plan contains an out-of-range ${label}.`);
  }
  return result as VectorTuple;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<T>;
}

async function responseError(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: unknown };
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
  } catch {
    // Non-JSON provider error; use the status fallback.
  }
  return `Assistant request failed (${response.status}).`;
}

function audioFormat(mimeType: string): string {
  const normalized = mimeType.split(';')[0].toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  return 'webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not encode the recording.'));
        return;
      }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
