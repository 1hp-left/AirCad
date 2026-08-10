import { LANDMARK, HandResult } from './types';
import * as THREE from 'three';

/**
 * Pure helpers that turn MediaPipe's 21 hand landmarks into the continuous
 * values the modeling actions need. Kept dependency-free of the scene so they
 * can be unit-tested and reused.
 */

export type Vec3 = { x: number; y: number; z: number };

const PINCH_START_RATIO = 0.38;
const PINCH_RELEASE_RATIO = 0.56;
const PINCH_FULL_STRENGTH_RATIO = 0.18;
const PINCH_ZERO_STRENGTH_RATIO = 0.82;
const MIN_PALM_WIDTH = 0.0001;

const PALM_LANDMARKS = [
  LANDMARK.WRIST,
  LANDMARK.INDEX_MCP,
  LANDMARK.MIDDLE_MCP,
  LANDMARK.RING_MCP,
  LANDMARK.PINKY_MCP,
] as const;

/** Euclidean distance between two landmark points (any space). */
export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Thumb-tip to index-tip distance in world landmarks. This is independent of
 * camera distance; use `pinchRatio` when hand-size invariance also matters.
 */
export function pinchDistance(hand: HandResult): number {
  return distance(
    hand.worldLandmarks[LANDMARK.THUMB_TIP],
    hand.worldLandmarks[LANDMARK.INDEX_TIP],
  );
}

/** Thumb/index midpoint used as the direct-manipulation cursor. */
export function pinchPoint(hand: Pick<HandResult, 'landmarks'>): Vec3 {
  const thumb = hand.landmarks[LANDMARK.THUMB_TIP];
  const index = hand.landmarks[LANDMARK.INDEX_TIP];
  return {
    x: (thumb.x + index.x) / 2,
    y: (thumb.y + index.y) / 2,
    z: (thumb.z + index.z) / 2,
  };
}

/**
 * Thumb/index gap divided by palm width. The ratio works across hand sizes and
 * camera distance, unlike a fixed pixel or meter threshold.
 */
export function pinchRatio(
  hand: Pick<HandResult, 'landmarks' | 'worldLandmarks'>,
): number {
  const points = hand.worldLandmarks.length >= 21
    ? hand.worldLandmarks
    : hand.landmarks;
  const gap = distance(points[LANDMARK.THUMB_TIP], points[LANDMARK.INDEX_TIP]);
  const palmWidth = distance(points[LANDMARK.INDEX_MCP], points[LANDMARK.PINKY_MCP]);
  return gap / Math.max(palmWidth, MIN_PALM_WIDTH);
}

/** Stable pinch state: easy to close, but requires a wider gap to release. */
export function isPinchClosed(
  hand: Pick<HandResult, 'landmarks' | 'worldLandmarks'>,
  wasClosed = false,
): boolean {
  const ratio = pinchRatio(hand);
  return Number.isFinite(ratio) && ratio <= (wasClosed ? PINCH_RELEASE_RATIO : PINCH_START_RATIO);
}

/** Continuous pinch amount used only for feedback, not action switching. */
export function pinchStrength(
  hand: Pick<HandResult, 'landmarks' | 'worldLandmarks'>,
): number {
  const ratio = pinchRatio(hand);
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      (PINCH_ZERO_STRENGTH_RATIO - ratio) /
        (PINCH_ZERO_STRENGTH_RATIO - PINCH_FULL_STRENGTH_RATIO),
    ),
  );
}

/**
 * Center of the palm — average of the four finger MCP joints + wrist. Stable
 * and lies inside the palm, unlike any single landmark.
 */
export function palmCenter(hand: HandResult): Vec3 {
  let x = 0,
    y = 0,
    z = 0;
  for (const i of PALM_LANDMARKS) {
    x += hand.landmarks[i].x;
    y += hand.landmarks[i].y;
    z += hand.landmarks[i].z;
  }
  const n = PALM_LANDMARKS.length;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Palm normal — a unit vector pointing out of the palm (away from the hand's
 * "back"). Computed from the cross product of two palm-plane basis vectors:
 *   u = wrist → index MCP
 *   v = wrist → pinky MCP
 * The cross product is perpendicular to the palm plane; we pick the orientation
 * that points away from the middle-finger MCP (outside the palm).
 *
 * Operates in NORMALIZED landmark space — fine for an orientation; we don't
 * need real-world scale here.
 */
export function palmNormal(hand: HandResult): Vec3 {
  const wrist = hand.landmarks[LANDMARK.WRIST];
  const indexMcp = hand.landmarks[LANDMARK.INDEX_MCP];
  const pinkyMcp = hand.landmarks[LANDMARK.PINKY_MCP];

  const u = sub(indexMcp, wrist);
  const v = sub(pinkyMcp, wrist);
  const n = cross(u, v);
  const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1;
  let nx = n.x / len;
  let ny = n.y / len;
  let nz = n.z / len;

  // Orient so the normal points away from the middle MCP (i.e., out of the palm).
  const midMcp = hand.landmarks[LANDMARK.MIDDLE_MCP];
  const toMid = sub(midMcp, wrist);
  if (dot({ x: nx, y: ny, z: nz }, toMid) > 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return { x: nx, y: ny, z: nz };
}

/**
 * Hand "size" — distance wrist ↔ middle MCP in world meters. Used as a depth
 * proxy: a hand closer to the camera appears larger in normalized space, but
 * the world-space hand size is roughly constant, so we instead derive depth
 * from the *normalized* hand size vs. an assumed real hand size. See
 * `handDepthProxy`.
 */
export function normalizedHandSize(hand: HandResult): number {
  return distance(
    hand.landmarks[LANDMARK.WRIST],
    hand.landmarks[LANDMARK.MIDDLE_MCP],
  );
}

/**
 * The index-fingertip screen position in normalized [0,1] coords, suitable for
 * raycasting into the scene. Returns the pointing fingertip; if the hand is
 * not pointing, it's still a reasonable hand "cursor".
 */
export function fingertipScreen(hand: HandResult): Vec3 {
  return { ...hand.landmarks[LANDMARK.INDEX_TIP] };
}

// --- tiny vector ops (kept local to avoid pulling three into every helper) ---

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Convenience: palm normal as a THREE.Vector3 (for the scene side). */
export function palmNormalVector3(
  hand: HandResult,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const n = palmNormal(hand);
  return target.set(n.x, n.y, n.z);
}
