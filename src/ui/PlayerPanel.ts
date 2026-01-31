// ========================================
// Player Panel (Left sidebar - opponents)
// ========================================

import type { GameState } from '../game/GameState';
import type { ElementalType, ActionId } from '../game/types';
import { getActionsForElemental } from '../game/types';

const HUNT_CHAIN: Record<ElementalType, ElementalType> = {
  earth: 'water',
  water: 'fire',
  fire: 'earth',
};

const ELEMENTAL_NAMES: Record<ElementalType, string> = {
  earth: 'Kaijom',
  water: 'Nitsuji',
  fire: 'Krakatoa',
};

const ELEMENTAL_LABELS: Record<ElementalType, string> = {
  earth: 'Earth',
  water: 'Water',
  fire: 'Fire',
};

const WIN_CONDITIONS: Record<ElementalType, string> = {
  earth: 'Catch <strong>Nitsuji</strong> or 3 Forests on board',
  water: 'Catch <strong>Krakatoa</strong> or trap Fire',
  fire: 'Catch <strong>Kaijom</strong> or place all 12 Fire tokens',
};

const AVATAR_IMAGES: Record<ElementalType, string> = {
  earth: 'assets/characters/elementals_illustration (earth).png',
  water: 'assets/characters/elementals_illustration (water).png',
  fire: 'assets/characters/elementals_illustration (fire).png',
};

export class PlayerPanel {
  constructor(private container: HTMLElement) {}

  render(state: GameState) {
    const currentPlayer = state.currentPlayer;
    const opponents = state.turnOrder.filter(t => t !== currentPlayer);

    this.container.innerHTML = opponents.map(type => {
      const player = state.getPlayer(type);
      const isHunting = HUNT_CHAIN[type] === currentPlayer;
      const actions = getActionsForElemental(type);

      return `
        <div class="player-card theme-${type}">
          <div class="player-card-header">
            <div class="player-avatar">
              <img src="${AVATAR_IMAGES[type]}" alt="${ELEMENTAL_NAMES[type]}" style="width:100%;height:100%;object-fit:cover;">
            </div>
            <div class="player-info">
              <div class="player-elemental-name">${ELEMENTAL_NAMES[type]}</div>
              <div class="player-username">${ELEMENTAL_LABELS[type]}</div>
            </div>
            ${isHunting ? `
              <div class="player-hunt-badge">
                <span class="material-icons">gps_fixed</span>
                <span>Hunts You</span>
              </div>
            ` : ''}
          </div>
          <div class="player-card-body">
            <div class="win-condition">
              <span class="material-icons">emoji_events</span>
              <span class="win-condition-text">${WIN_CONDITIONS[type]}</span>
            </div>
            <div class="token-supply">
              ${this.renderSupply(player.supplies, type)}
            </div>
            <div class="action-markers">
              <button class="action-info-btn" data-player="${type}">
                <span class="material-icons">info_outline</span>
                Actions${player.actionMarker ? ' <span class="cooldown-badge">1 on cooldown</span>' : ''}
              </button>
              <div class="action-info-popup" id="popup-${type}">
                ${actions.map(a => `
                  <div class="action-marker ${a.id === player.actionMarker ? 'blocked' : ''}">${a.name}</div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Toggle action info popups
    this.container.querySelectorAll('.action-info-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerType = btn.getAttribute('data-player');
        const popup = this.container.querySelector(`#popup-${playerType}`) as HTMLElement;
        if (popup) {
          const isOpen = popup.classList.toggle('open');
          // Close others
          if (isOpen) {
            this.container.querySelectorAll('.action-info-popup.open').forEach(p => {
              if (p !== popup) p.classList.remove('open');
            });
          }
        }
      });
    });
  }

  private renderSupply(supplies: Record<string, number>, type: ElementalType): string {
    const chips: string[] = [];
    for (const [token, count] of Object.entries(supplies)) {
      const max = this.getMaxSupply(token);
      chips.push(`
        <div class="token-chip">
          <span class="token-dot ${token}"></span>
          ${count} / ${max} ${token.charAt(0).toUpperCase() + token.slice(1)}
        </div>
      `);
    }
    return chips.join('');
  }

  private getMaxSupply(token: string): number {
    switch (token) {
      case 'mountain': return 4;
      case 'forest': return 3;
      case 'fire': return 12;
      case 'lake': return 5;
      case 'fog': return 2;
      default: return 0;
    }
  }
}
