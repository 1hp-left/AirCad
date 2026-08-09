import { useEffect, useRef, useState } from 'react';
import { labelFor } from './config/gestures';
import { useGestureEngine } from './hooks/useGestureEngine';
import { useWebcam, type WebcamStatus } from './hooks/useWebcam';
import { GestureLegend } from './ui/GestureLegend';
import { WebcamOverlay } from './ui/WebcamOverlay';
import { MouseController } from './three/MouseController';
import { SceneController, type SceneControllerSnapshot } from './three/SceneController';
import { SceneManager } from './three/SceneManager';

const EMPTY_SCENE_SNAPSHOT: SceneControllerSnapshot = {
  action: 'none',
  selectedName: null,
  isMoving: false,
  shapeAxis: null,
  input: null,
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
  const [activeTool, setActiveTool] = useState<'box' | 'select' | 'move'>('select');
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
    manager.addTestBox();
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

    const controller = new SceneController(manager, engine);
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

  const actionHint = getActionHint(sceneSnapshot);
  const sceneStatus = getSceneStatus(sceneSnapshot);
  const gestureControlActive = sceneSnapshot.isMoving && sceneSnapshot.input === 'gesture';
  const cameraAvailable = camStatus === 'ready' || camStatus === 'requesting';
  const blocked = camStatus === 'denied' || camStatus === 'no-device' || camStatus === 'error';

  return (
    <div className="editor-shell">
      <canvas id="scene-canvas" ref={canvasRef} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <h1>AirCad</h1>
            <span>Gesture 3D Modeling</span>
          </div>
        </div>
        <nav className="menu" aria-label="Application menu">
          <button type="button">Scene</button>
          <button type="button">Gesture</button>
          <button type="button">View</button>
        </nav>
        <div className="topbar-status">
          <span className={`status-dot ${gestureStatus === 'running' ? 'live' : ''}`} />
          <span>{engineStatusLabel(gestureStatus, camStatus)}</span>
          <button
            type="button"
            className={`camera-toggle ${cameraPreviewVisible ? 'active' : ''}`}
            aria-pressed={cameraPreviewVisible}
            title={cameraPreviewVisible ? 'Hide camera preview' : 'Show camera preview'}
            onClick={() => setCameraPreviewVisible((visible) => !visible)}
          >
            <span className="camera-icon" aria-hidden="true">◉</span>
            Camera
          </button>
        </div>
      </header>

      <aside className="tool-shelf" aria-label="Tools">
        <div className="shelf-section-label">Tools</div>
        <button
          type="button"
          className={`shelf-tool ${activeTool === 'box' ? 'active' : ''}`}
          title="Box primitive"
          onClick={() => setActiveTool('box')}
        >
          <span className="tool-glyph cube" aria-hidden="true" />
          <span>Box</span>
        </button>
        <button
          type="button"
          className={`shelf-tool ${activeTool === 'select' ? 'active' : ''}`}
          title="Select tool"
          onClick={() => setActiveTool('select')}
        >
          <span className="tool-glyph pointer" aria-hidden="true">⌖</span>
          <span>Select</span>
        </button>
        <button
          type="button"
          className={`shelf-tool ${activeTool === 'move' ? 'active' : ''}`}
          title="Move tool"
          onClick={() => setActiveTool('move')}
        >
          <span className="tool-glyph move" aria-hidden="true">✥</span>
          <span>Move</span>
        </button>
        <div className="shelf-divider" />
        <div className="shelf-section-label">Export</div>
        <button type="button" className="shelf-tool compact" disabled>STL</button>
        <button type="button" className="shelf-tool compact" disabled>OBJ</button>
        <button type="button" className="shelf-tool compact" disabled>GLTF</button>
      </aside>

      <aside className="properties-panel" aria-label="Gesture and scene properties">
        <div className="panel-heading">
          <span>Properties</span>
          <span className="panel-menu" aria-hidden="true">⋮</span>
        </div>

        <section className="property-section gesture-section">
          <div className="section-heading">Gesture input</div>
          <div className="gesture-value">
            <span className="gesture-kicker">
              {gestureControlActive
                ? 'Landmark control locked'
                : numHands > 0
                  ? `${numHands} hand${numHands > 1 ? 's' : ''}`
                  : 'Waiting'}
            </span>
            <strong className={!gestureControlActive && currentGesture === 'None' ? 'idle' : ''}>
              {gestureControlActive
                ? controlTitle(sceneSnapshot)
                : currentGesture === 'None'
                  ? 'No gesture'
                  : labelFor(currentGesture)}
            </strong>
          </div>
          <div className="property-row">
            <span>Tracking</span>
            <strong>{engineStatusLabel(gestureStatus, camStatus)}</strong>
          </div>
        </section>

        <section className="property-section">
          <div className="section-heading">Active object</div>
          <div className="object-status">
            <span className={`object-status-dot ${sceneSnapshot.selectedName ? 'selected' : ''}`} />
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
        <div className="bottom-heading">Gesture reference</div>
        <GestureLegend />
      </section>

      {cameraAvailable && (
        <section
          className={`webcam-wrap ${cameraPreviewVisible ? '' : 'is-hidden'}`}
          aria-label="Camera preview"
          aria-hidden={!cameraPreviewVisible}
        >
          <div className="webcam-header">
            <span>Camera preview</span>
            <span className="camera-live"><span className="status-dot live" /> LIVE</span>
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

function getActionHint(snapshot: SceneControllerSnapshot): string {
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
    default:
      return snapshot.selectedName
        ? 'Click and drag, or close your fist to move it.'
        : 'Click the box, or point at it with your index finger to select it.';
  }
}

function getSceneStatus(snapshot: SceneControllerSnapshot): string {
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
        <span className="status-dot live" aria-hidden="true" />
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

function engineStatusLabel(g: string, cam: WebcamStatus): string {
  if (cam !== 'ready') return camStatusLabel(cam);
  if (g === 'running') return 'engine live';
  if (g === 'loading') return 'loading model…';
  if (g === 'error') return 'engine error';
  return 'engine idle';
}

function camStatusLabel(s: WebcamStatus): string {
  switch (s) {
    case 'requesting':
      return 'requesting camera…';
    case 'denied':
      return 'camera denied';
    case 'no-device':
      return 'no camera found';
    case 'error':
      return 'camera error';
    default:
      return 'camera idle';
  }
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
