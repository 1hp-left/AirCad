import { useEffect, useRef, useState } from 'react';
import { labelFor } from './config/gestures';
import { useGestureEngine } from './hooks/useGestureEngine';
import { useWebcam, type WebcamStatus } from './hooks/useWebcam';
import type { GestureEngineStatus } from './gesture/types';
import { GestureLegend } from './ui/GestureLegend';
import { WebcamOverlay } from './ui/WebcamOverlay';
import { MouseController } from './three/MouseController';
import {
  PRIMITIVE_LABELS,
  PRIMITIVE_TYPES,
  type PrimitiveType,
} from './three/primitives';
import { SceneController, type SceneControllerSnapshot } from './three/SceneController';
import { SceneManager } from './three/SceneManager';

const EMPTY_SCENE_SNAPSHOT: SceneControllerSnapshot = {
  action: 'none',
  selectedName: null,
  isMoving: false,
  shapeAxis: null,
  input: null,
  notice: null,
};

/**
 * AirCad — gesture-controlled 3D modeling.
 *
 * App is the composition root: it mounts the Three.js viewport (owned by
 * SceneManager), the webcam pipeline (useWebcam → useGestureEngine), and the
 * editor chrome. React never reconciles the scene graph on the hot path.
 */
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const gestureSnapshotRef = useRef<SceneControllerSnapshot>(EMPTY_SCENE_SNAPSHOT);
  const mouseSnapshotRef = useRef<SceneControllerSnapshot>(EMPTY_SCENE_SNAPSHOT);
  const [cameraPreviewVisible, setCameraPreviewVisible] = useState(true);
  const [primitiveType, setPrimitiveType] = useState<PrimitiveType>('box');
  const [sceneSnapshot, setSceneSnapshot] = useState<SceneControllerSnapshot>(
    gestureSnapshotRef.current,
  );

  const { videoRef, status: camStatus } = useWebcam();
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const { engineRef, status: gestureStatus, currentGesture, numHands } =
    useGestureEngine(videoEl);

  useEffect(() => {
    if (!canvasRef.current) return;
    const manager = new SceneManager(canvasRef.current);
    const mouseController = new MouseController(manager);
    managerRef.current = manager;
    manager.addStarterObject();
    manager.start();

    const unsubscribeMouse = mouseController.on((snapshot) => {
      mouseSnapshotRef.current = snapshot;
      setSceneSnapshot(manager.mouseInteractionActive ? snapshot : gestureSnapshotRef.current);
    });

    return () => {
      unsubscribeMouse();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      mouseController.dispose();
      manager.dispose();
      managerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (camStatus === 'ready' && videoRef.current) setVideoEl(videoRef.current);
  }, [camStatus, videoRef]);

  // Attach the scene-side gesture controller only when the engine is live and
  // the manager has mounted. SceneController owns the per-frame modeling path.
  useEffect(() => {
    const manager = managerRef.current;
    const engine = engineRef.current;
    if (gestureStatus !== 'running' || !manager || !engine) return;

    const controller = new SceneController(manager, engine, primitiveType);
    controllerRef.current = controller;
    const unsubscribe = controller.on((snapshot) => {
      gestureSnapshotRef.current = snapshot;
      setSceneSnapshot(manager.mouseInteractionActive ? mouseSnapshotRef.current : snapshot);
    });

    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [gestureStatus]);

  useEffect(() => {
    controllerRef.current?.setPrimitiveType(primitiveType);
  }, [primitiveType]);

  const actionHint = getActionHint(sceneSnapshot, primitiveType);
  const sceneStatus = getSceneStatus(sceneSnapshot);
  const gestureDisplay = getGestureDisplay(
    gestureStatus,
    camStatus,
    currentGesture,
    numHands,
    sceneSnapshot,
  );
  const cameraAvailable = camStatus === 'ready' || camStatus === 'requesting';
  const blocked = camStatus === 'denied' || camStatus === 'no-device' || camStatus === 'error';

  return (
    <div className="editor-shell">
      <canvas id="scene-canvas" ref={canvasRef} />

      <header className="topbar">
        <div className="brand">
          <h1>AirCad</h1>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="camera-toggle"
            aria-pressed={cameraPreviewVisible}
            title={cameraPreviewVisible ? 'Hide camera preview' : 'Show camera preview'}
            onClick={() => setCameraPreviewVisible((visible) => !visible)}
          >
            {cameraPreviewVisible ? 'Hide camera' : 'Show camera'}
          </button>
        </div>
      </header>

      <aside className="tool-shelf" aria-label="Primitive picker">
        <div className="shelf-section-label">Create</div>
        {PRIMITIVE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={`shelf-tool ${primitiveType === type ? 'active' : ''}`}
            aria-pressed={primitiveType === type}
            title={`${PRIMITIVE_LABELS[type]} primitive — hold an open palm to create`}
            onClick={() => setPrimitiveType(type)}
          >
            <span className={`tool-glyph primitive-${type}`} aria-hidden="true" />
            <span>{PRIMITIVE_LABELS[type]}</span>
          </button>
        ))}
      </aside>

      <aside className="properties-panel" aria-label="Gesture and scene properties">
        <div className="panel-heading">
          <span>Properties</span>
        </div>

        <section className="property-section gesture-section">
          <div className="section-heading">Hand controls</div>
          <div className="gesture-value">
            <strong className={gestureDisplay.idle ? 'idle' : ''}>{gestureDisplay.label}</strong>
            <span className="gesture-detail">{gestureDisplay.detail}</span>
          </div>
        </section>

        <section className="property-section">
          <div className="section-heading">Create</div>
          <div className="primitive-value">
            <span className={`tool-glyph primitive-${primitiveType}`} aria-hidden="true" />
            <div>
              <span>Next object</span>
              <strong>{PRIMITIVE_LABELS[primitiveType]}</strong>
            </div>
          </div>
          <p className="hint primitive-hint">
            Hold an open palm to create one at your hand. Relax your hand before creating another.
          </p>
        </section>

        <section className="property-section">
          <div className="section-heading">Selection</div>
          <div
            className={`object-status ${sceneSnapshot.notice ? `command-${sceneSnapshot.action}` : ''}`}
            role="status"
            aria-live="polite"
          >
            <strong>{sceneStatus}</strong>
          </div>
          <p className="hint">{actionHint}</p>
          {sceneSnapshot.selectedName && (
            <div className="selected-name">{sceneSnapshot.selectedName}</div>
          )}
        </section>
      </aside>

      {sceneSnapshot.isMoving && sceneSnapshot.input === 'gesture' && (
        <ControlCoach snapshot={sceneSnapshot} />
      )}

      <section className="bottom-panel" aria-label="Gesture reference">
        <div className="bottom-heading">Gestures</div>
        <GestureLegend />
      </section>

      {cameraAvailable && (
        <section
          className={`webcam-wrap ${cameraPreviewVisible ? '' : 'is-hidden'}`}
          aria-label="Camera preview"
          aria-hidden={!cameraPreviewVisible}
        >
          <div className="webcam-header">
            <span>Camera</span>
          </div>
          <div className="webcam-frame">
            <video ref={videoRef} playsInline muted />
            <WebcamOverlay engine={engineRef.current} />
          </div>
        </section>
      )}

      {blocked && <CameraBlocked status={camStatus} />}
    </div>
  );
}

