import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GestureCursor } from './GestureCursor';
import { ObjectStore } from './ObjectStore';

/**
 * Owns the Three.js scene, camera, renderer, lights, ground grid, and the
 * animation loop. React never touches the scene graph on the hot path; it
 * only mounts the renderer canvas and reads high-level state (selection,
 * gesture) via the callbacks and refs exposed here.
 *
 * The gesture→action state machine is wired in by SceneController (added in
 * M2) which calls into this manager each frame via `onBeforeRender`.
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver | null;
  private rafId = 0;
  private disposed = false;

  /** Per-frame hook set by the controller — runs before each render(). */
  onBeforeRender: ((delta: number, elapsed: number) => void) | null = null;

  /** A group holding all user-created objects, separate from grid/lights. */
  readonly objects: THREE.Group;
  readonly objectStore: ObjectStore;
  readonly gestureCursor: GestureCursor;

  /** True while pointer modeling input owns the scene interaction lock. */
  mouseInteractionActive = false;

  constructor(canvas: HTMLCanvasElement) {
    // Renderer ------------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(1, 1, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Scene --------------------------------------------------------------
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c12);
    this.scene.fog = new THREE.Fog(0x0a0c12, 18, 48);

    // Camera -------------------------------------------------------------
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.camera.position.set(7, 6, 9);
    this.camera.lookAt(0, 0, 0);

    // Controls (mouse orbit — fallback when not gesturing) ---------------
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.mouseButtons.LEFT = null;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = Math.PI * 0.49; // keep above the floor
    this.controls.target.set(0, 0.5, 0);

    this.objects = new THREE.Group();
    this.objects.name = 'objects';
    this.scene.add(this.objects);
    this.objectStore = new ObjectStore(this.objects);
    this.gestureCursor = new GestureCursor(this.scene);

    this.setupLights();
    this.setupEnvironment();

    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resizeToCanvas());
      this.resizeObserver.observe(canvas);
    } else {
      this.resizeObserver = null;
    }
    this.resizeToCanvas();
  }

  private resizeToCanvas(): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private setupLights(): void {
    // Key light — warm, casts shadows.
    const key = new THREE.DirectionalLight(0xfff1d6, 2.4);
    key.position.set(8, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    // Fill light — cool, no shadows.
    const fill = new THREE.DirectionalLight(0x9ec7ff, 0.6);
    fill.position.set(-6, 4, -8);
    this.scene.add(fill);

    // Ambient bounce.
    this.scene.add(new THREE.HemisphereLight(0x4a5568, 0x1a202c, 0.55));
  }

  private setupEnvironment(): void {
    // Ground grid — the modeling "table".
    const grid = new THREE.GridHelper(40, 40, 0x2a3344, 0x1a2030);
    grid.position.y = 0;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(grid);

    // Shadow-catching floor plane.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Axes gizmo at the origin, subtle.
    const axes = new THREE.AxesHelper(1.2);
    (axes.material as THREE.Material).depthTest = false;
    axes.renderOrder = 999;
    this.scene.add(axes);
  }

  /** Drop a test box so the viewport isn't empty before M2. */
  addTestBox(): void {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.4, 1.4),
      new THREE.MeshStandardMaterial({
        color: 0x4fd1c5,
        roughness: 0.4,
        metalness: 0.15,
      }),
    );
    box.position.set(0, 0.7, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    box.name = 'test-box';
    this.objectStore.add(box);
  }

  start(): void {
    if (this.rafId) return;
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(loop);
      const delta = this.clock.getDelta();
      const elapsed = this.clock.elapsedTime;
      this.controls.update();
      this.onBeforeRender?.(delta, elapsed);
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private handleResize = (): void => {
    this.resizeToCanvas();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.objectStore.dispose();
    this.gestureCursor.dispose();
    this.onBeforeRender = null;
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    // Traverse and dispose geometries/materials.
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
