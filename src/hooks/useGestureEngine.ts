import { useEffect, useRef, useState } from 'react';
import { GestureEngine } from '../gesture/GestureEngine';
import type { GestureFrame } from '../gesture/types';
import type { GestureEngineStatus } from '../gesture/types';

/**
 * Bridges the GestureEngine to React state for the HUD.
 *
 * IMPORTANT: the hot path (per-frame landmark→action math) does NOT run through
 * this hook — the scene controller subscribes to the engine directly. This hook
 * only pulls the *latest* gesture names into React at a throttled cadence so
 * the HUD label updates without triggering 60fps re-renders.
 */
export function useGestureEngine(video: HTMLVideoElement | null) {
  const engineRef = useRef<GestureEngine | null>(null);
  const [status, setStatus] = useState<GestureEngineStatus>('idle');
  const [currentGesture, setCurrentGesture] = useState<string>('None');
  const [numHands, setNumHands] = useState(0);

  useEffect(() => {
    if (!video) return;
    const engine = new GestureEngine();
    engineRef.current = engine;

    const offStatus = engine.onStatus(setStatus);
    // Throttle HUD updates to ~10fps — the label doesn't need 60fps and we don't
    // want to reconcile React every frame.
    let lastHud = 0;
    const offFrame = engine.on((frame: GestureFrame) => {
      const now = frame.timestampMs;
      if (now - lastHud < 100) return;
      lastHud = now;
      setNumHands(frame.hands.length);
      // Prefer the first hand's gesture for the HUD label; show "—" if none.
      const g = frame.hands[0]?.gesture ?? 'None';
      setCurrentGesture(g);
    });

    engine.init(video).catch(() => {
      /* status already set to 'error' by the engine */
    });

    return () => {
      offStatus();
      offFrame();
      engine.dispose();
      engineRef.current = null;
    };
  }, [video]);

  return { engineRef, status, currentGesture, numHands };
}
