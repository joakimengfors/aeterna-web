// ========================================
// SVG Board Renderer
// ========================================

import type { GameState } from '../game/GameState';
import type { HexId, ElementalType, TokenType } from '../game/types';
import { ALL_HEX_IDS, getPixelPos, isShore } from '../game/HexGrid';
import { ThreeOverlay } from './ThreeOverlay';

const HEX_POINTS = '0,-45.5 39.4,-22.7 39.4,22.7 0,45.5 -39.4,22.7 -39.4,-22.8';

const TOKEN_IMAGES: Record<TokenType, string> = {
  mountain: 'assets/tokens/mountain.png',
  forest: 'assets/tokens/forest-token.png',
  fire: 'assets/tokens/fire-token.png',
  lake: 'assets/tokens/lake-token.png',
  fog: 'assets/tokens/fog.png',
};

const ELEMENTAL_IMAGES: Record<ElementalType, string> = {
  earth: 'assets/meeples/earth-elemental.png',
  water: 'assets/meeples/water-elemental.png',
  fire: 'assets/meeples/fire-elemental.png',
};

const ELEMENTAL_NAMES: Record<ElementalType, string> = {
  earth: 'KAIJOM',
  water: 'NITSUJI',
  fire: 'KRAKATOA',
};

export class BoardRenderer {
  private svg!: SVGSVGElement;
  private hexElements: Map<HexId, SVGGElement> = new Map();
  private tokenLayer!: SVGGElement;
  private standeeLayer!: SVGGElement;
  private highlightLayer!: SVGGElement;
  private standeeContainer!: HTMLElement;
  private threeOverlay!: ThreeOverlay;
  private onHexClick: ((hexId: HexId) => void) | null = null;
  // Track tokens per hex for spawn animation detection
  private previousTokens: Map<HexId, string[]> = new Map();
  // Track recently spawned tokens so re-renders within animation window still animate
  private spawnedTokens: Map<string, number> = new Map(); // "hexId:token" -> timestamp

  constructor(private container: HTMLElement) {
    this.createSVG();
  }

  private createSVG() {
    this.container.innerHTML = `
      <div class="map-container">
        <svg class="hex-grid" viewBox="0 0 628 700" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="glow-earth"><feGaussianBlur stdDeviation="4" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter>
            <filter id="glow-water"><feGaussianBlur stdDeviation="4" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter>
            <filter id="glow-fire"><feGaussianBlur stdDeviation="4" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter>
            <clipPath id="clip-standee"><circle cx="0" cy="0" r="20"/></clipPath>
            <clipPath id="clip-token-lg"><circle cx="0" cy="0" r="28.8"/></clipPath>
            <clipPath id="clip-token-md"><circle cx="0" cy="0" r="25.2"/></clipPath>
            <clipPath id="clip-token-sm"><circle cx="0" cy="0" r="18"/></clipPath>
            <clipPath id="clip-token-mountain"><circle cx="0" cy="0" r="32.4"/></clipPath>
          </defs>
          <g id="hex-layer"></g>
          <g id="highlight-layer"></g>
          <g id="token-layer"></g>
          <g id="standee-layer"></g>
        </svg>
        <div class="standee-overlay" id="standee-overlay"></div>
      </div>
      <div class="map-ocean-glow"></div>
    `;

    this.svg = this.container.querySelector('svg')!;
    const hexLayer = this.svg.querySelector('#hex-layer')!;
    this.highlightLayer = this.svg.querySelector('#highlight-layer') as SVGGElement;
    this.tokenLayer = this.svg.querySelector('#token-layer') as SVGGElement;
    this.standeeLayer = this.svg.querySelector('#standee-layer') as SVGGElement;
    this.standeeContainer = this.container.querySelector('#standee-overlay') as HTMLElement;

    // Create hex cells
    for (const id of ALL_HEX_IDS) {
      const pos = getPixelPos(id);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.classList.add('hex-cell');
      if (isShore(id)) g.classList.add('shore');
      g.setAttribute('data-hex', String(id));
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);

      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', HEX_POINTS);
      g.appendChild(polygon);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.classList.add('hex-number');
      text.setAttribute('y', '5');
      text.textContent = String(id);
      g.appendChild(text);

      g.addEventListener('click', () => {
        if (this.onHexClick) this.onHexClick(id);
      });

      hexLayer.appendChild(g);
      this.hexElements.set(id, g);
    }

