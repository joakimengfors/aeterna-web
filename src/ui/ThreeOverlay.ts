// ========================================
// Three.js 3D Model Overlay for Board
// ========================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { HexId, ElementalType } from '../game/types';
import { getPixelPos } from '../game/HexGrid';

// SVG viewBox dimensions
const VB_W = 628;
const VB_H = 700;

const MODEL_CONFIG: Record<string, { glb: string; texture: string }> = {
  earth: { glb: 'meeples/elemental_earth.glb', texture: 'meeples/earth.png' },
  fire:  { glb: 'meeples/elemental_fire.glb',  texture: 'meeples/fire_meeple.png' },
};

interface ModelEntry {
  pivot: THREE.Group;
  pendingHexId: HexId | null;
}

export class ThreeOverlay {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private models: Map<string, ModelEntry> = new Map();
  private canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private animationId = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.canvas = this.renderer.domElement;
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '2';

    const svg = container.querySelector('svg');
    if (svg) {
      svg.insertAdjacentElement('afterend', this.canvas);
    } else {
      container.appendChild(this.canvas);
    }

    this.camera = new THREE.OrthographicCamera(0, VB_W, VB_H, 0, -500, 1000);
    this.camera.position.set(0, 0, 500);

    this.scene = new THREE.Scene();

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(300, 400, 500);
    this.scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-200, 200, 300);
    this.scene.add(fillLight);

    this.updateSize();
    window.addEventListener('resize', () => this.updateSize());

    // Load all configured models
    for (const [type, config] of Object.entries(MODEL_CONFIG)) {
      this.loadModel(type, config.glb, config.texture);
    }

    this.animate();
  }

  private updateSize() {
    const rect = this.container.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
  }

  private loadModel(type: string, glbPath: string, texturePath: string) {
    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();

    // Store a pending entry so setPosition can queue before load completes
    const entry: ModelEntry = { pivot: null!, pendingHexId: null };
    this.models.set(type, entry);

    textureLoader.load(texturePath, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;

      loader.load(glbPath, (gltf) => {
        const model = gltf.scene;

        // Apply texture
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.material = new THREE.MeshStandardMaterial({
              map: texture,
              metalness: 0.1,
              roughness: 0.7,
            });
          }
        });

        // Measure and scale
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        const targetHeight = 80;
        const scale = targetHeight / Math.max(size.x, size.y, size.z);
        model.scale.setScalar(scale);

        // Create pivot with inner group for the standing tilt
        const pivot = new THREE.Group();
        const innerGroup = new THREE.Group();

        // Center model at origin
        const boxScaled = new THREE.Box3().setFromObject(model);
        const scaledCenter = new THREE.Vector3();
        boxScaled.getCenter(scaledCenter);
        model.position.set(-scaledCenter.x, -scaledCenter.y, -scaledCenter.z);

        innerGroup.add(model);

        // Tilt the model forward on X so it looks like it's standing on the board
        // seen from above. ~65deg tilt gives a good "standing on table" look.
        innerGroup.rotation.x = -1.15; // ~66 degrees

        pivot.add(innerGroup);
        this.scene.add(pivot);
        entry.pivot = pivot;

        // Apply pending position
        if (entry.pendingHexId !== null) {
          this.setPosition(type, entry.pendingHexId);
        }
      });
    });
  }

  /** Check if a given elemental type has a 3D model */
  hasModel(type: ElementalType): boolean {
    return type in MODEL_CONFIG;
  }

  /** Position a model at a hex */
  setPosition(type: string, hexId: HexId) {
    const entry = this.models.get(type);
    if (!entry) return;
    entry.pendingHexId = hexId;
    if (!entry.pivot) return;
    const pos = getPixelPos(hexId);
    entry.pivot.position.x = pos.x;
    entry.pivot.position.y = VB_H - pos.y;
  }

  /** Animate a Z-rotation on a pivot (spin on the board plane) */
  private animateRotation(pivot: THREE.Group, from: number, to: number, ms: number): Promise<void> {
    return new Promise(resolve => {
      const startTime = performance.now();
      const tick = () => {
        const t = Math.min((performance.now() - startTime) / ms, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        pivot.rotation.z = from + (to - from) * ease;
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  /** Animate a model along a path with turn-move-turn */
  animateAlongPath(type: string, path: HexId[]): Promise<void> {
    const entry = this.models.get(type);
    if (!entry?.pivot || path.length === 0) return Promise.resolve();

    const pivot = entry.pivot;
    const positions = path.map(hexId => {
      const pos = getPixelPos(hexId);
      return { x: pos.x, y: VB_H - pos.y };
    });

    const MS_PER_HEX = 260;
    const TURN_MS = 200;

    return new Promise(resolve => {
      let step = 0;

      pivot.position.x = positions[0].x;
      pivot.position.y = positions[0].y;

      const advance = async () => {
        step++;
        if (step >= positions.length) {
          // Turn back to face camera
          await this.animateRotation(pivot, pivot.rotation.z, 0, TURN_MS);
          resolve();
          return;
        }

        const startX = pivot.position.x;
        const startY = pivot.position.y;
        const endX = positions[step].x;
        const endY = positions[step].y;

        // Rotate on Z so the model's front faces the destination
        const dx = endX - startX;
        const dy = endY - startY;
        // +PI so the front (not the back) points toward the destination
        const turnAngle = Math.atan2(-dx, dy) + Math.PI;

        await this.animateRotation(pivot, pivot.rotation.z, turnAngle, TURN_MS);

        // Move
        await new Promise<void>(moveResolve => {
          const startTime = performance.now();
          const lerp = () => {
            const t = Math.min((performance.now() - startTime) / MS_PER_HEX, 1);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            pivot.position.x = startX + (endX - startX) * ease;
            pivot.position.y = startY + (endY - startY) * ease;
            if (t < 1) requestAnimationFrame(lerp);
            else moveResolve();
          };
          requestAnimationFrame(lerp);
        });

        advance();
      };

      advance();
    });
  }

  private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
