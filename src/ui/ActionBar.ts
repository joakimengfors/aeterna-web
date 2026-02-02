// ========================================
// Action Bar (Bottom panel)
// ========================================
// Two-phase layout matching the UX mockup:
// Phase 1: Start of Turn card with Use/Skip
// Phase 2: Action cards grid with Confirm/Undo

import type { GameState } from '../game/GameState';
import type { ActionId, ElementalType } from '../game/types';
import { getActionsForElemental } from '../game/types';

const ELEMENTAL_NAMES: Record<ElementalType, string> = {
  earth: 'Kaijom',
  water: 'Nitsuji',
  fire: 'Krakatoa',
};

const AVATAR_IMAGES: Record<ElementalType, string> = {
  earth: 'assets/characters/elementals_illustration (earth).png',
  water: 'assets/characters/elementals_illustration (water).png',
  fire: 'assets/characters/elementals_illustration (fire).png',
};

const MEEPLE_IMAGES: Record<ElementalType, string> = {
  earth: 'assets/meeples/earth-elemental.png',
  water: 'assets/meeples/water-elemental.png',
  fire: 'assets/meeples/fire-elemental.png',
};

const SOT_HTML: Record<ElementalType, string> = {
  earth: 'Move the <img class="token-inline" src="assets/meeples/stone-minion.png" alt="Stone Minion"> Stone Minion up to 1 hex. It can capture <img class="token-inline" src="assets/meeples/water-elemental.png" alt="Nitsuji"> Nitsuji.',
  water: 'Move <img class="token-inline" src="assets/meeples/water-elemental.png"> up to 1 hex <span class="or-text">or</span> teleport to any hex containing a <img class="token-inline" src="assets/tokens/lake-token.png"> or <img class="token-inline" src="assets/tokens/fog.png">.',
  fire: 'Place a <img class="token-inline" src="assets/tokens/fire-token.png"> under you <span class="or-text">or</span> place a <img class="token-inline" src="assets/tokens/fire-token.png"> on an empty hex next to an existing <img class="token-inline" src="assets/tokens/fire-token.png">.',
};

// Rich HTML descriptions for action cards (with inline token/meeple images)
const ACTION_HTML: Record<string, string> = {
  'uproot': '<img class="meeple-inline" src="assets/meeples/earth-elemental.png"> up to 3 hexes (or 4 if there is a <img class="token-inline" src="assets/tokens/forest-token.png"> on the board).',
  'raise-mountain': '<img class="meeple-inline" src="assets/meeples/earth-elemental.png"> up to 1 hex.<br><br>Place a <img class="token-inline" src="assets/tokens/mountain.png"> on any empty hex.',
  'landslide': '<img class="meeple-inline" src="assets/meeples/earth-elemental.png"> up to as many hexes as there are <img class="token-inline" src="assets/tokens/mountain.png"> in play.<br><br>Destroy a <img class="token-inline" src="assets/tokens/mountain.png"> and chain-destroy all adjacent tokens.',
  'sprout': 'Replace a <img class="token-inline" src="assets/tokens/lake-token.png"> adjacent to a <img class="token-inline" src="assets/tokens/forest-token.png"> with a <img class="token-inline" src="assets/tokens/forest-token.png">.',
  'mosey': '<img class="meeple-inline" src="assets/meeples/water-elemental.png"> up to 1 hex.',
  'conjure': 'Place 2 <img class="token-inline" src="assets/tokens/lake-token.png"> on empty hexes within 3 hexes of <img class="meeple-inline" src="assets/meeples/water-elemental.png">.',
  'surf': 'Teleport <img class="meeple-inline" src="assets/meeples/water-elemental.png"> from a shore hex to another empty shore hex.',
  'rematerialize': '<img class="meeple-inline" src="assets/meeples/water-elemental.png"> and a <img class="token-inline" src="assets/tokens/fog.png"> swap places.',
  'smoke-dash': '<img class="meeple-inline" src="assets/meeples/fire-elemental.png"> 2 in a line, ignore terrain.',
  'flame-dash': '<img class="meeple-inline" src="assets/meeples/fire-elemental.png"> 3 in a line.<br><br>Place <img class="token-inline" src="assets/tokens/fire-token.png"> under you.',
  'firestorm': 'Add <img class="token-inline" src="assets/tokens/fire-token.png"> to up to 3 <img class="token-inline" src="assets/tokens/fire-token.png"> groups. <img class="meeple-inline" src="assets/meeples/fire-elemental.png"> freely through <img class="token-inline" src="assets/tokens/fire-token.png">.',
  'firewall': 'Place 3 <img class="token-inline" src="assets/tokens/fire-token.png"> in a line from <img class="meeple-inline" src="assets/meeples/fire-elemental.png">.',
};

// Ability icon sprites: { image, backgroundPosition }
// Earth sprite is 2x2 grid: TL=Uproot, TR=Raise Mountain, BL=Landslide, BR=Sprout
const ABILITY_ICONS: Record<string, { image: string; pos: string }> = {
  'uproot':          { image: 'assets/abilities/earth-abilities.png', pos: '0% 0%' },
  'raise-mountain':  { image: 'assets/abilities/earth-abilities.png', pos: '100% 0%' },
  'landslide':       { image: 'assets/abilities/earth-abilities.png', pos: '0% 100%' },
  'sprout':          { image: 'assets/abilities/earth-abilities.png', pos: '100% 100%' },
};

