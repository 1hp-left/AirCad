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
  hint: 'upright or sideways, then move up / down',
};

/** Built-in + (future) custom gestures, mapped to AirCad actions. */
export const GESTURE_CONFIG: Record<string, GestureConfig> = {
  [Gesture.NONE]: { action: 'none', label: 'Idle', hint: 'no action' },
  [Gesture.POINTING_UP]: { action: 'select', label: 'Select', hint: 'point at an object' },
  [Gesture.CLOSED_FIST]: { action: 'move', label: 'Move', hint: 'grab, move, open to finish' },
  [Gesture.VICTORY]: { action: 'rotate', label: 'Rotate', hint: 'then move sideways / vertically' },
  [Gesture.THUMB_UP]: { action: 'scale', label: 'Resize', hint: 'thumb–index distance → size' },
  [Gesture.I_LOVE_YOU]: shape,
  [Gesture.L_SHAPE]: shape,
  [Gesture.OPEN_PALM]: { action: 'create', label: 'Create', hint: 'hold briefly; release between objects' },
  [Gesture.THUMB_DOWN]: { action: 'delete', label: 'Delete', hint: 'hold briefly on the selected object' },
  [Gesture.PINCH]: { action: 'scale', label: 'Resize', hint: 'pinch → size' },
  [Gesture.EXPORT]: { action: 'export', label: 'Export', hint: 'export selected format' },
};

/** Order for the on-screen legend. */
export const LEGEND_ORDER = [
  Gesture.POINTING_UP,
  Gesture.OPEN_PALM,
  Gesture.CLOSED_FIST,
  Gesture.VICTORY,
  Gesture.THUMB_UP,
  Gesture.I_LOVE_YOU,
  Gesture.THUMB_DOWN,
] as const;

/** Look up the friendly label for a gesture name (falls back to the raw name). */
export function labelFor(gestureName: string): string {
  return GESTURE_CONFIG[gestureName]?.label ?? gestureName;
}
