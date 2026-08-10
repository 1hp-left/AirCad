import { useCallback, useEffect, useRef, useState } from 'react';
import { labelFor } from './config/gestures';
import { useGestureEngine } from './hooks/useGestureEngine';
import { useWebcam, type WebcamStatus } from './hooks/useWebcam';
import type { GestureEngineStatus } from './gesture/types';
import { GestureLegend } from './ui/GestureLegend';
import { WebcamOverlay } from './ui/WebcamOverlay';
import { MouseController } from './three/MouseController';
import {
  createExportFile,
  downloadExportFile,
  type ExportFormat,
} from './three/exporter';
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

type ExportState =
  | { status: 'idle'; message: '' }
  | { status: 'working' | 'success' | 'error'; message: string };

const EXPORT_LABELS: Record<ExportFormat, string> = {
  stl: 'STL',
  obj: 'OBJ',
  glb: 'GLB',
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
  const exportInFlightRef = useRef(false);
  const deleteNoticeTimerRef = useRef<number | null>(null);
  const [cameraPreviewVisible, setCameraPreviewVisible] = useState(true);
  const [primitiveType, setPrimitiveType] = useState<PrimitiveType>('box');
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>({
    status: 'idle',
    message: '',
  });
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
      if (snapshot.selectedName) {
        setDeleteNotice(null);
        if (deleteNoticeTimerRef.current !== null) {
          window.clearTimeout(deleteNoticeTimerRef.current);
          deleteNoticeTimerRef.current = null;
        }
      }
      setSceneSnapshot(snapshot);
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
      if (snapshot.selectedName) {
        setDeleteNotice(null);
        if (deleteNoticeTimerRef.current !== null) {
          window.clearTimeout(deleteNoticeTimerRef.current);
          deleteNoticeTimerRef.current = null;
        }
      }
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

  useEffect(() => () => {
    if (deleteNoticeTimerRef.current !== null) {
      window.clearTimeout(deleteNoticeTimerRef.current);
    }
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const manager = managerRef.current;
    if (
      !manager ||
      manager.mouseInteractionActive ||
      sceneSnapshot.isMoving ||
      sceneSnapshot.action === 'combine'
    ) return;

    const deletedName = manager.objectStore.deleteSelected();
    if (!deletedName) return;

    const nextSnapshot: SceneControllerSnapshot = {
      action: 'delete',
      selectedName: null,
      isMoving: false,
      shapeAxis: null,
      input: null,
      notice: null,
    };
    gestureSnapshotRef.current = nextSnapshot;
    mouseSnapshotRef.current = nextSnapshot;
    setSceneSnapshot(nextSnapshot);
    setDeleteNotice(`${deletedName} deleted`);

    if (deleteNoticeTimerRef.current !== null) {
      window.clearTimeout(deleteNoticeTimerRef.current);
    }
    deleteNoticeTimerRef.current = window.setTimeout(() => {
      setDeleteNotice(null);
      deleteNoticeTimerRef.current = null;
    }, 1_400);
  }, [sceneSnapshot.action, sceneSnapshot.isMoving]);

  useEffect(() => {
    const handleDeleteKey = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        isTextEntryTarget(event.target) ||
        !managerRef.current?.objectStore.selected
      ) return;

      event.preventDefault();
      handleDeleteSelected();
    };

    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [handleDeleteSelected]);

  const handleExport = async (format: ExportFormat) => {
    if (exportInFlightRef.current) return;
    const objects = managerRef.current?.objectStore.objects ?? [];
    const formatLabel = EXPORT_LABELS[format];
    if (objects.length === 0) {
      setExportState({ status: 'error', message: 'Create an object before exporting.' });
      return;
    }

    exportInFlightRef.current = true;
    setExportState({ status: 'working', message: `Preparing ${formatLabel}…` });
    try {
      const file = await createExportFile(objects, format);
      downloadExportFile(file);
      setExportState({ status: 'success', message: `${formatLabel} downloaded.` });
    } catch (error) {
      setExportState({
        status: 'error',
        message: error instanceof Error ? error.message : `${formatLabel} export failed.`,
      });
    } finally {
      exportInFlightRef.current = false;
    }
  };

  const actionHint = deleteNotice
    ? 'Select another object to keep working.'
    : getActionHint(sceneSnapshot, primitiveType);
  const sceneStatus = deleteNotice ?? getSceneStatus(sceneSnapshot);
  const gestureDisplay = getGestureDisplay(
    gestureStatus,
    camStatus,
    currentGesture,
    numHands,
    sceneSnapshot,
  );
  const cameraAvailable = camStatus === 'ready' || camStatus === 'requesting';
  const blocked = camStatus === 'denied' || camStatus === 'no-device' || camStatus === 'error';
  const objectCount = managerRef.current?.objectStore.size ?? 0;
  const canDelete = Boolean(sceneSnapshot.selectedName) &&
    !sceneSnapshot.isMoving &&
    sceneSnapshot.action !== 'combine';
  const exportDisabled = objectCount === 0 || exportState.status === 'working';
  const exportMessage = exportState.message ||
    (objectCount === 0
      ? 'Create an object before exporting.'
      : `${objectCount} object${objectCount === 1 ? '' : 's'} ready to export.`);

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
            className={`object-status ${deleteNotice ? 'command-delete' : sceneSnapshot.notice ? `command-${sceneSnapshot.action}` : ''}`}
            role="status"
            aria-live="polite"
          >
            <strong>{sceneStatus}</strong>
          </div>
          <p className="hint">{actionHint}</p>
          {sceneSnapshot.selectedName && (
            <div className="selected-name">{sceneSnapshot.selectedName}</div>
          )}
          <div className="selection-actions">
            <button
              type="button"
              className="delete-button"
              disabled={!canDelete}
              aria-keyshortcuts="Delete Backspace"
              onClick={handleDeleteSelected}
            >
              <span>Delete object</span>
              <kbd aria-hidden="true">Del</kbd>
            </button>
          </div>
        </section>

        <section className="property-section export-section">
          <div className="section-heading">Export</div>
          <div className="export-actions">
            <button
              type="button"
              className="export-button export-primary"
              disabled={exportDisabled}
              onClick={() => void handleExport('stl')}
            >
              Export STL
            </button>
            <div className="export-secondary">
              <button
                type="button"
                className="export-button"
                disabled={exportDisabled}
                onClick={() => void handleExport('obj')}
              >
                Export OBJ
              </button>
              <button
                type="button"
                className="export-button"
                disabled={exportDisabled}
                onClick={() => void handleExport('glb')}
              >
                Export GLB
              </button>
            </div>
          </div>
          <p className="hint export-hint">
            STL joins overlaps and verifies closed solids before downloading.
          </p>
          <div
            className={`export-status export-${exportState.status}`}
            role="status"
            aria-live="polite"
          >
            {exportMessage}
          </div>
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
    case 'transform':
      return gestureActive
        ? 'Move both hands together to place it, spread to resize, or turn the hand-to-hand line to rotate.'
        : 'Pinch the same object with both hands to move, resize, and rotate it.';
    case 'rotate':
      if (mouseActive) return 'Drag sideways to spin or vertically to tilt.';
      return 'Hold R and drag the object.';
    case 'scale':
      if (mouseActive) return 'Drag up to grow or down to shrink.';
      return 'Hold S and drag, or pinch the object with both hands.';
    case 'shape':
      if (mouseActive) return 'Drag up to stretch height or down to squash it.';
      return gestureActive
        ? `${snapshot.shapeAxis === 'X' ? 'Width' : 'Height'} is locked. Move up to stretch or down to squash.`
        : 'Hold the I-love-you gesture upright for height or sideways for width.';
    case 'move':
      if (mouseActive) return 'Drag to place the object on the current view plane.';
      return gestureActive
        ? 'Keep thumb and index pinched while you move. Separate them to release.'
        : 'Pinch directly on the object to grab it, or drag it with the mouse.';
    case 'create':
      return snapshot.notice
        ? 'Open Palm recognized. Relax your hand before creating another object.'
        : `Hold an open palm to create a ${PRIMITIVE_LABELS[primitiveType]} at your hand.`;
    case 'delete':
      return snapshot.selectedName
        ? 'Use Delete object or press Delete / Backspace.'
        : 'Select an object before deleting it.';
    case 'combine':
      return snapshot.notice?.endsWith('combined')
        ? 'Release both pinches before combining another pair.'
        : 'Pinch one overlapping object with each hand and hold.';
    default:
      return snapshot.selectedName
        ? 'Pinch it to move, pinch with both hands to transform, or press Delete to remove it.'
        : 'Pinch an object directly to grab it, or click it with the mouse.';
  }
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