function getActionHint(snapshot: SceneControllerSnapshot, primitiveType: PrimitiveType): string {
  const gestureActive = snapshot.isMoving && snapshot.input === 'gesture';
  const mouseActive = snapshot.isMoving && snapshot.input === 'mouse';
  switch (snapshot.action) {
    case 'rotate':
      if (mouseActive) return 'Drag sideways to spin or vertically to tilt.';
      return gestureActive
        ? 'Rotation stays locked even if the Victory gesture stops recognizing.'
        : 'Show a Victory sign to start, or hold R and drag.';
    case 'scale':
      if (mouseActive) return 'Drag up to grow or down to shrink.';
      return gestureActive
        ? 'Spread thumb and index to grow; pinch them together to shrink.'
        : 'Show a thumb up to start, or hold S and drag.';
    case 'shape':
      if (mouseActive) return 'Drag up to stretch height or down to squash it.';
      return gestureActive
        ? `${snapshot.shapeAxis === 'X' ? 'Width' : 'Height'} is locked. Move up to stretch or down to squash.`
        : 'Hold the I-love-you gesture upright for height or sideways for width.';
    case 'move':
      if (mouseActive) return 'Drag to place the object on the current view plane.';
      return gestureActive
        ? 'Move your hand to place the object. Move closer or farther to change depth.'
        : 'Close your fist to grab, or drag the object with the mouse.';
    case 'create':
      return snapshot.notice
        ? 'Open Palm recognized. Relax your hand before creating another object.'
        : `Hold an open palm to create a ${PRIMITIVE_LABELS[primitiveType]} at your hand.`;
    case 'delete':
      return snapshot.notice
        ? 'Thumb Down recognized. Relax your hand before deleting another object.'
        : snapshot.selectedName
          ? 'Hold a Thumb Down to delete the selected object.'
          : 'Point at an object to select it before deleting.';
    default:
      return snapshot.selectedName
        ? 'Click and drag, or close your fist to move it.'
        : 'Click the box, or point at it with your index finger to select it.';
  }
}

