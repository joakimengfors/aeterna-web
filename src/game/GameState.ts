// ========================================
// Aeterna Game State
// ========================================

import type { ElementalType, HexId, HexState, PlayerState, Phase, ActionId, GameEvent, TokenType } from './types';
import { ALL_HEX_IDS, getNeighbors } from './HexGrid';
import { SpecialAbilityDeck } from './SpecialAbilityDeck';

export class GameState {
  board: Map<HexId, HexState> = new Map();
  players: Map<ElementalType, PlayerState> = new Map();
  turnOrder: ElementalType[] = ['earth', 'water', 'fire'];
  currentPlayerIndex = 0;
  turnNumber = 1;
  phase: Phase = 'START_OF_TURN';
  specialDeck: SpecialAbilityDeck;
  log: GameEvent[] = [];
  winner: ElementalType | null = null;

  // Pending action state (for multi-step execution)
  pendingAction: ActionId | null = null;
  pendingSteps: any[] = []; // action-specific pending data
  stepInstruction = ''; // instruction text shown during EXECUTING phase
  sotUsed = false; // start-of-turn ability used this turn

  constructor() {
    this.specialDeck = new SpecialAbilityDeck();
    this.initBoard();
    this.setupScenario1();
  }

  private initBoard() {
    for (const id of ALL_HEX_IDS) {
      this.board.set(id, { tokens: [] });
    }
  }

  private setupScenario1() {
    // Earth / Kaijom
    this.players.set('earth', {
      type: 'earth',
      hexId: 32,
      actionMarker: null,
      supplies: { mountain: 3, forest: 3 },
    });
    this.setElementalOnHex(32, 'earth');

    // Water / Nitsuji
    this.players.set('water', {
      type: 'water',
      hexId: 2,
      actionMarker: null,
      supplies: { lake: 4, fog: 1 },
    });
    this.setElementalOnHex(2, 'water');

    // Fire / Krakatoa
    this.players.set('fire', {
      type: 'fire',
      hexId: 36,
      actionMarker: null,
      supplies: { fire: 11 },
    });
    this.setElementalOnHex(36, 'fire');

    // Board tokens
    this.addToken(22, 'mountain');   // Mountain on hex 22
    this.addToken(9, 'lake');        // Lake on hex 9
    this.addToken(9, 'fog');         // Fog on hex 9 (stacked with lake)
    this.addToken(24, 'fire');       // Fire on hex 24
    this.setStoneMinion(19);         // Stone Minion on hex 19

    this.addLog('Game started. Scenario 1.');
  }

  get currentPlayer(): ElementalType {
    return this.turnOrder[this.currentPlayerIndex];
  }

  getPlayer(type: ElementalType): PlayerState {
    return this.players.get(type)!;
  }

  getHex(id: HexId): HexState {
    return this.board.get(id)!;
  }

  // --- Board manipulation ---

  setElementalOnHex(hexId: HexId, type: ElementalType) {
    // Clear old position
    for (const [id, hex] of this.board) {
      if (hex.elemental === type) {
        hex.elemental = undefined;
      }
    }
    this.getHex(hexId).elemental = type;
    this.getPlayer(type).hexId = hexId;
  }

  setStoneMinion(hexId: HexId) {
    // Clear old position
    for (const hex of this.board.values()) {
      hex.stoneMinion = false;
    }
    this.getHex(hexId).stoneMinion = true;
  }

  getStoneMinionHex(): HexId | null {
    for (const [id, hex] of this.board) {
      if (hex.stoneMinion) return id;
    }
    return null;
  }

  addToken(hexId: HexId, token: TokenType) {
    this.getHex(hexId).tokens.push(token);
  }

  removeToken(hexId: HexId, token: TokenType): boolean {
    const hex = this.getHex(hexId);
    const idx = hex.tokens.indexOf(token);
    if (idx === -1) return false;
    hex.tokens.splice(idx, 1);
    return true;
  }

  hasToken(hexId: HexId, token: TokenType): boolean {
    return this.getHex(hexId).tokens.includes(token);
  }

  isHexEmpty(hexId: HexId): boolean {
    const hex = this.getHex(hexId);
    // Fog doesn't count as blocking
    const nonFogTokens = hex.tokens.filter(t => t !== 'fog');
    return nonFogTokens.length === 0 && !hex.elemental && !hex.stoneMinion;
  }

  /** Count tokens of a type on the board */
  countTokensOnBoard(token: TokenType): number {
    let count = 0;
    for (const hex of this.board.values()) {
      count += hex.tokens.filter(t => t === token).length;
    }
    return count;
  }

  /** Return a token to its owner's supply */
  returnTokenToSupply(token: TokenType) {
    const owner = this.getTokenOwner(token);
    if (owner) {
      const player = this.getPlayer(owner);
      const key = token === 'fire' ? 'fire' : token;
      player.supplies[key] = (player.supplies[key] ?? 0) + 1;
    }
  }

  getTokenOwner(token: TokenType): ElementalType | null {
    switch (token) {
      case 'mountain': case 'forest': return 'earth';
      case 'lake': case 'fog': return 'water';
      case 'fire': return 'fire';
    }
  }

  /** Remove a token from a hex and return it to supply */
  destroyToken(hexId: HexId, token: TokenType) {
    if (this.removeToken(hexId, token)) {
      this.returnTokenToSupply(token);
    }
  }

  /** Take a token from supply. Returns false if supply is empty. */
  takeFromSupply(player: ElementalType, token: string): boolean {
    const p = this.getPlayer(player);
    if ((p.supplies[token] ?? 0) <= 0) return false;
    p.supplies[token]--;
    return true;
  }

  // --- Turn management ---

  advanceTurn() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.turnOrder.length;
    if (this.currentPlayerIndex === 0) {
      this.turnNumber++;
    }
    this.phase = 'START_OF_TURN';
    this.pendingAction = null;
    this.pendingSteps = [];
    this.sotUsed = false;
  }

  addLog(description: string) {
    this.log.push({
      turn: this.turnNumber,
      player: this.currentPlayer,
      action: this.pendingAction ?? '',
      description,
    });
  }

  /** Deep clone for undo/preview */
  clone(): GameState {
    const gs = new GameState();
    // Copy board
    gs.board = new Map();
    for (const [id, hex] of this.board) {
      gs.board.set(id, {
        tokens: [...hex.tokens],
        elemental: hex.elemental,
        stoneMinion: hex.stoneMinion,
      });
    }
    // Copy players
    gs.players = new Map();
    for (const [type, p] of this.players) {
      gs.players.set(type, {
        ...p,
        supplies: { ...p.supplies },
      });
    }
    gs.turnOrder = [...this.turnOrder];
    gs.currentPlayerIndex = this.currentPlayerIndex;
    gs.turnNumber = this.turnNumber;
    gs.phase = this.phase;
    gs.specialDeck = this.specialDeck.clone();
    gs.log = [...this.log];
    gs.winner = this.winner;
    gs.pendingAction = this.pendingAction;
    gs.pendingSteps = [...this.pendingSteps];
    gs.sotUsed = this.sotUsed;
    return gs;
  }
}
