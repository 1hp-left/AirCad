/**
 * Gesture category name constants.
 *
 * These match MediaPipe's GestureRecognizer built-in category names exactly.
 * A custom-trained .task may add more names; add them here and map them in
 * `src/config/gestures.ts` — no engine code changes needed.
 */
export const Gesture = {
  NONE: 'None',
  CLOSED_FIST: 'Closed_Fist',
  OPEN_PALM: 'Open_Palm',
  POINTING_UP: 'Pointing_Up',
  THUMB_DOWN: 'Thumb_Down',
  THUMB_UP: 'Thumb_Up',
  VICTORY: 'Victory',
  I_LOVE_YOU: 'ILoveYou',

  // --- Custom-trained gesture names (M7). Add as you train them. ---
  PINCH: 'Pinch',
  L_SHAPE: 'L_Shape',
  EXPORT: 'Export',
} as const;

export type GestureName = (typeof Gesture)[keyof typeof Gesture];

/** Gestures considered "no action / neutral" — not mapped to actions. */
export const NEUTRAL_GESTURES = new Set<string>([Gesture.NONE]);
