// ========================================
// Hex Interaction Controller
// ========================================
// Orchestrates the game flow: SOT -> action selection -> target picking -> confirm

import { GameState } from '../game/GameState';
import { ActionExecutor } from '../game/ActionExecutor';
import { TurnManager } from '../game/TurnManager';
import { checkWinConditions } from '../game/WinChecker';
import { BoardRenderer } from './BoardRenderer';
import { ActionBar } from './ActionBar';
import { PlayerPanel } from './PlayerPanel';
import { GameLog } from './GameLog';
import { TopBar } from './TopBar';
import type { ActionId, HexId, ElementalType } from '../game/types';
import { getNeighbors, getLineHexes, isShore, ALL_HEX_IDS } from '../game/HexGrid';

export class HexInteraction {
  private state: GameState;
  private executor: ActionExecutor;
  private turnMgr: TurnManager;
  private board: BoardRenderer;
  private actionBar: ActionBar;
  private playerPanel: PlayerPanel;
  private gameLog: GameLog;
  private topBar: TopBar;

  // State for multi-step actions
  private savedState: GameState | null = null;
  private selectedAction: ActionId | null = null;
  private actionTargets: HexId[] = [];
  private currentStep = 0; // for multi-step actions
  private validTargets: HexId[] = [];

  // Fog movement sub-phase
  private pendingFogMoves: HexId[] = [];
  private fogMoveRange = 0;
  private postFogCallback: (() => void) | null = null;

  // Forced move sub-phase
  private postForcedMoveCallback: (() => void) | null = null;

  // Flame Dash state: tracks whether fire was placed before moving
  private flameDashPlacedFirst = false;

  constructor(
    state: GameState,
    board: BoardRenderer,
    actionBar: ActionBar,
    playerPanel: PlayerPanel,
    gameLog: GameLog,
    topBar: TopBar,
  ) {
    this.state = state;
    this.executor = new ActionExecutor(state);
    this.turnMgr = new TurnManager(state);
    this.board = board;
    this.actionBar = actionBar;
    this.playerPanel = playerPanel;
    this.gameLog = gameLog;
    this.topBar = topBar;

    this.setupHandlers();
    this.renderAll();
  }

  private setupHandlers() {
    this.board.setHexClickHandler((hexId) => this.onHexClick(hexId));
    this.actionBar.setHandlers({
      onAction: (id) => this.onActionSelected(id),
      onSOT: () => this.onSOTStart(),
      onSOTSkip: () => this.onSOTSkip(),
      onConfirm: () => this.onConfirm(),
      onUndo: () => this.onUndo(),
    });
  }

