// ========================================
// Win Condition Checker
// ========================================

import type { GameState } from './GameState';
import type { ElementalType } from './types';
import { getNeighbors } from './HexGrid';

export function checkWinConditions(state: GameState): ElementalType | null {
  // Earth wins: captured Water, or 3 Forests on board
  if (checkEarthWin(state)) return 'earth';
  // Water wins: captured Fire, or Fire is trapped
  if (checkWaterWin(state)) return 'water';
  // Fire wins: captured Earth, trapped Earth, or 12 fire tokens on board
  if (checkFireWin(state)) return 'fire';
  return null;
}

function checkEarthWin(state: GameState): boolean {
  const earth = state.getPlayer('earth');
  const water = state.getPlayer('water');

  // Capture: Earth on Water's hex
  if (earth.hexId === water.hexId) return true;

  // Capture: Stone Minion on Water's hex
  const minionHex = state.getStoneMinionHex();
  if (minionHex !== null && minionHex === water.hexId) return true;

  // 3 Forests on board
  if (state.countTokensOnBoard('forest') >= 3) return true;

  return false;
}

function checkWaterWin(state: GameState): boolean {
  const water = state.getPlayer('water');
  const fire = state.getPlayer('fire');

  // Capture: Water on Fire's hex
  if (water.hexId === fire.hexId) return true;

  // Fire trapped (checked during forced movement)
  // This is handled in ActionExecutor when fire is forced to move

  return false;
}

function checkFireWin(state: GameState): boolean {
  const fire = state.getPlayer('fire');
  const earth = state.getPlayer('earth');

  // Capture: Fire on Earth's hex
  if (fire.hexId === earth.hexId) return true;

  // 12 fire tokens on board
  if (state.countTokensOnBoard('fire') >= 12) return true;

  // Earth trapped (checked during forced movement)

  return false;
}

/** Check if an elemental is trapped (no legal moves at all) */
export function isTrapped(state: GameState, type: ElementalType): boolean {
  const player = state.getPlayer(type);
  const neighbors = getNeighbors(player.hexId);

  for (const n of neighbors) {
    if (canElementalEnter(state, type, n)) return false;
  }
  return true;
}

function canElementalEnter(state: GameState, type: ElementalType, hexId: number): boolean {
  const hex = state.getHex(hexId);

  // Can't enter stone minion hex (except earth passing through, but for "trapped" we check end positions)
  if (hex.stoneMinion) return false;

  // Mountains block everyone
  if (hex.tokens.includes('mountain')) return false;

  if (type === 'earth') {
    // Earth can't enter fire tokens
    if (hex.tokens.includes('fire')) return false;
  }
  if (type === 'water') {
    // Water can't enter mountains (already checked above)
  }
  if (type === 'fire') {
    // Fire can't enter lakes or mountains
    if (hex.tokens.includes('lake')) return false;
  }

  return true;
}