    // Initialize Three.js overlay for 3D models
    const mapContainer = this.container.querySelector('.map-container') as HTMLElement;
    if (mapContainer) {
      this.threeOverlay = new ThreeOverlay(mapContainer);
    }
  }

  getStandeeContainer(): HTMLElement {
    return this.standeeContainer;
  }

  setHexClickHandler(handler: (hexId: HexId) => void) {
    this.onHexClick = handler;
  }

  render(state: GameState) {
    this.renderStandees(state);
    this.renderTokens(state);
  }

  private renderTokens(state: GameState) {
    this.tokenLayer.innerHTML = '';
    // Clear standing token containers (fog/mountain go in standee overlay)
    this.standeeContainer.querySelectorAll('.token-standee').forEach(el => el.remove());

    const newTokens = new Map<HexId, string[]>();
    const fogHexIds: HexId[] = [];
    const mountainHexIds: HexId[] = [];

    for (const id of ALL_HEX_IDS) {
      const hex = state.getHex(id);
      const pos = getPixelPos(id);
      newTokens.set(id, [...hex.tokens]);
      const prevTokens = this.previousTokens.get(id) ?? [];

      for (const token of hex.tokens) {
        const spawnKey = `${id}:${token}`;
        const spawnTime = this.spawnedTokens.get(spawnKey);
        const isNew = !prevTokens.includes(token) || (spawnTime !== undefined && Date.now() - spawnTime < 700);
        if (isNew && !spawnTime) {
          this.spawnedTokens.set(spawnKey, Date.now());
        }

        // Fog and mountain: use 3D models if available, else HTML standee
        if (token === 'fog' || token === 'mountain') {
          if (this.threeOverlay?.hasTokenModel(token)) {
            if (token === 'fog') fogHexIds.push(id);
            else mountainHexIds.push(id);
            // Still render the SVG shadow
            this.renderTokenShadow(token, pos);
          } else {
            this.renderTokenStandee(token, pos, id, hex.tokens, isNew);
          }
          continue;
        }

        const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttribute('href', TOKEN_IMAGES[token]);
        img.classList.add('hex-token');
        if (isNew) {
          img.classList.add('token-spawn');
          img.style.setProperty('--tx', `${pos.x}px`);
          img.style.setProperty('--ty', `${pos.y}px`);
        }

        const size = token === 'fire' ? 50.4 : 57.6;
        const half = size / 2;
        img.setAttribute('x', String(-half));
        img.setAttribute('y', String(-half));
        img.setAttribute('width', String(size));
        img.setAttribute('height', String(size));
        if (!isNew) {
          img.setAttribute('transform', `translate(${pos.x},${pos.y})`);
        }
        img.setAttribute('clip-path', token === 'fire' ? 'url(#clip-token-md)' : 'url(#clip-token-lg)');

        this.tokenLayer.appendChild(img);
      }
    }

    // Clean up expired spawn entries
    const now = Date.now();
    for (const [key, time] of this.spawnedTokens) {
      if (now - time >= 700) this.spawnedTokens.delete(key);
    }

    this.previousTokens = newTokens;

    // Sync 3D token model instances
    if (this.threeOverlay?.hasTokenModel('fog')) {
      this.threeOverlay.setTokenPositions('fog', fogHexIds);
    }
    if (this.threeOverlay?.hasTokenModel('mountain')) {
      this.threeOverlay.setTokenPositions('mountain', mountainHexIds);
    }
  }

  private renderTokenShadow(token: TokenType, pos: { x: number; y: number }) {
    const isFog = token === 'fog';
    const shadowRx = isFog ? 10 : 16;
    const shadowRy = isFog ? 5 : 7;
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    shadow.setAttribute('cx', String(pos.x));
    shadow.setAttribute('cy', String(pos.y + 6));
    shadow.setAttribute('rx', String(shadowRx));
    shadow.setAttribute('ry', String(shadowRy));
    shadow.setAttribute('fill', 'rgba(0,0,0,0.35)');
    shadow.style.pointerEvents = 'none';
    this.tokenLayer.appendChild(shadow);
  }

  private renderTokenStandee(token: TokenType, pos: { x: number; y: number }, hexId: HexId, allTokens: TokenType[], isNew: boolean) {
    // Shadow on the board (SVG)
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    const isFog = token === 'fog';
    const shadowRx = isFog ? 10 : 16;
    const shadowRy = isFog ? 5 : 7;
    const offsetX = 0;
    shadow.setAttribute('cx', String(pos.x + offsetX));
    shadow.setAttribute('cy', String(pos.y + 6));
    shadow.setAttribute('rx', String(shadowRx));
    shadow.setAttribute('ry', String(shadowRy));
    shadow.setAttribute('fill', 'rgba(0,0,0,0.35)');
    shadow.style.pointerEvents = 'none';
    this.tokenLayer.appendChild(shadow);

    // HTML standing piece
    const el = document.createElement('div');
    el.className = `standee-3d token-standee token-standee-${token}`;
    el.setAttribute('data-hex', String(hexId));
    if (isNew) el.classList.add('token-spawn');
    el.style.left = `${((pos.x + offsetX) / 628) * 100}%`;
    el.style.top = `${(pos.y / 700) * 100}%`;

    if (isFog) {
      el.innerHTML = `
        <div class="standee-figure standee-figure-fog">
          <img src="${TOKEN_IMAGES.fog}" alt="Fog">
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="standee-figure standee-figure-mountain">
          <img src="${TOKEN_IMAGES.mountain}" alt="Mountain">
        </div>
      `;
    }

    this.standeeContainer.appendChild(el);
  }

  private renderStandees(state: GameState) {
    this.standeeLayer.innerHTML = '';
    this.standeeContainer.innerHTML = '';

    const COLORS: Record<ElementalType, { primary: string; glow: string }> = {
      earth: { primary: '#4caf50', glow: 'rgba(76, 175, 80, 0.5)' },
      water: { primary: '#29b6f6', glow: 'rgba(41, 182, 246, 0.5)' },
      fire: { primary: '#ff7043', glow: 'rgba(255, 112, 67, 0.5)' },
    };

    // Standees are inside a foreignObject matching the SVG viewBox (628x700),
    // so we position them directly using viewBox pixel coordinates.

    for (const type of ['earth', 'water', 'fire'] as ElementalType[]) {
      const player = state.getPlayer(type);
      const pos = getPixelPos(player.hexId);
      const c = COLORS[type];

      // Shadow on the board (SVG ellipse)
      const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      shadow.setAttribute('cx', String(pos.x));
      shadow.setAttribute('cy', String(pos.y + 8));
      shadow.setAttribute('rx', '18');
      shadow.setAttribute('ry', '8');
      shadow.setAttribute('fill', 'rgba(0,0,0,0.45)');
      shadow.setAttribute('filter', 'url(#glow-earth)');
      shadow.style.pointerEvents = 'none';
      this.standeeLayer.appendChild(shadow);

      // Use 3D model if available
      if (this.threeOverlay?.hasModel(type)) {
        this.threeOverlay.setPosition(type, player.hexId);
        continue;
      }

      // HTML standee fallback
      const el = document.createElement('div');
      el.className = `standee-3d standee-${type}`;
      el.style.left = `${(pos.x / 628) * 100}%`;
      el.style.top = `${(pos.y / 700) * 100}%`;
      el.innerHTML = `
        <div class="standee-figure">
          <img src="${ELEMENTAL_IMAGES[type]}" alt="${ELEMENTAL_NAMES[type]}">
          <div class="standee-border" style="--standee-color: ${c.primary}; --standee-glow: ${c.glow};"></div>
        </div>
        <div class="standee-name-tag" style="--standee-color: ${c.primary};">${ELEMENTAL_NAMES[type]}</div>
      `;
      this.standeeContainer.appendChild(el);
    }

    // Stone Minion
    const minionHex = state.getStoneMinionHex();
    if (minionHex !== null) {
      const pos = getPixelPos(minionHex);

      const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      shadow.setAttribute('cx', String(pos.x));
      shadow.setAttribute('cy', String(pos.y + 6));
      shadow.setAttribute('rx', '14');
      shadow.setAttribute('ry', '6');
      shadow.setAttribute('fill', 'rgba(0,0,0,0.4)');
      shadow.style.pointerEvents = 'none';
      this.standeeLayer.appendChild(shadow);

      if (this.threeOverlay?.hasModel('stone_minion')) {
        this.threeOverlay.setPosition('stone_minion', minionHex);
      } else {
        const el = document.createElement('div');
        el.className = 'standee-3d standee-minion';
        el.style.left = `${(pos.x / 628) * 100}%`;
        el.style.top = `${(pos.y / 700) * 100}%`;
        el.innerHTML = `
          <div class="standee-figure standee-figure-sm">
            <img src="assets/meeples/stone-minion.png" alt="Stone Minion">
            <div class="standee-border" style="--standee-color: #78909c; --standee-glow: rgba(120,144,156,0.4);"></div>
          </div>
          <div class="standee-name-tag" style="--standee-color: #78909c;">MINION</div>
        `;
        this.standeeContainer.appendChild(el);
      }
    }
  }

  // ==========================================
  // Highlighting
  // ==========================================

  clearHighlights() {
    this.highlightLayer.innerHTML = '';
    for (const g of this.hexElements.values()) {
      g.classList.remove('valid-target', 'selected', 'dimmed', 'path', 'danger', 'blocked');
    }
  }

  highlightValidTargets(hexIds: HexId[], currentTheme: ElementalType) {
    this.clearHighlights();

    // Dim all hexes
    for (const [id, g] of this.hexElements) {
      if (!hexIds.includes(id)) {
        g.classList.add('dimmed');
      }
    }

    // Highlight valid targets
    for (const id of hexIds) {
      const g = this.hexElements.get(id);
      if (g) {
        g.classList.add('valid-target');

        // Draw rising wall effect in highlight layer
        const pos = getPixelPos(id);
        const wallLayers = 6;
        for (let i = 1; i <= wallLayers; i++) {
          const wall = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          wall.setAttribute('points', HEX_POINTS);
          wall.setAttribute('transform', `translate(${pos.x},${pos.y - i * 2.5})`);
          const opacity = 0.7 - (i / wallLayers) * 0.5;
          wall.setAttribute('fill', 'none');
          wall.setAttribute('stroke', `rgba(255, 255, 255, ${opacity})`);
          wall.setAttribute('stroke-width', '2');
          wall.classList.add('hex-wall');
          wall.style.pointerEvents = 'none';
          this.highlightLayer.appendChild(wall);
        }
      }
    }
  }

  highlightSelected(hexId: HexId) {
    const g = this.hexElements.get(hexId);
    if (g) {
      g.classList.remove('valid-target', 'dimmed');
      g.classList.add('selected');
    }
  }

  /**
   * Animate a standee (elemental or minion) along a path of hex IDs.
   * Returns a promise that resolves when the animation is complete.
   */
  animateStandee(type: ElementalType | 'minion', path: HexId[]): Promise<void> {
    if (path.length === 0) return Promise.resolve();

    // Use Three.js animation for 3D models
    if (type === 'minion' && this.threeOverlay?.hasModel('stone_minion')) {
      return this.threeOverlay.animateAlongPath('stone_minion', path);
    }
    if (type !== 'minion' && this.threeOverlay?.hasModel(type)) {
      return this.threeOverlay.animateAlongPath(type, path);
    }

    const selector = type === 'minion' ? '.standee-minion' : `.standee-${type}`;
    const el = this.standeeContainer.querySelector(selector) as HTMLElement | null;
    if (!el) return Promise.resolve();

    const positions = path.map(hexId => {
      const pos = getPixelPos(hexId);
      return {
        left: `${(pos.x / 628) * 100}%`,
        top: `${(pos.y / 700) * 100}%`,
      };
    });

    const MS_PER_HEX = 260;

    return new Promise(resolve => {
      let step = 0;

      // Position at first waypoint
      el.style.transition = 'none';
      el.style.left = positions[0].left;
      el.style.top = positions[0].top;
      el.offsetHeight; // force reflow

      const advance = () => {
        step++;
        if (step >= positions.length) {
          el.style.transition = '';
          resolve();
          return;
        }
        el.style.transition = `left ${MS_PER_HEX}ms ease-in-out, top ${MS_PER_HEX}ms ease-in-out`;
        el.style.left = positions[step].left;
        el.style.top = positions[step].top;
        setTimeout(advance, MS_PER_HEX);
      };

      advance();
    });
  }

  /**
   * Animate a token (fog) from one hex to another via 3D overlay.
   * Returns a promise that resolves when done. Falls back to instant if no 3D model.
   */
  animateTokenMove(type: string, fromHex: HexId, toHex: HexId): Promise<void> {
    if (this.threeOverlay?.hasTokenModel(type)) {
      return this.threeOverlay.animateTokenMove(type, fromHex, toHex);
    }
    return Promise.resolve();
  }

  highlightDanger(hexIds: HexId[]) {
    for (const id of hexIds) {
      const g = this.hexElements.get(id);
      if (g) {
        g.classList.remove('dimmed');
        g.classList.add('danger');
      }
    }
  }
}
