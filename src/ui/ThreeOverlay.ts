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

interface ModelDef {
  glb: string;
  texture?: string;
  height?: number;
  tilt?: number;        // X-axis rotation in radians for board standing tilt (default -1.15)
  preRotateX?: number;  // X-axis pre-rotation to fix authoring orientation
  preRotateY?: number;  // Y-axis pre-rotation to fix authoring orientation
  facingOffset?: number; // Z-rotation offset for movement facing direction (default 0)
  offsetX?: number;     // X offset after centering (fix off-center models)
  offsetY?: number;     // Y offset after centering (fix off-center models)
}

const MODEL_CONFIG: Record<string, ModelDef> = {
  earth:        { glb: 'meeples/elemental_earth.glb',    texture: 'meeples/earth.png' },
  fire:         { glb: 'meeples/elemental_fire.glb',     texture: 'meeples/fire_meeple.png' },
  water:        { glb: 'meeples/elemental_water.glb',    texture: 'meeples/water_meeple.png', preRotateX: Math.PI / 2, offsetY: 10 },
  stone_minion: { glb: 'meeples/meeple_stoneminion.glb', texture: 'meeples/stone.png', height: 60, preRotateX: Math.PI / 2 },
};

const TOKEN_MODEL_CONFIG: Record<string, ModelDef> = {
  fog:      { glb: 'meeples/meeple_fog.glb', texture: 'meeples/fog.png', height: 35, preRotateX: Math.PI / 2 },
  mountain: { glb: 'meeples/mountain.glb',   height: 50, preRotateX: Math.PI / 2 },
};

interface ModelEntry {
  pivot: THREE.Group;
  pendingHexId: HexId | null;
  facingOffset: number; // Z-rotation offset for movement direction
}

interface TokenModelTemplate {
  scene: THREE.Group;         // loaded original scene to clone from
  targetHeight: number;
  tilt: number;
  preRotateX: number;
  preRotateY: number;
}

interface TokenModelInstances {
  template: TokenModelTemplate | null;  // null while loading
  instances: Map<HexId, THREE.Group>;   // hex → cloned pivot on the scene
  pendingHexIds: HexId[] | null;        // queued positions while template loads
}

export class ThreeOverlay {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private models: Map<string, ModelEntry> = new Map();
  private tokenModels: Map<string, TokenModelInstances> = new Map();
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

    // Load all configured singleton models
    for (const [type, config] of Object.entries(MODEL_CONFIG)) {
      this.loadModel(type, config);
    }

    // Load all configured token models (multi-instance)
    for (const [type, config] of Object.entries(TOKEN_MODEL_CONFIG)) {
      this.loadTokenModel(type, config);
    }

