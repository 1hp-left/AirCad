import { normalizedHandSize, pinchDistance } from '../../gesture/landmarkUtils';
import type { HandResult } from '../../gesture/types';

export const MIN_HAND_SIGNAL = 1e-4;
export type HandSignalKind = 'pinch' | 'hand-size';

export function signalKindFor(hand: HandResult): HandSignalKind {
  const pinch = pinchDistance(hand);
  return Number.isFinite(pinch) && pinch > MIN_HAND_SIGNAL ? 'pinch' : 'hand-size';
}

export function signalFor(hand: HandResult, kind: HandSignalKind): number {
  if (kind === 'pinch') {
    const pinch = pinchDistance(hand);
    if (Number.isFinite(pinch) && pinch > MIN_HAND_SIGNAL) return pinch;
  }
  return Math.max(normalizedHandSize(hand), MIN_HAND_SIGNAL);
}
