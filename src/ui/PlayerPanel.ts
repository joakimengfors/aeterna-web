// ========================================
// Player Panel (Left sidebar - all players)
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

const CARD_IMAGES: Record<ElementalType, string> = {
  earth: 'assets/kaijom.png',
  water: 'assets/nitsuji.png',
  fire: 'assets/krakatoa.png',
};

export class PlayerPanel {
  constructor(private container: HTMLElement) {}

  render(state: GameState) {
    const currentPlayer = state.currentPlayer;
    const specialCard = state.specialDeck.activeCard;
    const nextCard = state.specialDeck.nextCard;

    const playerCards = state.turnOrder.map(type => {
      const player = state.getPlayer(type);
      const isActive = type === currentPlayer;
      const isHunting = HUNT_CHAIN[type] === currentPlayer;

      return `
        <div class="player-card theme-${type}${isActive ? ' active-turn' : ''}">
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
                Actions${player.actionMarker ? ` <span class="cooldown-badge">⏳ ${getActionsForElemental(type).find(a => a.id === player.actionMarker)?.name ?? player.actionMarker}</span>` : ''}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const specialCardHtml = `
      <div class="special-card-area">
        <div class="special-card-label">
          <span class="material-icons">auto_awesome</span>
          Active Special Ability
        </div>
        <div class="special-card-active">
          <div class="special-card-name">${specialCard?.name ?? 'No card'}</div>
          <div class="special-card-desc">${specialCard?.description ?? ''}</div>
        </div>
        ${nextCard ? `
          <div class="special-card-next">
            <span class="special-card-next-label">Next:</span>
            <span class="special-card-next-name">${nextCard.name}</span>
          </div>
        ` : ''}
      </div>
    `;

    this.container.innerHTML = playerCards + specialCardHtml;

    // Show full-page character card overlay
    this.container.querySelectorAll('.action-info-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerType = btn.getAttribute('data-player') as ElementalType;
        const existing = document.getElementById('char-card-overlay');
        if (existing) { existing.remove(); return; }

        const overlay = document.createElement('div');
        overlay.id = 'char-card-overlay';
        overlay.innerHTML = `
          <div class="char-card-backdrop"></div>
          <div class="char-card-content">
            <img src="${CARD_IMAGES[playerType]}" alt="${ELEMENTAL_NAMES[playerType]}">
            <button class="char-card-close"><span class="material-icons">close</span></button>
          </div>
        `;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.char-card-backdrop')!.addEventListener('click', close);
        overlay.querySelector('.char-card-close')!.addEventListener('click', close);
      });
    });
  }

  private renderSupply(supplies: Record<string, number>, type: ElementalType): string {
    const chips: string[] = [];
    for (const [token, count] of Object.entries(supplies)) {
      const max = this.getMaxSupply(token);
      const onBoard = max - count;
      chips.push(`
        <div class="token-chip">
          <span class="token-dot ${token}"></span>
          ${onBoard} / ${max} ${token.charAt(0).toUpperCase() + token.slice(1)}
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