    this.animate();
  }

  private updateSize() {
    const rect = this.container.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
  }

  private applyTextureToModel(model: THREE.Group, texture: THREE.Texture) {
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
  }

  private scaleAndPivotModel(model: THREE.Group, targetHeight: number, tilt = -1.15, preRotateX = 0, preRotateY = 0, offsetX = 0, offsetY = 0): THREE.Group {
    // Apply pre-rotation to fix authoring orientation before anything else
    if (preRotateX !== 0) model.rotation.x = preRotateX;
    if (preRotateY !== 0) model.rotation.y = preRotateY;
    if (preRotateX !== 0 || preRotateY !== 0) model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);

    const scale = targetHeight / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(scale);

    const pivot = new THREE.Group();
    const innerGroup = new THREE.Group();

    const boxScaled = new THREE.Box3().setFromObject(model);
    const scaledCenter = new THREE.Vector3();
    boxScaled.getCenter(scaledCenter);
    model.position.set(-scaledCenter.x + offsetX, -scaledCenter.y + offsetY, -scaledCenter.z);

    innerGroup.add(model);
    innerGroup.rotation.x = tilt;
    pivot.add(innerGroup);
    return pivot;
  }

  private loadModel(type: string, def: ModelDef) {
    const loader = new GLTFLoader();
    const entry: ModelEntry = { pivot: null!, pendingHexId: null, facingOffset: def.facingOffset ?? Math.PI };
    this.models.set(type, entry);
    const height = def.height ?? 80;
    const tilt = def.tilt ?? -1.15;
    const preRotateX = def.preRotateX ?? 0;
    const preRotateY = def.preRotateY ?? 0;
    const offsetX = def.offsetX ?? 0;
    const offsetY = def.offsetY ?? 0;

    const onModelLoaded = (model: THREE.Group) => {
      const pivot = this.scaleAndPivotModel(model, height, tilt, preRotateX, preRotateY, offsetX, offsetY);
      this.scene.add(pivot);
      entry.pivot = pivot;
      if (entry.pendingHexId !== null) {
        this.setPosition(type, entry.pendingHexId);
      }
    };

    if (def.texture) {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(def.texture, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        loader.load(def.glb, (gltf) => {
          this.applyTextureToModel(gltf.scene, texture);
          onModelLoaded(gltf.scene);
        });
      });
    } else {
      loader.load(def.glb, (gltf) => {
        onModelLoaded(gltf.scene);
      });
    }
  }

  private loadTokenModel(type: string, def: ModelDef) {
    const loader = new GLTFLoader();
    const instances: TokenModelInstances = { template: null, instances: new Map(), pendingHexIds: null };
    this.tokenModels.set(type, instances);
    const height = def.height ?? 50;
    const tilt = def.tilt ?? -1.15;
    const preRotateX = def.preRotateX ?? 0;
    const preRotateY = def.preRotateY ?? 0;

    const onLoaded = (scene: THREE.Group) => {
      instances.template = { scene, targetHeight: height, tilt, preRotateX, preRotateY };
      // Apply any pending positions that were set before loading finished
      if (instances.pendingHexIds) {
        this.setTokenPositions(type, instances.pendingHexIds);
        instances.pendingHexIds = null;
      }
    };

    if (def.texture) {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(def.texture, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        loader.load(def.glb, (gltf) => {
          this.applyTextureToModel(gltf.scene, texture);
          onLoaded(gltf.scene);
        });
      });
    } else {
      loader.load(def.glb, (gltf) => {
        onLoaded(gltf.scene);
      });
    }
  }

  /** Check if a given type has a singleton 3D model */
  hasModel(type: string): boolean {
    return type in MODEL_CONFIG;
  }

  /** Check if a given token type has a multi-instance 3D model */
  hasTokenModel(type: string): boolean {
    return type in TOKEN_MODEL_CONFIG;
  }

  /** Sync token model instances to match the given hex positions */
  setTokenPositions(type: string, hexIds: HexId[]) {
    const entry = this.tokenModels.get(type);
    if (!entry) return;

    // Template not loaded yet — queue for later
    if (!entry.template) {
      entry.pendingHexIds = hexIds;
      return;
    }

    const currentHexes = new Set(entry.instances.keys());
    const targetHexes = new Set(hexIds);

    // Remove instances no longer needed
    for (const hexId of currentHexes) {
      if (!targetHexes.has(hexId)) {
        const pivot = entry.instances.get(hexId)!;
        this.scene.remove(pivot);
        entry.instances.delete(hexId);
      }
    }

    // Add new instances
    const { scene, targetHeight, tilt, preRotateX, preRotateY } = entry.template;
    for (const hexId of targetHexes) {
      if (!currentHexes.has(hexId)) {
        const clone = scene.clone(true);
        const pivot = this.scaleAndPivotModel(clone, targetHeight, tilt, preRotateX, preRotateY);
        const pos = getPixelPos(hexId);
        pivot.position.x = pos.x;
        pivot.position.y = VB_H - pos.y;
        this.scene.add(pivot);
        entry.instances.set(hexId, pivot);
      }
    }
  }

  /** Position a singleton model at a hex */
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
    // Normalize to shortest rotation path
    let delta = to - from;
    delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const normalizedTo = from + delta;

    return new Promise(resolve => {
      const startTime = performance.now();
      const tick = () => {
        const t = Math.min((performance.now() - startTime) / ms, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        pivot.rotation.z = from + (normalizedTo - from) * ease;
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
          pivot.rotation.z = 0; // Reset to exact 0 to prevent drift
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
        const turnAngle = Math.atan2(-dx, dy) + entry.facingOffset;

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

  /** Animate a token model instance from one hex to another with turn-move-turn */
  async animateTokenMove(type: string, fromHex: HexId, toHex: HexId): Promise<void> {
    const entry = this.tokenModels.get(type);
    if (!entry) return;
    const pivot = entry.instances.get(fromHex);
    if (!pivot) return;

    const fromPos = getPixelPos(fromHex);
    const toPos = getPixelPos(toHex);
    const startX = fromPos.x;
    const startY = VB_H - fromPos.y;
    const endX = toPos.x;
    const endY = VB_H - toPos.y;

    // Re-key the instance to the new hex
    entry.instances.delete(fromHex);
    entry.instances.set(toHex, pivot);

    const MOVE_MS = 350;
    const TURN_MS = 150;

    // Turn to face destination
    const dx = endX - startX;
    const dy = endY - startY;
    const turnAngle = Math.atan2(-dx, dy) + Math.PI;
    await this.animateRotation(pivot, pivot.rotation.z, turnAngle, TURN_MS);

    // Move
    await new Promise<void>(resolve => {
      const startTime = performance.now();
      const lerp = () => {
        const t = Math.min((performance.now() - startTime) / MOVE_MS, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        pivot.position.x = startX + (endX - startX) * ease;
        pivot.position.y = startY + (endY - startY) * ease;
        if (t < 1) requestAnimationFrame(lerp);
        else resolve();
      };
      requestAnimationFrame(lerp);
    });

    // Turn back to face camera
    await this.animateRotation(pivot, pivot.rotation.z, 0, TURN_MS);
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
