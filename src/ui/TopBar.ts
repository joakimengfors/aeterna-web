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

export class TopBar {
  private onCancel: (() => void) | null = null;

  constructor(private container: HTMLElement) {}

  setOnCancel(cb: (() => void) | null) {
    this.onCancel = cb;
  }

  render(state: GameState) {
    const type = state.currentPlayer;
    const isExecuting = state.phase === 'EXECUTING' || state.phase === 'CONFIRM';
    const instruction = state.stepInstruction || '';

    if (isExecuting && instruction) {
      this.container.innerHTML = `
        <div class="top-bar">
          <div class="game-title">Aeterna</div>
          <div class="top-instruction">
            <span class="material-icons">ads_click</span>
            <span class="top-instruction-text">${instruction}</span>
          </div>
          <div class="top-actions">
            <button class="top-btn top-btn-cancel" id="cancel-btn" title="Cancel">
              <span class="material-icons">close</span>
              <span class="cancel-label">Cancel</span>
            </button>
          </div>
        </div>
      `;
      this.container.querySelector('#cancel-btn')?.addEventListener('click', () => {
        if (this.onCancel) this.onCancel();
      });
    } else {
      this.container.innerHTML = `
        <div class="top-bar">
          <div class="game-title">Aeterna</div>
          <div class="turn-indicator">
            <span class="turn-phase">Turn ${state.turnNumber}</span>
            <div class="turn-player theme-${type}">
              <div class="player-dot"></div>
              <span class="player-name">${ELEMENTAL_NAMES[type]}'s Turn</span>
            </div>
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
}
