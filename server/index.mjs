import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = path.resolve(ROOT, 'dist');
const IS_PRODUCTION = process.argv.includes('--production');
const PORT = numberFromEnv(process.env.AIRCAD_PORT || process.env.PORT, 5173, 1, 65_535);
const HOST = process.env.HOST || '0.0.0.0';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1';
const TRANSCRIPTION_MODELS = uniqueStrings([
  process.env.OPENROUTER_TRANSCRIPTION_MODEL || 'qwen/qwen3-asr-flash-2026-02-10',
  process.env.OPENROUTER_TRANSCRIPTION_FALLBACK_MODEL || 'fish-audio/transcribe-1',
]);
const TTS_MODEL = process.env.OPENROUTER_TTS_MODEL || 'fish-audio/s2.1-pro-free:free';
const TTS_VOICE = process.env.OPENROUTER_TTS_VOICE || 'default';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'z-ai/glm-5.2';

const MAX_AUDIO_BASE64_LENGTH = 16_000_000;
const MAX_INSTRUCTION_LENGTH = 1_200;
const MAX_SCENE_OBJECTS = 64;
const MAX_PLAN_ACTIONS = 16;
const AUDIO_FORMATS = new Set(['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac', 'mp4']);
const PRIMITIVES = new Set(['box', 'sphere', 'cylinder', 'torus']);
const ACTION_KINDS = new Set(['create', 'select', 'move', 'rotate', 'scale', 'delete', 'combine']);

const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 220 },
    actions: {
      type: 'array',
      minItems: 0,
      maxItems: MAX_PLAN_ACTIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { enum: [...ACTION_KINDS] },
          target: { type: 'string', minLength: 1, maxLength: 80 },
          targets: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          primitive: { enum: [...PRIMITIVES] },
          position: vectorSchema(-20, 20),
          rotation: vectorSchema(-360, 360),
          scale: vectorSchema(0.05, 10),
        },
      },
    },
  },
};

const MODELING_SYSTEM_PROMPT = `You are AirCad's modeling planner. Convert the user's request into a small declarative scene-edit plan. You never write code and never invent unsupported commands.

Allowed actions:
- create: requires primitive; optional position, rotation, scale.
- select: requires target.
- move: requires target and absolute position.
- rotate: requires target and absolute XYZ Euler rotation in degrees.
- scale: requires target and absolute XYZ scale.
- delete: requires target.
- combine: requires exactly two target names; the solids must overlap before combining.

Targets must be exact names from the supplied scene or the literal "selected". Coordinates are in meters, Y is up, and primitive positions are their centers. Keep objects above the floor unless the user explicitly asks otherwise. Use object sizes to place things beside, above, or touching each other. Prefer the fewest reversible actions that satisfy the request. Never exceed 16 actions. If a request cannot be expressed with these actions, return an empty actions array and explain the limitation in summary.`;

const vite = IS_PRODUCTION
  ? null
  : await import('vite').then(({ createServer }) => createServer({
      root: ROOT,
      appType: 'spa',
      server: { middlewareMode: true },
    }));

const server = createHttpServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname.startsWith('/api/assistant/')) {
      await handleAssistantRequest(request, response, requestUrl.pathname);
      return;
    }

    if (vite) {
      vite.middlewares(request, response, (error) => {
        if (error) sendError(response, error);
      });
      return;
    }

    await serveStatic(response, requestUrl.pathname);
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(PORT, HOST, () => {
  const mode = IS_PRODUCTION ? 'production' : 'development';
  console.log(`AirCad ${mode} server: http://localhost:${PORT}`);
});