  private renderAll() {
    // Set the theme on the game layout
    const layout = document.querySelector('.game-layout');
    if (layout) {
      layout.className = `game-layout theme-${this.state.currentPlayer}`;
    }

    this.board.render(this.state);
    this.board.clearHighlights();
    this.actionBar.render(this.state);
    this.playerPanel.render(this.state);
    this.gameLog.render(this.state);
    this.topBar.render(this.state);

    // Update character switcher
    document.querySelectorAll('.char-switcher-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-el') === this.state.currentPlayer);
    });

    // Re-attach handlers after re-render
    this.actionBar.setHandlers({
      onAction: (id) => this.onActionSelected(id),
      onSOT: () => this.onSOTStart(),
      onSOTSkip: () => this.onSOTSkip(),
      onConfirm: () => this.onConfirm(),
      onUndo: () => this.onUndo(),
    });
  }

  // ==========================================
  // START OF TURN
  // ==========================================

  private onSOTStart() {
    this.savedState = this.state.clone();
    const targets = this.executor.getSOTValidTargets();
    if (targets.length === 0) {
      this.onSOTSkip();
      return;
    }
    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = null;
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.renderAll();
    // Keep highlights after renderAll
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
  }

  private onSOTSkip() {
    this.state.phase = 'CHOOSE_ACTION';
    this.state.sotUsed = false;
    this.renderAll();
  }

  // ==========================================
  // ACTION SELECTION
  // ==========================================

  private onActionSelected(actionId: ActionId) {
    this.savedState = this.state.clone();
    this.selectedAction = actionId;
    this.actionTargets = [];
    this.currentStep = 0;
    this.flameDashPlacedFirst = false;

    // Handle Special Ability
    if (actionId === 'special') {
      this.handleSpecialAbility();
      return;
    }

    const targets = this.executor.getValidTargets(actionId);

    // For Flame Dash, also include Fire's own hex if eligible
    if (actionId === 'flame-dash' && this.executor.canFlameDashPlaceFirst()) {
      const fire = this.state.getPlayer('fire');
      if (!targets.includes(fire.hexId)) {
        targets.unshift(fire.hexId);
      }
    }

    if (targets.length === 0) {
      // No valid targets - can't use this action
      this.selectedAction = null;
      return;
    }

    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = actionId;
    this.state.stepInstruction = this.getStepInstruction(actionId, 0);
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.renderAll();
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
  }

  private handleSpecialAbility() {
    const card = this.state.specialDeck.activeCard;
    if (!card) return;

    // Different behavior per card type
    switch (card.id) {
      case 'start-of-turn':
        // Execute SOT ability
        this.state.specialDeck.useActiveCard();
        this.state.phase = 'START_OF_TURN';
        this.state.pendingAction = 'special';
        this.onSOTStart();
        break;
      case 'move-2-ignore':
        this.state.specialDeck.useActiveCard();
        this.executeSpecialMove(2, true);
        break;
      case 'move-3-line':
        this.state.specialDeck.useActiveCard();
        this.executeSpecialMoveLine(3);
        break;
      case 'teleport-shore':
        this.state.specialDeck.useActiveCard();
        this.executeSpecialTeleportShore();
        break;
      case 'use-any-ability':
        this.state.specialDeck.useActiveCard();
        // Go back to choose action, but allow all 4 main actions
        this.state.phase = 'CHOOSE_ACTION';
        this.state.pendingAction = 'special';
        this.renderAll();
        break;
      case 'swap-places':
        this.state.specialDeck.useActiveCard();
        this.executeSpecialSwap();
        break;
    }
  }

  private executeSpecialMove(range: number, ignoreTerrain: boolean) {
    const player = this.state.getPlayer(this.state.currentPlayer);
    const targets: HexId[] = [];

    // BFS with terrain ignoring
    const visited = new Set<HexId>([player.hexId]);
    const queue: [HexId, number][] = [[player.hexId, 0]];

    while (queue.length > 0) {
      const [current, dist] = queue.shift()!;
      if (dist >= range) continue;
      for (const n of getNeighbors(current)) {
        if (visited.has(n)) continue;
        visited.add(n);
        targets.push(n);
        if (ignoreTerrain) {
          queue.push([n, dist + 1]);
        }
      }
    }

    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = 'special';
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.renderAll();
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
  }

  private executeSpecialMoveLine(range: number) {
    const player = this.state.getPlayer(this.state.currentPlayer);
    const targets: HexId[] = [];
    const lines = getLineHexes(player.hexId, range);
    for (const { hexes } of lines) {
      for (const h of hexes) targets.push(h);
    }
    this.validTargets = [...new Set(targets)];
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = 'special';
    this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
    this.renderAll();
    this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
  }

  private executeSpecialTeleportShore() {
    const targets = ALL_HEX_IDS.filter((id) => isShore(id) && this.state.isHexEmpty(id));
    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = 'special';
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.renderAll();
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
  }

  private executeSpecialSwap() {
    // For MVP: highlight all elemental positions, user picks two
    const targets: HexId[] = [];
    for (const type of this.state.turnOrder) {
      targets.push(this.state.getPlayer(type).hexId);
    }
    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = 'special';
    this.currentStep = 0;
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.renderAll();
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
  }

  // ==========================================
  // HEX CLICKS
  // ==========================================

  private onHexClick(hexId: HexId) {
    if (!this.validTargets.includes(hexId)) return;

    // Fog movement sub-phase
    if (this.pendingFogMoves.length > 0) {
      this.handleFogMoveClick(hexId);
      return;
    }

    // Forced move sub-phase
    if (this.state.pendingForcedMove) {
      this.handleForcedMoveClick(hexId);
      return;
    }

    if (this.state.phase === 'EXECUTING' && !this.selectedAction) {
      // SOT execution
      this.executor.executeSOT(hexId);
      this.checkWin();

      // Check for forced move (Fire SOT placed fire on Earth)
      if (this.state.pendingForcedMove) {
        this.startForcedMovePhase(() => {
          this.finishSOT();
        });
        return;
      }

      this.finishSOT();
      return;
    }

    if (!this.selectedAction) return;

    // Handle multi-step actions
    switch (this.selectedAction) {
      case 'raise-mountain':
        this.handleRaiseMountainStep(hexId);
        return;
      case 'landslide':
        this.handleLandslideStep(hexId);
        return;
      case 'conjure':
        this.handleConjureStep(hexId);
        return;
      case 'firestorm':
        this.handleFirestormStep(hexId);
        return;
      case 'flame-dash':
        this.handleFlameDashStep(hexId);
        return;
      case 'special':
        this.handleSpecialStep(hexId);
        return;
    }

    // Single-step actions (mosey handled here too but needs fog follow-up)
    this.actionTargets = [hexId];
    this.board.highlightSelected(hexId);
    this.state.phase = 'CONFIRM';
    this.renderAll();
    this.board.highlightSelected(hexId);
  }

  /** After Water SOT completes, handle fog movement then advance to CHOOSE_ACTION */
  private finishSOT() {
    if (this.state.currentPlayer === 'water' && this.state.pendingFogMove) {
      this.state.pendingFogMove = false;
      this.startFogMovePhase(1, () => {
        this.state.phase = 'CHOOSE_ACTION';
        this.renderAll();
      });
      return;
    }
    this.state.phase = 'CHOOSE_ACTION';
    this.renderAll();
  }

  private handleRaiseMountainStep(hexId: HexId) {
    if (this.currentStep === 0) {
      // Step 1: Move
      this.actionTargets.push(hexId);
      this.currentStep = 1;

      // Apply move
      const earth = this.state.getPlayer('earth');
      if (hexId !== earth.hexId) {
        this.state.setElementalOnHex(hexId, 'earth');
      }

      // Step 2: Place mountain
      this.state.stepInstruction = this.getStepInstruction('raise-mountain', 1);
      const targets = this.executor.getRaiseMountainPlaceTargets();
      this.validTargets = targets;
      this.renderAll();
      this.board.highlightValidTargets(targets, this.state.currentPlayer);
    } else {
      // Step 2: Place mountain — preview the placement
      this.actionTargets.push(hexId);
      this.state.addToken(hexId, 'mountain');
      this.state.phase = 'CONFIRM';
      this.renderAll();
      this.board.highlightSelected(hexId);
    }
  }

  private handleLandslideStep(hexId: HexId) {
    if (this.currentStep === 0) {
      // Step 1: Move
      this.actionTargets.push(hexId);
      this.currentStep = 1;

      // Apply move
      const earth = this.state.getPlayer('earth');
      if (hexId !== earth.hexId) {
        this.state.setElementalOnHex(hexId, 'earth');
      }

      // Step 2: Destroy mountain (optional)
      const targets = this.executor.getLandslideDestroyTargets();
      if (targets.length === 0) {
        this.state.phase = 'CONFIRM';
        this.renderAll();
        return;
      }
      this.state.stepInstruction = this.getStepInstruction('landslide', 1);
      this.validTargets = targets;
      this.renderAll();
      this.board.highlightValidTargets(targets, this.state.currentPlayer);

      // Show danger preview for adjacent tokens
      for (const mt of targets) {
        const neighbors = getNeighbors(mt);
        const dangerHexes = neighbors.filter(n => {
          const hex = this.state.getHex(n);
          return hex.tokens.some(t => t !== 'fog');
        });
        this.board.highlightDanger(dangerHexes);
      }
    } else {
      // Step 2: Selected mountain to destroy
      this.actionTargets.push(hexId);
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.renderAll();
      this.board.highlightSelected(hexId);
    }
  }

  private handleConjureStep(hexId: HexId) {
    this.actionTargets.push(hexId);
    this.board.highlightSelected(hexId);

    if (this.actionTargets.length >= 2) {
      this.state.phase = 'CONFIRM';
      this.renderAll();
      for (const t of this.actionTargets) this.board.highlightSelected(t);
    } else {
      // Remove selected hex from valid targets
      this.validTargets = this.validTargets.filter(t => t !== hexId);
      this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
      this.board.highlightSelected(hexId);
    }
  }

  private handleFirestormStep(hexId: HexId) {
    this.actionTargets.push(hexId);
    this.board.highlightSelected(hexId);

    if (this.actionTargets.length >= 3 || this.currentStep === 1) {
      // After placement, move step
      if (this.currentStep === 0) {
        this.currentStep = 1;
        const moveTargets = this.executor.getFirestormMoveTargets();
        this.validTargets = moveTargets;
        this.board.render(this.state);
        this.board.highlightValidTargets(moveTargets, this.state.currentPlayer);
      } else {
        // Move selected
        this.state.phase = 'CONFIRM';
        this.renderAll();
      }
    } else {
      this.validTargets = this.validTargets.filter(t => t !== hexId);
      this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
      this.board.highlightSelected(hexId);
    }
  }

  private handleFlameDashStep(hexId: HexId) {
    const fire = this.state.getPlayer('fire');

    if (this.currentStep === 0) {
      if (hexId === fire.hexId && this.executor.canFlameDashPlaceFirst()) {
        // Player chose to place fire on own hex first
        this.flameDashPlacedFirst = true;
        if (this.state.takeFromSupply('fire', 'fire')) {
          this.state.addToken(fire.hexId, 'fire');
        }
        this.currentStep = 1;

        // Now show movement targets (re-compute since board changed)
        const moveTargets = this.executor.getFlameDashTargets();
        this.validTargets = moveTargets;
        this.state.stepInstruction = `Move Krakatoa in a straight line`;
        this.renderAll();
        this.board.highlightValidTargets(moveTargets, this.state.currentPlayer);
      } else {
        // Player chose a movement destination directly — place fire on destination after
        this.actionTargets = [hexId];
        this.state.phase = 'CONFIRM';
        this.renderAll();
        this.board.highlightSelected(hexId);
      }
    } else {
      // Step 1: after placing fire first, now pick movement destination
      this.actionTargets = [hexId];
      this.state.phase = 'CONFIRM';
      this.renderAll();
      this.board.highlightSelected(hexId);
    }
  }

  private handleSpecialStep(hexId: HexId) {
    // Generic special handling - move to hex
    this.actionTargets.push(hexId);

    // Swap needs 2 targets
    const card = this.state.specialDeck.activeCard;
    if (this.actionTargets.length < 2 && this.state.pendingAction === 'special') {
      // Check if this was a swap (need 2 elementals)
      // For simplicity, just move
    }

    this.state.setElementalOnHex(hexId, this.state.currentPlayer);
    this.state.phase = 'CONFIRM';
    this.checkWin();
    this.renderAll();
    this.board.highlightSelected(hexId);
  }

  // ==========================================
  // FOG MOVEMENT SUB-PHASE
  // ==========================================

  private startFogMovePhase(range: number, callback: () => void) {
    const fogHexes = this.executor.getFogTokenHexes();
    if (fogHexes.length === 0) {
      callback();
      return;
    }

    this.pendingFogMoves = [...fogHexes];
    this.fogMoveRange = range;
    this.postFogCallback = callback;
    this.promptNextFogMove();
  }

  private promptNextFogMove() {
    if (this.pendingFogMoves.length === 0) {
      const cb = this.postFogCallback;
      this.postFogCallback = null;
      this.fogMoveRange = 0;
      if (cb) cb();
      return;
    }

    const fogHex = this.pendingFogMoves[0];
    const targets = this.executor.getFogMoveTargets(fogHex, this.fogMoveRange);
    this.validTargets = targets;
    this.state.stepInstruction = `Move Fog from hex ${fogHex} (click it to skip)`;
    this.state.phase = 'EXECUTING';
    this.renderAll();
    this.board.highlightValidTargets(targets, 'water');
  }

  private handleFogMoveClick(hexId: HexId) {
    const fogHex = this.pendingFogMoves.shift()!;
    this.executor.moveFog(fogHex, hexId);
    this.checkWin();
    this.promptNextFogMove();
  }

  // ==========================================
  // FORCED MOVE SUB-PHASE
  // ==========================================

  private startForcedMovePhase(callback: () => void) {
    const fm = this.state.pendingForcedMove;
    if (!fm) {
      callback();
      return;
    }

    this.postForcedMoveCallback = callback;
    this.validTargets = fm.validTargets;
    this.state.stepInstruction = `Earth must move! Choose a hex for Kaijom.`;
    this.state.phase = 'EXECUTING';
    this.renderAll();
    this.board.highlightValidTargets(fm.validTargets, 'earth');
  }

  private handleForcedMoveClick(hexId: HexId) {
    this.executor.executeForcedMove(hexId);
    this.checkWin();
    const cb = this.postForcedMoveCallback;
    this.postForcedMoveCallback = null;
    if (cb) cb();
  }

  // ==========================================
  // CONFIRM / UNDO
  // ==========================================

  private onConfirm() {
    if (this.state.phase === 'CONFIRM' && this.selectedAction) {
      // Flame Dash special handling
      if (this.selectedAction === 'flame-dash') {
        const targetHex = this.actionTargets[0];
        const placeOnDest = !this.flameDashPlacedFirst;
        const result = this.executor.executeFlameDashMove(targetHex, placeOnDest);
        this.state.addLog(result);
        this.turnMgr.setActionMarker(this.selectedAction);
        this.checkWin();

        // Check for forced move (fire placed on Earth's hex)
        if (this.state.pendingForcedMove) {
          this.startForcedMovePhase(() => {
            this.finishTurn();
          });
          return;
        }

        this.finishTurn();
        return;
      }

      // Execute the action
      const result = this.executor.executeAction(this.selectedAction, this.actionTargets);
      this.state.addLog(result);
      this.turnMgr.setActionMarker(this.selectedAction);

      this.checkWin();

      // Check for forced move (Firestorm placed fire on Earth)
      if (this.state.pendingForcedMove) {
        this.startForcedMovePhase(() => {
          // After forced move, check if Mosey needs fog movement
          this.finishActionWithFogCheck();
        });
        return;
      }

      this.finishActionWithFogCheck();
    } else if (this.state.phase === 'EXECUTING' && this.selectedAction === 'landslide' && this.currentStep === 1) {
      // Landslide: confirm without destroying a mountain (skip optional step)
      this.state.phase = 'CONFIRM';
      this.onConfirm();
    } else if (this.state.phase === 'EXECUTING' && this.selectedAction === 'firestorm' && this.currentStep === 0) {
      // Firestorm: confirm placement phase early (less than 3), move to movement step
      this.currentStep = 1;
      const moveTargets = this.executor.getFirestormMoveTargets();
      this.validTargets = moveTargets;
      this.state.stepInstruction = `Move Krakatoa through connected fire`;
      this.board.render(this.state);
      this.board.highlightValidTargets(moveTargets, this.state.currentPlayer);
    }
  }

  /** After action execution, check if Mosey needs fog movement, then end turn */
  private finishActionWithFogCheck() {
    const wasMosey = this.selectedAction === 'mosey';
    const water = this.state.getPlayer('water');
    const didMove = wasMosey && this.actionTargets[0] !== water.hexId;

    if (wasMosey && didMove) {
      // Need to reset action state before fog phase
      const savedAction = this.selectedAction;
      this.selectedAction = null;
      this.actionTargets = [];
      this.currentStep = 0;
      this.savedState = null;
      this.state.stepInstruction = '';

      this.startFogMovePhase(1, () => {
        this.turnMgr.endTurn();
        this.executor = new ActionExecutor(this.state);
        this.renderAll();
      });
      return;
    }

    this.finishTurn();
  }

  private finishTurn() {
    this.selectedAction = null;
    this.actionTargets = [];
    this.currentStep = 0;
    this.savedState = null;
    this.state.stepInstruction = '';
    this.flameDashPlacedFirst = false;
    this.turnMgr.endTurn();
    this.executor = new ActionExecutor(this.state);
    this.renderAll();
  }

  private onUndo() {
    if (this.savedState) {
      // Restore state
      Object.assign(this.state, this.savedState);
      this.state.board = this.savedState.board;
      this.state.players = this.savedState.players;
      this.executor = new ActionExecutor(this.state);
    }

    this.selectedAction = null;
    this.actionTargets = [];
    this.currentStep = 0;
    this.validTargets = [];
    this.flameDashPlacedFirst = false;
    this.pendingFogMoves = [];
    this.fogMoveRange = 0;
    this.postFogCallback = null;
    this.postForcedMoveCallback = null;

    if (this.state.sotUsed) {
      this.state.phase = 'CHOOSE_ACTION';
    } else {
      this.state.phase = 'START_OF_TURN';
    }

    this.renderAll();
  }

  private getStepInstruction(actionId: ActionId, step: number): string {
    const NAMES: Record<ElementalType, string> = { earth: 'Kaijom', water: 'Nitsuji', fire: 'Krakatoa' };
    const name = NAMES[this.state.currentPlayer];

    switch (actionId) {
      case 'raise-mountain':
        return step === 0 ? `Move ${name} up to 1 hex` : 'Choose where to place a Mountain';
      case 'landslide':
        return step === 0 ? `Move ${name} (range = mountains on board)` : 'Choose a Mountain to destroy (optional)';
      case 'uproot':
        return `Move ${name} in a straight line`;
      case 'conjure':
        return 'Place a Lake on an empty hex within range';
      case 'firestorm':
        return step === 0 ? 'Choose a fire group to expand' : `Move ${name} through connected fire`;
      case 'flame-dash':
        return step === 0 ? `Move ${name} in a line, or click your hex to place Fire first` : `Move ${name} in a straight line`;
      case 'smoke-dash':
        return `Move ${name} in a straight line (up to 2)`;
      case 'firewall':
        return `Place Fire tokens in a line from ${name}`;
      case 'surf':
        return `Teleport ${name} to an empty shore hex`;
      case 'mosey':
        return `Move ${name} up to 1 hex`;
      case 'rematerialize':
        return 'Choose a Fog token to swap with';
      case 'sprout':
        return 'Choose a Lake adjacent to a Forest to convert';
      default:
        return 'Click a highlighted hex on the map';
    }
  }

  private checkWin() {
    const winner = checkWinConditions(this.state);
    if (winner) {
      this.state.winner = winner;
      const names: Record<ElementalType, string> = { earth: 'Kaijom', water: 'Nitsuji', fire: 'Krakatoa' };
      alert(`${names[winner]} wins!`);
    }
  }
}
