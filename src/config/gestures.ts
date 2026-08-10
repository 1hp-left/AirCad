import { Gesture } from '../gesture/gestures';

/**
 * Gesture → action configuration.
 *
 * Keyed by the exact gesture *category name string* MediaPipe emits, so
 * swapping in a custom-trained .task that introduces new names only requires
 * adding entries here — the engine and scene controller read from this map.
 *
 * `action` is the internal id the scene controller switches on (wired in M2+).
 * `label`/`hint` drive the HUD legend shown in M1.
 */
export type ActionId =
  | 'none'
  | 'select'
  | 'move'
  | 'transform'
  | 'rotate'
  | 'scale' // uniform resize
  | 'shape' // stretch & squash
  | 'create'
  | 'combine'
  | 'delete'
  | 'export';

export interface GestureConfig {
  action: ActionId;
  label: string;
  hint: string;
}

const shape = {
  action: 'shape' as const,
  label: 'Shape',
  hint: 'L-shape; move up / down',
};

const neutralHand = {
  action: 'none' as const,
  label: 'Hand detected',
  hint: 'pinch an object to grab',
};

/** Built-in, landmark-derived, and future custom gestures mapped to actions. */
export const GESTURE_CONFIG: Record<string, GestureConfig> = {
  [Gesture.NONE]: { action: 'none', label: 'Idle', hint: 'no action' },
  [Gesture.POINTING_UP]: { action: 'select', label: 'Select', hint: 'point at object' },
  [Gesture.CLOSED_FIST]: neutralHand,
  [Gesture.VICTORY]: neutralHand,
  [Gesture.THUMB_UP]: neutralHand,
  [Gesture.I_LOVE_YOU]: shape,
  [Gesture.L_SHAPE]: shape,
  [Gesture.OPEN_PALM]: { action: 'create', label: 'Create', hint: 'hold palm; release' },
  [Gesture.THUMB_DOWN]: neutralHand,
  [Gesture.PINCH]: { action: 'move', label: 'Pinch', hint: 'grab and move object' },
  [Gesture.EXPORT]: { action: 'export', label: 'Export', hint: 'export selected format' },
};

/** Look up the friendly label for a gesture name (falls back to the raw name). */
export function labelFor(gestureName: string): string {
  return GESTURE_CONFIG[gestureName]?.label ?? gestureName;
}