function getSceneStatus(snapshot: SceneControllerSnapshot): string {
  if (snapshot.notice) return snapshot.notice;
  if (!snapshot.selectedName) return 'No object selected';
  if (!snapshot.isMoving) return 'Object selected';
  switch (snapshot.action) {
    case 'transform':
      return 'Transforming selected object';
    case 'rotate':
      return 'Rotating selected object';
    case 'scale':
      return 'Resizing selected object';
    case 'shape':
      return 'Shaping selected object';
    case 'combine':
      return 'Combining objects';
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
        {snapshot.action === 'transform' && (
          <>
            <span><b aria-hidden="true">✥</b> Move together to place</span>
            <span><b aria-hidden="true">↔</b> Spread to resize</span>
            <span><b aria-hidden="true">⟳</b> Turn the line to rotate</span>
          </>
        )}
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
          <span><b aria-hidden="true">✥</b> Keep pinching and move your hand</span>
        )}
      </div>
      <span className="coach-release">
        {snapshot.action === 'transform'
          ? 'Release one pinch for one-hand move, or both to finish'
          : snapshot.action === 'move'
            ? 'Separate thumb and index to release'
            : 'Relax your hand or lower it to finish'}
      </span>
    </section>
  );
}

function controlTitle(snapshot: SceneControllerSnapshot): string {
  switch (snapshot.action) {
    case 'transform':
      return 'Two-hand transform';
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
  if (snapshot.action === 'combine') {
    return {
      label: 'Combine',
      detail: snapshot.notice?.endsWith('combined')
        ? 'Release both pinches before combining again'
        : (snapshot.notice ?? 'Keep both pinches steady'),
      idle: false,
    };
  }
  if (snapshot.isMoving && snapshot.input === 'gesture') {
    return {
      label: controlTitle(snapshot),
      detail: snapshot.action === 'transform'
        ? 'Move together · spread · turn'
        : 'Keep pinching while you move',
      idle: false,
    };
  }
  if (numHands === 0) {
    return { label: 'No hand detected', detail: 'Show one hand to begin', idle: true };
  }
  if (currentGesture === 'None') {
    return { label: 'Hand detected', detail: 'Pinch an object to grab it', idle: true };
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
