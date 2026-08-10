import type { GestureRecognizer, GestureRecognizerResult } from '@mediapipe/tasks-vision';
import type {
  GestureFrame,
  GestureListener,
  HandResult,
  GestureEngineStatus,
} from './types';
import { OneEuroFilter } from './OneEuroFilter';
import { isPinchClosed, pinchStrength } from './landmarkUtils';
import { Gesture } from './gestures';
import { LANDMARK } from './types';

/**
 * GestureEngine is the bridge between the webcam <video> and the rest of the
 * app. It owns the MediaPipe GestureRecognizer and a requestAnimationFrame loop
 * that:
 *   1. feeds each new video frame to `recognizeForVideo()`,
 *   2. smooths the returned landmarks with a per-scalar 1-Euro filter, and
 *   3. emits a typed GestureFrame to every subscribed listener.
 *
 * The scene side (SceneManager / SceneController) subscribes via `on()` and
 * reads gesture state on the hot path without going through React. React only
 * subscribes through `useGestureEngine` to drive HUD labels.
 *
 * Singleton by construction: App mounts one <video>, creates one engine.
 */
export class GestureEngine {
  status: GestureEngineStatus = 'idle';
  private recognizer: GestureRecognizer | null = null;
  private video: HTMLVideoElement | null = null;
  private rafId = 0;
  private lastVideoTime = -1;
  private disposed = false;
  private readonly listeners = new Set<GestureListener>();
  private readonly statusListeners = new Set<(s: GestureEngineStatus) => void>();

  // Keying filters by handedness prevents two hands from inheriting each
  // other's history when MediaPipe changes result order between frames.
  private readonly filters = new Map<string, OneEuroFilter[][]>();
  private readonly pinchStates = new Map<string, boolean>();
  private readonly trackerLastSeen = new Map<string, number>();
  constructor(private readonly modelPath = '/models/gesture_recognizer.task') {}

  // ---------------------------------------------------------------- public API

  /** Subscribe to per-frame gesture data. Returns an unsubscribe fn. */
  on(listener: GestureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to engine status changes (for HUD / fallback UI). */
  onStatus(listener: (s: GestureEngineStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status); // immediate push of current state
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(s: GestureEngineStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  /**
   * Initialize the recognizer and attach to a <video> element that is already
   * streaming from getUserMedia. Resolves once the recognizer is ready; the
   * rAF loop starts and frames begin emitting.
   */
  async init(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.setStatus('loading');
    try {
      const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
      if (this.disposed) return;
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
      );
      if (this.disposed) return;
      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: this.modelPath },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      if (this.disposed) {
        recognizer.close();
        return;
      }
      this.recognizer = recognizer;
      this.setStatus('running');
      this.startLoop();
    } catch (err) {
      if (this.disposed) return;
      console.error('[GestureEngine] init failed:', err);
      this.setStatus('error');
      throw err;
    }
  }

  private startLoop(): void {
    if (this.rafId || this.disposed) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.tick();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Stop emitting and release the recognizer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.recognizer?.close();
    this.recognizer = null;
    this.video = null;
    this.filters.clear();
    this.pinchStates.clear();
    this.trackerLastSeen.clear();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  // ---------------------------------------------------------------- internals

  private tick(): void {
    if (this.disposed) return;
    const video = this.video;
    const recognizer = this.recognizer;
    if (!video || !recognizer) return;
    if (video.readyState < 2) return; // not enough data yet

    // Only run recognition on genuinely new frames — MediaPipe warns if the
    // same timestamp is passed twice.
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const timestampMs = performance.now();

    let raw: GestureRecognizerResult;
    try {
      raw = recognizer.recognizeForVideo(video, timestampMs);
    } catch {
      return; // transient — next frame retries
    }

    const frame: GestureFrame = {
      hands: this.decode(raw, timestampMs / 1000),
      timestampMs,
    };
    this.listeners.forEach((l) => l(frame));
  }

  /** Decode MediaPipe's result object into our HandResult[] + smooth landmarks. */
  private decode(raw: GestureRecognizerResult, timeS: number): HandResult[] {
    const nHands = raw.landmarks?.length ?? 0;
    const hands: HandResult[] = [];
    const handednessCounts = new Map<string, number>();
    for (let h = 0; h < nHands; h++) {
      const rawLandmarks = raw.landmarks[h];
      const worldLandmarks = raw.worldLandmarks[h] ?? rawLandmarks;
      const handedness = raw.handednesses[h]?.[0]?.categoryName ?? 'Unknown';
      const occurrence = handednessCounts.get(handedness) ?? 0;
      handednessCounts.set(handedness, occurrence + 1);
      const trackingKey = `${handedness}:${occurrence}`;
      this.trackerLastSeen.set(trackingKey, timeS);

      const landmarks = this.smoothLandmarks(trackingKey, rawLandmarks, timeS);
      const top = raw.gestures[h]?.[0];
      const hand: HandResult = {
        handedness,
        gesture: top?.categoryName ?? Gesture.NONE,
        score: top?.score ?? 0,
        pinching: false,
        pinchStrength: 0,
        landmarks,
        worldLandmarks, // world landmarks we leave unsmoothed (lower noise, sparser use)
      };

      hand.pinchStrength = pinchStrength(hand);
      hand.pinching = isPinchClosed(hand, this.pinchStates.get(trackingKey) ?? false);
      this.pinchStates.set(trackingKey, hand.pinching);
      if (hand.pinching) {
        hand.gesture = Gesture.PINCH;
        hand.score = 1;
      }
      hands.push(hand);
    }
    this.pruneTrackers(timeS);
    return hands;
  }

  private createFilterBank(): OneEuroFilter[][] {
    return Array.from({ length: 21 }, () => [
      new OneEuroFilter(1.0, 0.007, 1.0),
      new OneEuroFilter(1.0, 0.007, 1.0),
      new OneEuroFilter(1.0, 0.007, 1.0),
    ]);
  }

  /** Apply the 1-Euro filter to every landmark's x/y/z in normalized space. */
  private smoothLandmarks(
    trackingKey: string,
    raw: { x: number; y: number; z: number }[],
    timeS: number,
  ): { x: number; y: number; z: number }[] {
    let bank = this.filters.get(trackingKey);
    if (!bank) {
      bank = this.createFilterBank();
      this.filters.set(trackingKey, bank);
    }
    return raw.map((lm, l) => ({
      x: bank[l][0].filter(lm.x, timeS),
      y: bank[l][1].filter(lm.y, timeS),
      z: bank[l][2].filter(lm.z, timeS),
    }));
  }

  private pruneTrackers(timeS: number): void {
    for (const [key, lastSeen] of this.trackerLastSeen) {
      if (timeS - lastSeen <= 0.75) continue;
      this.trackerLastSeen.delete(key);
      this.filters.delete(key);
      this.pinchStates.delete(key);
    }
  }
}

// Re-export landmark index for callers that want it without a second import.
export { LANDMARK };
