// ========================================
// Game Log (Right panel)
// ========================================

import type { GameState } from '../game/GameState';
import type { ElementalType } from '../game/types';

const ELEMENTAL_NAMES: Record<ElementalType, string> = {
  earth: 'Kaijom',
  water: 'Nitsuji',
  fire: 'Krakatoa',
  aeterna: 'Aeterna',
};

export class GameLog {
  constructor(private container: HTMLElement) {}

  render(state: GameState) {
    const specialCard = state.specialDeck.activeCard;
    const nextCard = state.specialDeck.nextCard;

    // Group log entries by turn
    const byTurn = new Map<number, typeof state.log>();
    for (const entry of state.log) {
      if (!byTurn.has(entry.turn)) byTurn.set(entry.turn, []);
      byTurn.get(entry.turn)!.push(entry);
    }

    const turnNumbers = [...byTurn.keys()].sort((a, b) => b - a);

    this.container.innerHTML = `
      <!-- Turn order -->
      <div class="turn-order-area">
        <div class="turn-order-label">Turn Order</div>
        <div class="turn-order-row">
          ${state.turnOrder.map((type, i) => {
            const isCurrent = i === state.currentPlayerIndex;
            return `
              <div class="turn-order-pip ${type} theme-${type} ${isCurrent ? 'current' : ''}">
                <img src="assets/characters/elementals_illustration (${type}).png"
                     alt="${type}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;">
              </div>
              ${i < state.turnOrder.length - 1 ? '<span class="turn-order-arrow"><span class="material-icons">chevron_right</span></span>' : ''}
            `;
          }).join('')}
        </div>
      </div>

      <!-- Special ability card -->
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

      <!-- Game log -->
      <div class="game-log">
        <div class="game-log-header">
          <span class="material-icons">history</span>
          Game Log
        </div>
        <div class="game-log-body">
          ${turnNumbers.map(turn => `
            <div class="log-turn-divider">— Turn ${turn} —</div>
            ${(byTurn.get(turn) ?? []).reverse().map(entry => `
              <div class="log-entry">
                <span class="log-player ${entry.player}">${ELEMENTAL_NAMES[entry.player]}</span>
                <span class="log-action">${entry.description}</span>
              </div>
            `).join('')}
          `).join('')}
        </div>
      </div>
    `;

    // Scroll log to top (latest entries)
    const logBody = this.container.querySelector('.game-log-body');
    if (logBody) logBody.scrollTop = 0;
  }
}
