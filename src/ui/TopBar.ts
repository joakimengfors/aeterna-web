// ========================================
// Top Bar
// ========================================

import type { GameState } from '../game/GameState';
import type { ElementalType } from '../game/types';

const ELEMENTAL_NAMES: Record<ElementalType, string> = {
  earth: 'Kaijom',
  water: 'Nitsuji',
  fire: 'Krakatoa',
};

const PHASE_LABELS: Record<string, string> = {
  'START_OF_TURN': 'Start of Turn',
  'CHOOSE_ACTION': 'Choose Action',
  'EXECUTING': 'Selecting Target',
  'CONFIRM': 'Confirm Action',
};

export class TopBar {
  constructor(private container: HTMLElement) {}

  render(state: GameState) {
    const type = state.currentPlayer;

    this.container.innerHTML = `
      <div class="top-bar">
        <div class="game-title">Aeterna</div>
        <div class="turn-indicator">
          <span class="turn-phase">Turn ${state.turnNumber}</span>
          <div class="turn-player theme-${type}">
            <div class="player-dot"></div>
            <span class="player-name">${ELEMENTAL_NAMES[type]}'s Turn</span>
          </div>
          <span class="turn-phase">Phase: ${PHASE_LABELS[state.phase] ?? state.phase}</span>
        </div>
        <div class="top-actions">
          <button class="top-btn" title="Game Rules"><span class="material-icons">menu_book</span></button>
          <button class="top-btn" title="Settings"><span class="material-icons">settings</span></button>
          <button class="top-btn" title="Fullscreen" id="fullscreen-btn"><span class="material-icons">fullscreen</span></button>
        </div>
      </div>
    `;

    this.container.querySelector('#fullscreen-btn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });
  }
}