export class ActionBar {
  private onActionClick: ((actionId: ActionId) => void) | null = null;
  private onSOTClick: (() => void) | null = null;
  private onSOTSkip: (() => void) | null = null;
  private onConfirm: (() => void) | null = null;
  private onUndo: (() => void) | null = null;

  constructor(private container: HTMLElement) {}

  setHandlers(handlers: {
    onAction: (actionId: ActionId) => void;
    onSOT: () => void;
    onSOTSkip: () => void;
    onConfirm: () => void;
    onUndo: () => void;
  }) {
    this.onActionClick = handlers.onAction;
    this.onSOTClick = handlers.onSOT;
    this.onSOTSkip = handlers.onSOTSkip;
    this.onConfirm = handlers.onConfirm;
    this.onUndo = handlers.onUndo;
  }

  render(state: GameState) {
    const type = state.currentPlayer;
    const player = state.getPlayer(type);
    const actions = getActionsForElemental(type);
    const specialCard = state.specialDeck.activeCard;

    const phaseLabel =
      state.phase === 'START_OF_TURN' ? 'Start of Turn' :
      state.phase === 'CHOOSE_ACTION' ? 'Choose Action' :
      state.phase === 'EXECUTING' ? 'Selecting Target' :
      'Confirm Action';

    this.container.innerHTML = `
      <div class="bottom-panel theme-${type}">
        <!-- Player identity -->
        <div class="current-player-id">
          <div class="current-player-avatar">
            <img src="${AVATAR_IMAGES[type]}" alt="${ELEMENTAL_NAMES[type]}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
          </div>
          <div class="current-player-name">${ELEMENTAL_NAMES[type]}</div>
          <div class="current-player-phase">
            <span class="phase-dot"></span>
            <span>${phaseLabel}</span>
          </div>
        </div>

        ${this.renderPhaseContent(state, type, player, actions, specialCard)}

        ${state.phase === 'START_OF_TURN' ? `
          <div class="sot-buttons">
            <button class="btn-use-ability" id="sot-btn">Use Ability</button>
            <button class="btn-skip" id="sot-skip">Skip</button>
          </div>
        ` : ''}

        <!-- Confirm / Undo -->
        <div class="action-controls"${state.phase === 'START_OF_TURN' ? ' style="display:none"' : ''}>
          <button class="btn-confirm ${state.phase === 'CONFIRM' ? 'active' : ''}" id="confirm-btn">Confirm</button>
          <button class="btn-undo" id="undo-btn">${state.phase === 'EXECUTING' ? 'Cancel' : 'Undo'}</button>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private renderPhaseContent(
    state: GameState,
    type: ElementalType,
    player: { actionMarker: ActionId | null },
    actions: { id: ActionId; name: string; moveDesc?: string; description: string }[],
    specialCard: { name: string } | null,
  ): string {
    if (state.phase === 'START_OF_TURN') {
      // Phase 1: SOT card + dimmed action preview
      return `
        <div class="phase-content" id="phase-sot">
          <div class="sot-card">
            <div class="sot-card-header"><h3>Start of Turn</h3></div>
            <div class="sot-card-body">
              <p>${SOT_HTML[type]}</p>
            </div>
          </div>
        </div>
      `;
    }

    if (state.phase === 'EXECUTING') {
      // Active action
      const actionName = state.pendingAction
        ? actions.find(a => a.id === state.pendingAction)?.name ?? state.pendingAction
        : '';
      return `
        <div class="active-action-display">
          <div class="active-action-label">Active Action</div>
          <div class="active-action-name">${actionName}</div>
          <div class="active-action-instruction">
            <span class="material-icons">ads_click</span>
            ${state.stepInstruction || 'Click a highlighted hex on the map'}
          </div>
        </div>
      `;
    }

    // Phase 2: CHOOSE_ACTION or CONFIRM — show action cards
    return `
      <div class="phase-content" id="phase-actions">
        <div class="actions-label">Choose an Action</div>
        <div class="actions-grid">
          ${actions.map(a => `
            <div class="action-card${state.pendingAction === 'special' ? (a.id === 'special' ? ' blocked' : '') : (a.id === player.actionMarker ? ' blocked' : '')}${a.id === 'special' ? ' special' : ''}" data-action="${a.id}">
              ${ABILITY_ICONS[a.id] ? `<div class="ability-icon" style="background-image: url('${ABILITY_ICONS[a.id].image}'); background-position: ${ABILITY_ICONS[a.id].pos};"></div>` : ''}
              <div class="action-card-content">
                <div class="action-card-header">
                  <h4>${a.name}</h4>
                </div>
                <div class="action-card-body">
                  ${a.id === 'special' && specialCard
                    ? specialCard.name
                    : ACTION_HTML[a.id] || a.description}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private attachEventListeners() {
    // SOT buttons
    this.container.querySelector('#sot-btn')?.addEventListener('click', () => this.onSOTClick?.());
    this.container.querySelector('#sot-skip')?.addEventListener('click', () => this.onSOTSkip?.());

    // Action cards
    this.container.querySelectorAll('.action-card[data-action]').forEach(btn => {
      const actionId = btn.getAttribute('data-action') as ActionId;
      if (!btn.classList.contains('blocked')) {
        btn.addEventListener('click', () => this.onActionClick?.(actionId));
      }
    });

    // Confirm / Undo
    this.container.querySelector('#confirm-btn')?.addEventListener('click', () => this.onConfirm?.());
    this.container.querySelector('#undo-btn')?.addEventListener('click', () => this.onUndo?.());
  }
}
