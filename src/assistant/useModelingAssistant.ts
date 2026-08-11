import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAssistantConfig,
  requestAcknowledgement,
  requestModelingPlan,
  requestSpeech,
  transcribeRecording,
} from './api';
import type {
  ApplyPlanResult,
  AssistantConfig,
  AssistantEntry,
  AssistantPhase,
  ModelingPlan,
  SceneContext,
} from './types';

interface UseModelingAssistantOptions {
  getSceneContext: () => SceneContext | null;
  applyPlan: (plan: ModelingPlan) => Promise<ApplyPlanResult>;
}

export interface ModelingAssistantController {
  phase: AssistantPhase;
  entries: readonly AssistantEntry[];
  config: AssistantConfig | null;
  error: string | null;
  voiceNotice: string | null;
  isBusy: boolean;
  isRecording: boolean;
  submitText: (instruction: string) => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  toggleRecording: () => void;
  cancel: () => void;
  retry: () => void;
  clearConversation: () => void;
}

const RECORDING_LIMIT_MS = 30_000;
const BUSY_PHASES = new Set<AssistantPhase>([
  'recording',
  'transcribing',
  'acknowledging',
  'speaking',
  'planning',
  'applying',
]);

export function useModelingAssistant({
  getSceneContext,
  applyPlan,
}: UseModelingAssistantOptions): ModelingAssistantController {
  const [phase, setPhase] = useState<AssistantPhase>('idle');
  const [entries, setEntries] = useState<AssistantEntry[]>([]);
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const entryIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingCanceledRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const lastRequestRef = useRef<{ instruction: string; spoken: boolean } | null>(null);

  const appendEntry = useCallback((entry: Omit<AssistantEntry, 'id'>) => {
    setEntries((current) => [...current, { ...entry, id: ++entryIdRef.current }].slice(-30));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getAssistantConfig(controller.signal)
      .then(setConfig)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setConfig(null);
          setError(messageFor(reason));
        }
      });
    return () => controller.abort();
  }, []);

  const cleanupRecording = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    recorderRef.current = null;
  }, []);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }, []);

  const playSpeech = useCallback(async (text: string, signal: AbortSignal): Promise<boolean> => {
    try {
      const audioBlob = await requestSpeech(text, signal);
      if (signal.aborted) return false;
      stopAudio();
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.addEventListener('ended', () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          audioUrlRef.current = null;
          URL.revokeObjectURL(url);
        }
      }, { once: true });
      await audio.play();
      return true;
    } catch (reason) {
      if (!signal.aborted) {
        setVoiceNotice(`Speech unavailable — continuing silently. ${messageFor(reason)}`);
      }
      return false;
    }
  }, [stopAudio]);

  const executeInstruction = useCallback(async (
    instruction: string,
    spoken: boolean,
    controller: AbortController,
  ) => {
    stopAudio();
    lastRequestRef.current = { instruction, spoken };
    setError(null);
    setVoiceNotice(null);
    appendEntry({ kind: 'user', text: instruction, meta: spoken ? 'Voice' : 'Typed' });

    try {
      if (spoken) {
        setPhase('acknowledging');
        const acknowledgement = await requestAcknowledgement(instruction, controller.signal);
        appendEntry({ kind: 'acknowledgement', text: acknowledgement, meta: 'Acknowledged' });
        setPhase('speaking');
        await playSpeech(acknowledgement, controller.signal);
      }

      if (controller.signal.aborted) return;
      const scene = getSceneContext();
      if (!scene) throw new Error('The 3D scene is not ready yet.');
      setPhase('planning');
      const plan = await requestModelingPlan(instruction, scene, controller.signal);
      if (controller.signal.aborted) return;

      setPhase('applying');
      const result = await applyPlan(plan);
      const detail = result.details.join(' · ');
      appendEntry({
        kind: 'result',
        text: detail || result.summary,
        meta: `${result.actionCount} action${result.actionCount === 1 ? '' : 's'} applied`,
      });
      setPhase('complete');

      if (spoken) {
        const spokenResult = result.actionCount === 1
          ? `Done. ${result.details[0] || result.summary}`
          : `Done. I applied ${result.actionCount} modeling actions.`;
        void playSpeech(spokenResult, controller.signal);
      }
    } catch (reason) {
      if (controller.signal.aborted) {
        setPhase('idle');
        return;
      }
      const message = messageFor(reason);
      setError(message);
      setPhase('error');
      appendEntry({ kind: 'error', text: message, meta: 'Not applied' });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [appendEntry, applyPlan, getSceneContext, playSpeech, stopAudio]);

  const submitText = useCallback(async (instruction: string) => {
    const normalized = instruction.trim();
    if (!normalized || BUSY_PHASES.has(phase)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    await executeInstruction(normalized, false, controller);
  }, [executeInstruction, phase]);

  const processRecording = useCallback(async (recording: Blob) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase('transcribing');
    try {
      const transcription = await transcribeRecording(recording, controller.signal);
      if (controller.signal.aborted) return;
      await executeInstruction(transcription.text, true, controller);
    } catch (reason) {
      if (controller.signal.aborted) {
        setPhase('idle');
        return;
      }
      const message = messageFor(reason);
      setError(message);
      setPhase('error');
      appendEntry({ kind: 'error', text: message, meta: 'Voice input failed' });
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [appendEntry, executeInstruction]);

  const startRecording = useCallback(async () => {
    if (BUSY_PHASES.has(phase)) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser does not support microphone recording.');
      setPhase('error');
      return;
    }
    if (config?.ready !== true) {
      setError('OpenRouter and NVIDIA must both be configured before using voice control.');
      setPhase('error');
      return;
    }

    try {
      stopAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = preferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recordingCanceledRef.current = false;
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const canceled = recordingCanceledRef.current;
        const recording = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        cleanupRecording();
        if (canceled) return;
        if (recording.size < 200) {
          setError('The recording was too short. Try speaking for a little longer.');
          setPhase('error');
          return;
        }
        void processRecording(recording);
      }, { once: true });
      recorder.start(250);
      setError(null);
      setVoiceNotice(null);
      setPhase('recording');
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, RECORDING_LIMIT_MS);
    } catch (reason) {
      cleanupRecording();
      setError(reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in the browser and try again.'
        : messageFor(reason));
      setPhase('error');
    }
  }, [cleanupRecording, config, phase, processRecording, stopAudio]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    setPhase('transcribing');
    recorder.stop();
  }, []);

  const toggleRecording = useCallback(() => {
    if (phase === 'recording') stopRecording();
    else void startRecording();
  }, [phase, startRecording, stopRecording]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    recordingCanceledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    else cleanupRecording();
    stopAudio();
    setPhase('idle');
    setError(null);
    setVoiceNotice('Canceled.');
  }, [cleanupRecording, stopAudio]);

  const retry = useCallback(() => {
    const last = lastRequestRef.current;
    if (!last || BUSY_PHASES.has(phase)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    void executeInstruction(last.instruction, last.spoken, controller);
  }, [executeInstruction, phase]);

  const clearConversation = useCallback(() => {
    if (BUSY_PHASES.has(phase)) return;
    setEntries([]);
    setError(null);
    setVoiceNotice(null);
    setPhase('idle');
  }, [phase]);

  useEffect(() => () => {
    abortRef.current?.abort();
    recordingCanceledRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    cleanupRecording();
    stopAudio();
  }, [cleanupRecording, stopAudio]);

  return useMemo(() => ({
    phase,
    entries,
    config,
    error,
    voiceNotice,
    isBusy: BUSY_PHASES.has(phase),
    isRecording: phase === 'recording',
    submitText,
    startRecording,
    stopRecording,
    toggleRecording,
    cancel,
    retry,
    clearConversation,
  }), [
    cancel,
    clearConversation,
    config,
    entries,
    error,
    phase,
    retry,
    startRecording,
    stopRecording,
    submitText,
    toggleRecording,
    voiceNotice,
  ]);
}

function preferredRecordingMimeType(): string | undefined {
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type));
}

function messageFor(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message.trim();
  return 'The assistant could not complete that request.';
}