async function handleAssistantRequest(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/assistant/status') {
    sendJson(response, 200, {
      ready: Boolean(process.env.OPENROUTER_API_KEY && process.env.NVIDIA_API_KEY),
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
      nvidiaConfigured: Boolean(process.env.NVIDIA_API_KEY),
      models: {
        transcription: TRANSCRIPTION_MODELS[0],
        transcriptionFallback: TRANSCRIPTION_MODELS[1] || null,
        speech: TTS_MODEL,
        planner: NVIDIA_MODEL,
      },
    });
    return;
  }

  if (request.method !== 'POST') {
    throw new HttpError(405, 'Method not allowed.');
  }

  if (pathname === '/api/assistant/transcribe') {
    requireKey('OPENROUTER_API_KEY');
    const body = await readJson(request, MAX_AUDIO_BASE64_LENGTH + 2_000);
    const audioBase64 = stringField(body.audioBase64, 'Audio data', MAX_AUDIO_BASE64_LENGTH);
    const format = stringField(body.format, 'Audio format', 12).toLowerCase();
    if (!AUDIO_FORMATS.has(format)) throw new HttpError(400, 'That audio format is not supported.');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) {
      throw new HttpError(400, 'The recording was not valid base64 audio.');
    }

    const result = await transcribeWithFallback(audioBase64, format);
    sendJson(response, 200, result);
    return;
  }

  if (pathname === '/api/assistant/acknowledge') {
    requireKey('NVIDIA_API_KEY');
    const body = await readJson(request);
    const instruction = instructionField(body.instruction);
    let acknowledgement;
    try {
      const content = await nvidiaChat({
        messages: [
          {
            role: 'system',
            content: 'Acknowledge the modeling instruction in one calm, specific sentence of at most 18 words. Mention the requested object or operation. Do not explain, plan, or use filler. Return only that sentence.',
          },
          { role: 'user', content: instruction },
        ],
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 64,
        chat_template_kwargs: { enable_thinking: false },
      }, { retryWithoutThinking: true });
      acknowledgement = cleanSentence(content, 180);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 402)) throw error;
      acknowledgement = localAcknowledgement(instruction);
    }
    sendJson(response, 200, { acknowledgement });
    return;
  }

  if (pathname === '/api/assistant/plan') {
    requireKey('NVIDIA_API_KEY');
    const body = await readJson(request, 200_000);
    const instruction = instructionField(body.instruction);
    const scene = validateScene(body.scene);
    const messages = [
      { role: 'system', content: MODELING_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Current scene:\n${JSON.stringify(scene)}\n\nModeling request:\n${instruction}`,
      },
    ];

    let content;
    try {
      content = await nvidiaChat({
        messages,
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 2_048,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'aircad_modeling_plan',
            strict: true,
            schema: PLAN_JSON_SCHEMA,
          },
        },
      });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 400) throw error;
      content = await nvidiaChat({
        messages,
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 2_048,
        response_format: { type: 'json_object' },
      });
    }

    const plan = validatePlan(parseJsonContent(content));
    if (plan.actions.length === 0) {
      throw new HttpError(422, plan.summary || 'That request cannot be represented by AirCad actions yet.');
    }
    sendJson(response, 200, { plan });
    return;
  }

  if (pathname === '/api/assistant/speech') {
    requireKey('OPENROUTER_API_KEY');
    const body = await readJson(request);
    const input = stringField(body.input, 'Speech text', 500);
    const providerResponse = await fetch(`${OPENROUTER_URL}/audio/speech`, {
      method: 'POST',
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model: TTS_MODEL,
        input,
        voice: TTS_VOICE,
        response_format: 'mp3',
      }),
    });
    if (!providerResponse.ok) throw await providerHttpError(providerResponse, 'Speech generation failed.');
    const audio = Buffer.from(await providerResponse.arrayBuffer());
    response.writeHead(200, {
      'Content-Type': providerResponse.headers.get('content-type') || 'audio/mpeg',
      'Content-Length': audio.byteLength,
      'Cache-Control': 'no-store',
    });
    response.end(audio);
    return;
  }

  throw new HttpError(404, 'Assistant endpoint not found.');
}

async function transcribeWithFallback(audioBase64, format) {
  let lastError = null;
  for (let index = 0; index < TRANSCRIPTION_MODELS.length; index += 1) {
    const model = TRANSCRIPTION_MODELS[index];
    const providerResponse = await fetch(`${OPENROUTER_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model,
        input_audio: { data: audioBase64, format },
      }),
    });
    if (providerResponse.ok) {
      const data = await providerResponse.json();
      const text = cleanSentence(data.text, MAX_INSTRUCTION_LENGTH);
      if (!text) throw new HttpError(502, 'The transcription came back empty.');
      return { text, model, usage: data.usage || null };
    }

    lastError = await providerHttpError(providerResponse, 'Transcription failed.');
    if (lastError.status === 401 || lastError.status === 402 || index === TRANSCRIPTION_MODELS.length - 1) {
      throw lastError;
    }
  }
  throw lastError || new HttpError(502, 'Transcription failed.');
}