function getSceneStatus(snapshot: SceneControllerSnapshot): string {
  if (snapshot.notice) return snapshot.notice;
  if (!snapshot.selectedName) return 'No object selected';
  if (!snapshot.isMoving) return 'Object selected';
  switch (snapshot.action) {
    case 'rotate':
      return 'Rotating selected object';
    case 'scale':
      return 'Resizing selected object';
    case 'shape':
      return 'Shaping selected object';
    default:
      return 'Moving selected object';
  }
}

function ControlCoach({ snapshot }: { snapshot: SceneControllerSnapshot }) {
  const axisName = snapshot.shapeAxis === 'X' ? 'width' : 'height';
  return (
    <section className="control-coach" role="status" aria-live="polite">
      <div className="coach-heading">
        <strong>{controlTitle(snapshot)}</strong>
      </div>
      <div className="coach-directions">
        {snapshot.action === 'rotate' && (
          <>
            <span><b aria-hidden="true">← →</b> Move sideways to spin</span>
            <span><b aria-hidden="true">↑ ↓</b> Move vertically to tilt</span>
          </>
        )}
        {snapshot.action === 'shape' && (
          <>
            <span><b aria-hidden="true">↑</b> Stretch {axisName}</span>
            <span><b aria-hidden="true">↓</b> Squash {axisName}</span>
          </>
        )}
        {snapshot.action === 'scale' && (
          <span><b aria-hidden="true">↔</b> Spread to grow · pinch to shrink</span>
        )}
        {snapshot.action === 'move' && (
          <span><b aria-hidden="true">✥</b> Move your hand to place the object</span>
        )}
      </div>
      <span className="coach-release">Open your palm or lower your hand to finish</span>
    </section>
  );
}

function controlTitle(snapshot: SceneControllerSnapshot): string {
  switch (snapshot.action) {
    case 'rotate':
      return 'Rotation locked';
    case 'scale':
      return 'Resize locked';
    case 'shape':
      return `${snapshot.shapeAxis === 'X' ? 'Width' : 'Height'} shaping locked`;
    default:
      return 'Object grabbed';
  }
}

interface GestureDisplay {
  label: string;
  detail: string;
  idle: boolean;
}

function getGestureDisplay(
  gestureStatus: GestureEngineStatus,
  camStatus: WebcamStatus,
  currentGesture: string,
  numHands: number,
  snapshot: SceneControllerSnapshot,
): GestureDisplay {
  if (camStatus === 'requesting') {
    return {
      label: 'Connecting to camera',
      detail: 'Allow access if your browser asks',
      idle: true,
    };
  }
  if (camStatus !== 'ready') {
    return { label: 'Camera unavailable', detail: 'Reload after fixing camera access', idle: true };
  }
  if (gestureStatus === 'loading' || gestureStatus === 'idle') {
    return { label: 'Starting hand controls', detail: 'This usually takes a moment', idle: true };
  }
  if (gestureStatus === 'error' || gestureStatus === 'no-camera') {
    return { label: 'Hand controls unavailable', detail: 'Reload to try again', idle: true };
  }
  if (snapshot.isMoving && snapshot.input === 'gesture') {
    return {
      label: controlTitle(snapshot),
      detail: 'Move your hand to adjust the object',
      idle: false,
    };
  }
  if (numHands === 0) {
    return { label: 'No hand detected', detail: 'Show one hand to begin', idle: true };
  }
  if (currentGesture === 'None') {
    return { label: 'Hand detected', detail: 'Make a gesture to choose an action', idle: true };
  }
  return {
    label: labelFor(currentGesture),
    detail: `${numHands} hand${numHands > 1 ? 's' : ''} detected`,
    idle: false,
  };
}

function CameraBlocked({ status }: { status: WebcamStatus }) {
  const title = status === 'denied' ? 'Camera access denied' : 'No camera available';
  const body =
    status === 'denied'
      ? 'Allow camera access in your browser, then reload. AirCad needs your webcam to read hand gestures.'
      : 'AirCad needs a webcam to read hand gestures. Plug one in, allow access, and reload.';
  return (
    <div className="fullscreen-msg">
      <h2>{title}</h2>
      <p>{body}</p>
      <button type="button" className="tool" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
