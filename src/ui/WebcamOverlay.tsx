import { useEffect, useRef, type RefObject } from 'react';
import type { GestureEngine } from '../gesture/GestureEngine';
import type { GestureFrame } from '../gesture/types';
import { LANDMARK } from '../gesture/types';

/**
 * Draws the 21-point hand skeleton over the mirrored webcam preview each frame.
 *
 * The canvas sits in the mirrored `.webcam-wrap` and is itself CSS-mirrored to
 * stay aligned with the video, so we draw landmarks at their raw normalized
 * positions (x,y in [0,1]) — the mirror transform handles the flip.
 */

// Bone connections (MediaPipe hand topology), grouped for thicker palm bones.
const CONNECTIONS: Array<[number, number]> = [
  // Thumb
  [LANDMARK.WRIST, LANDMARK.THUMB_CMC],
  [LANDMARK.THUMB_CMC, LANDMARK.THUMB_MCP],
  [LANDMARK.THUMB_MCP, LANDMARK.THUMB_IP],
  [LANDMARK.THUMB_IP, LANDMARK.THUMB_TIP],
  // Index
  [LANDMARK.WRIST, LANDMARK.INDEX_MCP],
  [LANDMARK.INDEX_MCP, LANDMARK.INDEX_PIP],
  [LANDMARK.INDEX_PIP, LANDMARK.INDEX_DIP],
  [LANDMARK.INDEX_DIP, LANDMARK.INDEX_TIP],
  // Middle
  [LANDMARK.MIDDLE_MCP, LANDMARK.MIDDLE_PIP],
  [LANDMARK.MIDDLE_PIP, LANDMARK.MIDDLE_DIP],
  [LANDMARK.MIDDLE_DIP, LANDMARK.MIDDLE_TIP],
  // Ring
  [LANDMARK.RING_MCP, LANDMARK.RING_PIP],
  [LANDMARK.RING_PIP, LANDMARK.RING_DIP],
  [LANDMARK.RING_DIP, LANDMARK.RING_TIP],
  // Pinky
  [LANDMARK.PINKY_MCP, LANDMARK.PINKY_PIP],
  [LANDMARK.PINKY_PIP, LANDMARK.PINKY_DIP],
  [LANDMARK.PINKY_DIP, LANDMARK.PINKY_TIP],
  // Palm knuckle ridge
  [LANDMARK.INDEX_MCP, LANDMARK.MIDDLE_MCP],
  [LANDMARK.MIDDLE_MCP, LANDMARK.RING_MCP],
  [LANDMARK.RING_MCP, LANDMARK.PINKY_MCP],
];

const COLORS = ['#4fd1c5', '#f6ad55']; // hand 0 / hand 1

export function WebcamOverlay({ engineRef }: { engineRef: RefObject<GestureEngine | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match the canvas backing store to its CSS size for crispness.
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width);
      canvas.height = Math.round(r.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let off: (() => void) | null = null;

    const attach = () => {
      const engine = engineRef.current;
      if (!engine) {
        // Retry until the engine exists (it's created after the video is ready).
        return false;
      }
      off = engine.on((frame: GestureFrame) => draw(ctx, canvas, frame));
      return true;
    };

    // The engine is created asynchronously once the webcam is ready. Poll
    // briefly to attach; once attached we're done.
    let tries = 0;
    const timer = setInterval(() => {
      if (attach() || ++tries > 40) clearInterval(timer);
    }, 150);

    return () => {
      clearInterval(timer);
      ro.disconnect();
      off?.();
    };
  }, [engineRef]);

  const draw = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: GestureFrame,
  ) => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    frame.hands.forEach((hand, hi) => {
      const color = COLORS[hi % COLORS.length];
      const pts = hand.landmarks.map((l) => ({ x: l.x * w, y: l.y * h }));

      // Bones.
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();

      // Joints.
      ctx.fillStyle = color;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  };

  return <canvas ref={canvasRef} className="overlay" />;
}