async function nvidiaChat(options, retryOptions = {}) {
  const payload = {
    model: NVIDIA_MODEL,
    stream: false,
    ...options,
  };
  let providerResponse = await fetch(`${NVIDIA_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (
    providerResponse.status === 400 &&
    retryOptions.retryWithoutThinking &&
    payload.chat_template_kwargs
  ) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.chat_template_kwargs;
    providerResponse = await fetch(`${NVIDIA_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fallbackPayload),
    });
  }

  if (!providerResponse.ok) throw await providerHttpError(providerResponse, 'The modeling model failed.');
  const data = await providerResponse.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new HttpError(502, 'The modeling model returned an empty response.');
  }
  return content;
}

function validateScene(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Scene context is missing.');
  }
  if (!Array.isArray(value.objects) || value.objects.length > MAX_SCENE_OBJECTS) {
    throw new HttpError(400, 'Scene context contains too many objects.');
  }
  const objects = value.objects.map((object, index) => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      throw new HttpError(400, `Scene object ${index + 1} is invalid.`);
    }
    return {
      name: stringField(object.name, 'Object name', 80),
      primitive: typeof object.primitive === 'string' ? object.primitive.slice(0, 24) : 'combined',
      position: finiteVector(object.position, -20, 20, 'Object position'),
      rotation: finiteVector(object.rotation, -360, 360, 'Object rotation'),
      scale: finiteVector(object.scale, 0.01, 20, 'Object scale'),
      size: finiteVector(object.size, 0, 40, 'Object size'),
    };
  });
  return {
    selectedName: typeof value.selectedName === 'string' ? value.selectedName.slice(0, 80) : null,
    objects,
  };
}

function validatePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, 'The modeling model did not return a valid plan.');
  }
  const summary = stringField(value.summary, 'Plan summary', 220);
  if (!Array.isArray(value.actions) || value.actions.length > MAX_PLAN_ACTIONS) {
    throw new HttpError(502, 'The modeling plan contains too many actions.');
  }
  const actions = value.actions.map((action, index) => validateAction(action, index));
  return { summary, actions };
}

function validateAction(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, `Modeling action ${index + 1} is invalid.`);
  }
  const kind = stringField(value.kind, 'Action kind', 16);
  if (!ACTION_KINDS.has(kind)) throw new HttpError(502, `Unsupported modeling action: ${kind}.`);

  const action = { kind };
  if (value.target !== undefined) action.target = stringField(value.target, 'Action target', 80);
  if (value.targets !== undefined) {
    if (!Array.isArray(value.targets) || value.targets.length !== 2) {
      throw new HttpError(502, 'Combine requires exactly two targets.');
    }
    action.targets = value.targets.map((target) => stringField(target, 'Combine target', 80));
  }
  if (value.primitive !== undefined) {
    const primitive = stringField(value.primitive, 'Primitive', 16);
    if (!PRIMITIVES.has(primitive)) throw new HttpError(502, `Unsupported primitive: ${primitive}.`);
    action.primitive = primitive;
  }
  if (value.position !== undefined) action.position = finiteVector(value.position, -20, 20, 'Position');
  if (value.rotation !== undefined) action.rotation = finiteVector(value.rotation, -360, 360, 'Rotation');
  if (value.scale !== undefined) action.scale = finiteVector(value.scale, 0.05, 10, 'Scale');

  const needsTarget = ['select', 'move', 'rotate', 'scale', 'delete'].includes(kind);
  if (needsTarget && !action.target) throw new HttpError(502, `${kind} requires a target.`);
  if (kind === 'create' && !action.primitive) throw new HttpError(502, 'Create requires a primitive.');
  if (kind === 'move' && !action.position) throw new HttpError(502, 'Move requires a position.');
  if (kind === 'rotate' && !action.rotation) throw new HttpError(502, 'Rotate requires a rotation.');
  if (kind === 'scale' && !action.scale) throw new HttpError(502, 'Scale requires a scale.');
  if (kind === 'combine' && !action.targets) throw new HttpError(502, 'Combine requires two targets.');
  return action;
}

