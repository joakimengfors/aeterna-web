// ========================================
// Aeterna: Clash of Elements - Type System
// ========================================

export type ElementalType = 'earth' | 'water' | 'fire';

export type TokenType = 'mountain' | 'forest' | 'fire' | 'lake' | 'fog';

export type Phase = 'START_OF_TURN' | 'CHOOSE_ACTION' | 'EXECUTING' | 'CONFIRM';

export type HexId = number; // 1-41

// Earth actions
export type EarthAction = 'uproot' | 'raise-mountain' | 'landslide' | 'sprout' | 'special';
// Water actions
export type WaterAction = 'mosey' | 'conjure' | 'surf' | 'rematerialize' | 'special';
// Fire actions
export type FireAction = 'smoke-dash' | 'flame-dash' | 'firestorm' | 'firewall' | 'special';

export type ActionId = EarthAction | WaterAction | FireAction;

export interface ActionDef {
  id: ActionId;
  name: string;
  moveDesc?: string;
  description: string;
  elementalType: ElementalType;
}

export const EARTH_ACTIONS: ActionDef[] = [
  { id: 'uproot', name: 'Uproot', moveDesc: '3-4 hexes', description: 'Pure movement. 4 hexes if a Forest is on the board.', elementalType: 'earth' },
  { id: 'raise-mountain', name: 'Raise Mountain', moveDesc: '1 hex', description: 'Place a Mountain on any empty hex. If all 4 placed, move one instead.', elementalType: 'earth' },
  { id: 'landslide', name: 'Landslide', moveDesc: '= mountains', description: 'Move hexes equal to Mountains on board. May destroy a Mountain and chain-destroy adjacent tokens.', elementalType: 'earth' },
  { id: 'sprout', name: 'Sprout', description: 'Replace a Lake adjacent to a Forest with a Forest.', elementalType: 'earth' },
  { id: 'special', name: 'Special', description: 'Use the active Special Ability card.', elementalType: 'earth' },
];

export const WATER_ACTIONS: ActionDef[] = [
  { id: 'mosey', name: 'Mosey', moveDesc: '1 hex', description: 'Move up to 1 hex.', elementalType: 'water' },
  { id: 'conjure', name: 'Conjure Lakes', description: 'Place 2 Lakes on empty hexes within 3 hexes. If supply empty, move existing Lakes.', elementalType: 'water' },
  { id: 'surf', name: 'Ocean Surf', description: 'Teleport from one shore hex to another empty shore hex.', elementalType: 'water' },
  { id: 'rematerialize', name: 'Re-Materialize', description: 'Swap places with a Fog token. Lake stays in place.', elementalType: 'water' },
  { id: 'special', name: 'Special', description: 'Use the active Special Ability card.', elementalType: 'water' },
];

export const FIRE_ACTIONS: ActionDef[] = [
  { id: 'smoke-dash', name: 'Smoke Dash', moveDesc: '2 hexes (line)', description: 'Move up to 2 hexes in a straight line, ignoring terrain.', elementalType: 'fire' },
  { id: 'flame-dash', name: 'Flame Dash', moveDesc: '3 hexes (line)', description: 'Move up to 3 hexes in a straight line. Place Fire on destination.', elementalType: 'fire' },
  { id: 'firestorm', name: 'Firestorm', description: 'Add Fire to up to 3 fire groups. Move through connected fire + 1 extra.', elementalType: 'fire' },
  { id: 'firewall', name: 'Firewall', description: 'Choose a direction. Place Fire on up to 3 empty hexes in that line.', elementalType: 'fire' },
  { id: 'special', name: 'Special', description: 'Use the active Special Ability card.', elementalType: 'fire' },
];

export function getActionsForElemental(type: ElementalType): ActionDef[] {
  switch (type) {
    case 'earth': return EARTH_ACTIONS;
    case 'water': return WATER_ACTIONS;
    case 'fire': return FIRE_ACTIONS;
  }
}

export interface HexState {
  tokens: TokenType[];       // tokens on this hex (usually 0-1, fog+lake can stack)
  elemental?: ElementalType; // elemental standee on this hex
  stoneMinion?: boolean;     // stone minion on this hex
}

export interface PlayerState {
  type: ElementalType;
  hexId: HexId;
  actionMarker: ActionId | null; // null = no action blocked (turn 1)
  supplies: Record<string, number>; // token type -> count in supply
}

export interface SpecialCard {
  id: string;
  name: string;
  description: string;
}

export const SPECIAL_CARDS: SpecialCard[] = [
  { id: 'start-of-turn', name: 'Use Start of Turn', description: 'Perform your Start of Turn ability (even if skipped).' },
  { id: 'move-2-ignore', name: 'Move 2, Ignore Terrain', description: 'Move up to 2 hexes, ignoring terrain and other Elementals.' },
  { id: 'move-3-line', name: 'Move 3 in a Line', description: 'Move up to 3 hexes in a straight line.' },
  { id: 'teleport-shore', name: 'Teleport to Shore', description: 'Instantly move to any empty shore hex.' },
  { id: 'use-any-ability', name: 'Use Any Ability', description: 'Perform any one of your 4 main actions.' },
  { id: 'swap-places', name: 'Swap Places', description: 'Choose any two Elementals and switch their positions.' },
];

export interface GameEvent {
  turn: number;
  player: ElementalType;
  action: string;
  description: string;
}
