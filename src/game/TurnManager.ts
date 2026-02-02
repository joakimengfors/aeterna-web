// ========================================
// Turn Manager
// ========================================

import type { GameState } from './GameState';
import type { ActionId, ElementalType } from './types';
import { getActionsForElemental } from './types';

export class TurnManager {
  constructor(private state: GameState) {}

  /** Get available actions for current player (excluding cooldown) */
  getAvailableActions(): { id: ActionId; name: string; blocked: boolean }[] {
    const player = this.state.getPlayer(this.state.currentPlayer);
    const actions = getActionsForElemental(player.type);
    return actions.map(a => ({
      id: a.id,
      name: a.name,
      blocked: a.id === player.actionMarker,
    }));
  }

  /** Set the action marker after choosing an action */
  setActionMarker(actionId: ActionId) {
    const player = this.state.getPlayer(this.state.currentPlayer);
    player.actionMarker = actionId;
  }

  /** Advance to the next player's turn */
  endTurn() {
    this.state.advanceTurn();
  }

  /** Get the elemental name for display */
  getElementalName(type: ElementalType): string {
    switch (type) {
      case 'earth': return 'Kaijom';
      case 'water': return 'Nitsuji';
      case 'fire': return 'Krakatoa';
      case 'aeterna': return 'Aeterna';
    }
  }
}