function parseJsonContent(content) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new HttpError(502, 'The modeling model returned malformed JSON.');
  }
}

function localAcknowledgement(instruction) {
  const normalized = instruction.toLowerCase();
  const primitive = ['box', 'sphere', 'cylinder', 'torus'].find((item) => normalized.includes(item));
  const operation = ['combine', 'delete', 'move', 'rotate', 'scale', 'stretch', 'create', 'add']
    .find((item) => normalized.includes(item));
  if (primitive && operation) return `Got it — I’ll ${operation} the ${primitive}.`;
  if (primitive) return `Got it — I’ll work on the ${primitive}.`;
  if (operation) return `Got it — I’ll ${operation} the requested objects.`;
  return 'Got it — I’ll make that modeling change.';
}

function openRouterHeaders() {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Title': 'AirCad',
  };
}

function requireKey(name) {
  if (!process.env[name]) {
    throw new HttpError(503, `${name} is not configured. Copy .env.example to .env and add the key.`);
  }
}

async function readJson(request, maxBytes = 100_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'The request body must be valid JSON.');
  }
}

async function providerHttpError(response, fallbackMessage) {
  let message = fallbackMessage;
  try {
    const data = await response.json();
    const providerMessage = data?.error?.message || data?.message || data?.detail;
    if (typeof providerMessage === 'string' && providerMessage.trim()) {
      message = providerMessage.trim().slice(0, 300);
    }
  } catch {
    // Provider returned a non-JSON error. Use the safe fallback.
  }
  return new HttpError(response.status || 502, message);
}

function instructionField(value) {
  return stringField(value, 'Instruction', MAX_INSTRUCTION_LENGTH);
}

function stringField(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required.`);
  const text = value.trim();
  if (text.length > maxLength) throw new HttpError(400, `${label} is too long.`);
  return text;
}

function finiteVector(value, min, max, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new HttpError(400, `${label} must contain X, Y, and Z.`);
  return value.map((item) => {
    const number = Number(item);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new HttpError(400, `${label} contains an out-of-range value.`);
    }
    return Math.round(number * 10_000) / 10_000;
  });
}

function cleanSentence(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').slice(0, maxLength);
}

function vectorSchema(minimum, maximum) {
  return {
    type: 'array',
    minItems: 3,
    maxItems: 3,
    items: { type: 'number', minimum, maximum },
  };
}

function numberFromEnv(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function sendError(response, error) {
  if (response.headersSent) {
    response.end();
    return;
  }
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  if (status >= 500 && !(error instanceof HttpError)) console.error(error);
  sendJson(response, status, { error: message });
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const candidate = path.resolve(DIST_DIR, `.${requested}`);
  const safeCandidate = candidate.startsWith(`${DIST_DIR}${path.sep}`) ? candidate : path.join(DIST_DIR, 'index.html');
  const filePath = await isFile(safeCandidate) ? safeCandidate : path.join(DIST_DIR, 'index.html');
  const data = await readFile(filePath);
  response.writeHead(200, {
    'Content-Type': mimeType(filePath),
    'Content-Length': data.byteLength,
    'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  response.end(data);
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function mimeType(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  }[path.extname(filePath)] || 'application/octet-stream';
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
