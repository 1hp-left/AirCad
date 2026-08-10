/**
 * Shared gesture-engine types.
 *
 * A `HandResult` is one frame's data for one detected hand. MediaPipe gives us
 * a normalized landmark space (x/y in [0,1] relative to the image, z depth
 * relative to the wrist) and a world-landmark space (meters, origin at the
 * hand's geometric center). We keep both — normalized is convenient for screen
 * raycasting, world is better for measuring real pinch distances.
 */

/** MediaPipe's 21 hand landmark indices. */
export const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** A decoded single hand at one instant. */
export interface HandResult {
  /** "Left" | "Right" per MediaPipe (mirrored from the camera's POV). */
  handedness: string;
  /** Top gesture category name, e.g. "Closed_Fist". "None" if nothing confident. */
  gesture: string;
  /** Confidence 0..1. */
  score: number;
  /** Landmark-derived pinch state with hysteresis; independent of pose labels. */
  pinching: boolean;
  /** How close thumb and index are, normalized to 0..1 for visual feedback. */
  pinchStrength: number;
  /** 21 normalized landmarks (x,y in [0,1], z relative depth). */
  landmarks: { x: number; y: number; z: number }[];
  /** 21 world-space landmarks (meters, origin at hand center). */
  worldLandmarks: { x: number; y: number; z: number }[];
}

/** Everything the gesture loop emits each frame. */
export interface GestureFrame {
  hands: HandResult[];
  /** Wall time of the source video frame — for de-dup via recognizeForVideo. */
  timestampMs: number;
}

export type GestureListener = (frame: GestureFrame) => void;

/** Status surfaced to React for the HUD / fallback UI. */
export type GestureEngineStatus =
  | 'idle'
  | 'loading' // downloading the .task model + wasm
  | 'running'
  | 'no-camera' // getUserMedia failed
  | 'error';
