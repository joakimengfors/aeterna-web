// ========================================
// Hex Interaction Controller
// ========================================
// Orchestrates the game flow: SOT -> action selection -> target picking -> confirm

import { GameState } from '../game/GameState';
import { ActionExecutor } from '../game/ActionExecutor';
import { TurnManager } from '../game/TurnManager';
import { checkWinConditions } from '../game/WinChecker';
import { BoardRenderer } from './BoardRenderer';
import { PlayerPanel } from './PlayerPanel';
import { TopBar } from './TopBar';
import { GameDialog } from './GameDialog';
import type { ActionId, HexId, ElementalType } from '../game/types';
import { getActionsForElemental } from '../game/types';
import { getNeighbors, getLineHexes, isShore, ALL_HEX_IDS } from '../game/HexGrid';

const NAMES: Record<ElementalType, string> = { earth: 'Kaijom', water: 'Nitsuji', fire: 'Krakatoa' };

export class HexInteraction {
  private state: GameState;
  private executor: ActionExecutor;
  private turnMgr: TurnManager;
  private board: BoardRenderer;
  private playerPanel: PlayerPanel;
  private topBar: TopBar;
  private dialog: GameDialog;

  // State for multi-step actions
  private savedState: GameState | null = null;
  private selectedAction: ActionId | null = null;
  private actionTargets: HexId[] = [];
  private currentStep = 0;
  private validTargets: HexId[] = [];

  // Fog movement sub-phase
  private pendingFogMoves: HexId[] = [];
  private fogMoveRange = 0;
  private postFogCallback: (() => void) | null = null;
  private fogMoveIndex = 0;
  private fogMoveTotal = 0;

  // Forced move sub-phase
  private postForcedMoveCallback: (() => void) | null = null;

  // Flame Dash state
  private flameDashPlacedFirst = false;

  // Raise Mountain order state
  private raiseMountainPlaceFirst = false;

  // Mosey fog fix: save water hex before action execution
  private waterHexBeforeMosey: HexId | null = null;

  constructor(
    state: GameState,
    board: BoardRenderer,
    playerPanel: PlayerPanel,
    topBar: TopBar,
    dialog: GameDialog,
  ) {
    this.state = state;
    this.executor = new ActionExecutor(state);
    this.turnMgr = new TurnManager(state);
    this.board = board;
    this.playerPanel = playerPanel;
    this.topBar = topBar;
    this.dialog = dialog;

    this.board.setHexClickHandler((hexId) => this.onHexClick(hexId));
    this.topBar.setOnCancel(() => this.onUndo());
    this.showTurnBanner(() => this.renderAll());
  }

  private renderAll() {
    const layout = document.querySelector('.game-layout');
    if (layout) {
      layout.className = `game-layout theme-${this.state.currentPlayer}`;
    }

    this.board.render(this.state);
    this.board.clearHighlights();
    this.playerPanel.render(this.state);
    this.topBar.setOnCancel(() => this.onUndo());
    this.topBar.render(this.state);

    // Update character switcher
    document.querySelectorAll('.char-switcher-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-el') === this.state.currentPlayer);
    });

    // Auto-start SOT ability when entering START_OF_TURN
    if (this.state.phase === 'START_OF_TURN') {
      this.onSOTStart();
    }
    // Show action choice dialog when entering CHOOSE_ACTION
    else if (this.state.phase === 'CHOOSE_ACTION') {
      const actions = getActionsForElemental(this.state.currentPlayer);
      const player = this.state.getPlayer(this.state.currentPlayer);
      const specialCard = this.state.specialDeck.activeCard;
      this.dialog.showActionChoice(
        actions,
        player.actionMarker,
        specialCard ? specialCard.name : null,
        (actionId) => this.onActionSelected(actionId),
      );
    }
  }

  // ==========================================
  // SHOW CONFIRM DIALOG
  // ==========================================

  private showConfirmDialog() {
    const actionName = this.selectedAction ? this.getActionDisplayName(this.selectedAction) : 'Start of Turn';
    this.dialog.showConfirm(
      `Execute <strong>${actionName}</strong>?`,
      () => this.onConfirm(),
      () => this.onUndo(),
    );
  }

  private getActionDisplayName(actionId: ActionId): string {
    const map: Record<string, string> = {
      'uproot': 'Uproot', 'raise-mountain': 'Raise Mountain', 'landslide': 'Landslide', 'sprout': 'Sprout',
      'mosey': 'Mosey', 'conjure': 'Conjure Lakes', 'surf': 'Ocean Surf', 'rematerialize': 'Re-Materialize',
      'smoke-dash': 'Smoke Dash', 'flame-dash': 'Flame Dash', 'firestorm': 'Firestorm', 'firewall': 'Firewall',
      'special': 'Special Ability',
    };
    return map[actionId] || actionId;
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
    this.state.stepInstruction = this.getSOTInstruction();

    // Show targets and non-blocking SOT dialog (hex clicks pass through)
    this.board.render(this.state);
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.topBar.render(this.state);

    this.dialog.showSOT(this.state.currentPlayer, () => {
      // OK — just dismiss, targets already active
    }, () => {
      // Skip SOT
      this.onSOTSkip();
    });
  }

  private getSOTInstruction(): string {
    const name = NAMES[this.state.currentPlayer];
    switch (this.state.currentPlayer) {
      case 'earth': return `Move Stone Minion 1 hex`;
      case 'water': return `Move ${name} 1 hex, or teleport to a Lake or Fog`;
      case 'fire': return `Place Fire under ${name} or adjacent to existing fire`;
      default: return 'Use Start of Turn ability';
    }
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
    this.raiseMountainPlaceFirst = false;
    this.waterHexBeforeMosey = null;

    if (actionId === 'special') {
      this.handleSpecialAbility();
      return;
    }

    // Raise Mountain: order choice
    if (actionId === 'raise-mountain') {
      this.dialog.showChoice('Raise Mountain', 'Choose your action order:', [
        {
          text: 'Move First',
          callback: () => {
            this.raiseMountainPlaceFirst = false;
            this.startActionWithInfoDialog(actionId);
          },
        },
        {
          text: 'Place Mountain First',
          primary: false,
          callback: () => {
            this.raiseMountainPlaceFirst = true;
            // Start with place targets
            const targets = this.executor.getRaiseMountainPlaceTargets();
            if (targets.length === 0) {
              this.selectedAction = null;
              this.state.phase = 'CHOOSE_ACTION';
              this.renderAll();
              return;
            }
            const instruction = 'Place a Mountain on any empty hex';
            this.dialog.showInfo('Raise Mountain', instruction, () => {
              this.validTargets = targets;
              this.state.phase = 'EXECUTING';
              this.state.pendingAction = actionId;
              this.state.stepInstruction = instruction;
              this.board.render(this.state);
              this.board.highlightValidTargets(targets, this.state.currentPlayer);
              this.topBar.render(this.state);
            });
          },
        },
      ]);
      return;
    }

    // Flame Dash: order choice
    if (actionId === 'flame-dash') {
      const canPlaceFirst = this.executor.canFlameDashPlaceFirst();
      if (canPlaceFirst) {
        this.dialog.showChoice('Flame Dash', 'Choose your action order:', [
          {
            text: 'Place Fire First',
            callback: () => {
              this.flameDashPlacedFirst = true;
              const fire = this.state.getPlayer('fire');
              if (this.state.takeFromSupply('fire', 'fire')) {
                this.state.addToken(fire.hexId, 'fire');
              }
              this.currentStep = 1;
              const moveTargets = this.executor.getFlameDashTargets();
              const instruction = `Move ${NAMES.fire} in a straight line`;
              this.dialog.showInfo('Flame Dash', instruction, () => {
                this.validTargets = moveTargets;
                this.state.phase = 'EXECUTING';
                this.state.pendingAction = actionId;
                this.state.stepInstruction = instruction;
                this.board.render(this.state);
                this.board.highlightValidTargets(moveTargets, 'fire');
                this.topBar.render(this.state);
              });
            },
          },
          {
            text: 'Move First',
            primary: false,
            callback: () => this.startActionWithInfoDialog(actionId),
          },
        ]);
      } else {
        this.startActionWithInfoDialog(actionId);
      }
      return;
    }

    this.startActionWithInfoDialog(actionId);
  }

  /** Show info dialog with step instruction, then highlight targets */
  private startActionWithInfoDialog(actionId: ActionId) {
    const targets = this.executor.getValidTargets(actionId);

    if (targets.length === 0) {
      this.selectedAction = null;
      this.state.phase = 'CHOOSE_ACTION';
      this.renderAll();
      return;
    }

    const instruction = this.getStepInstruction(actionId, 0);
    const displayName = this.getActionDisplayName(actionId);

    this.dialog.showInfo(displayName, instruction, () => {
      this.validTargets = targets;
      this.state.phase = 'EXECUTING';
      this.state.pendingAction = actionId;
      this.state.stepInstruction = instruction;
      this.board.render(this.state);
      this.board.highlightValidTargets(targets, this.state.currentPlayer);
      this.topBar.render(this.state);
    });
  }

  private handleSpecialAbility() {
    const card = this.state.specialDeck.activeCard;
    if (!card) return;

    switch (card.id) {
      case 'start-of-turn':
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
    this.state.stepInstruction = `Move ${NAMES[this.state.currentPlayer]} up to ${range} hexes (ignore terrain)`;
    this.board.render(this.state);
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.topBar.render(this.state);
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
    this.state.stepInstruction = `Move ${NAMES[this.state.currentPlayer]} up to ${range} hexes in a straight line`;
    this.board.render(this.state);
    this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
    this.topBar.render(this.state);
  }

  private executeSpecialTeleportShore() {
    const targets = ALL_HEX_IDS.filter((id) => isShore(id) && this.state.isHexEmpty(id));
    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = 'special';
    this.state.stepInstruction = `Teleport ${NAMES[this.state.currentPlayer]} to any empty shore hex`;
    this.board.render(this.state);
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.topBar.render(this.state);
  }

  private executeSpecialSwap() {
    const targets: HexId[] = [];
    for (const type of this.state.turnOrder) {
      targets.push(this.state.getPlayer(type).hexId);
    }
    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = 'special';
    this.state.stepInstruction = `Choose an elemental to swap with ${NAMES[this.state.currentPlayer]}`;
    this.currentStep = 0;
    this.board.render(this.state);
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.topBar.render(this.state);
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
      // SOT execution — hide SOT info, show confirm dialog
      this.dialog.hide();
      this.actionTargets = [hexId];
      this.board.highlightSelected(hexId);
      this.state.phase = 'CONFIRM';
      this.topBar.render(this.state);
      this.dialog.showConfirm(
        `Execute <strong>Start of Turn</strong> ability?`,
        () => {
          this.dialog.hide();
          this.executor.executeSOT(hexId);
          this.checkWin();

          if (this.state.pendingForcedMove) {
            this.startForcedMovePhase(() => {
              this.finishSOT();
            });
            return;
          }

          this.finishSOT();
        },
        () => this.onUndo(),
      );
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

    // Single-step actions
    this.actionTargets = [hexId];
    this.board.highlightSelected(hexId);
    this.state.phase = 'CONFIRM';
    this.topBar.render(this.state);
    this.showConfirmDialog();
  }

  /** After Water SOT completes, handle fog movement then advance to CHOOSE_ACTION */
  private finishSOT() {
    if (this.state.currentPlayer === 'water' && this.state.pendingFogMove) {
      this.state.pendingFogMove = false;
      const fogHexes = this.executor.getFogTokenHexes();
      if (fogHexes.length > 0) {
        this.dialog.showChoice('Fog Movement', `Move your ${fogHexes.length} Fog token${fogHexes.length > 1 ? 's' : ''}?`, [
          { text: 'Yes', callback: () => {
            this.startFogMovePhase(1, () => {
              this.state.phase = 'CHOOSE_ACTION';
              this.renderAll();
            });
          }},
          { text: 'No', primary: false, callback: () => {
            this.state.phase = 'CHOOSE_ACTION';
            this.renderAll();
          }},
        ]);
        return;
      }
    }
    this.state.phase = 'CHOOSE_ACTION';
    this.renderAll();
  }

  private handleRaiseMountainStep(hexId: HexId) {
    if (this.currentStep === 0) {
      this.actionTargets.push(hexId);
      this.currentStep = 1;

      if (this.raiseMountainPlaceFirst) {
        // Step 0 was place — apply mountain placement
        this.state.addToken(hexId, 'mountain');
        // Step 1: move
        const instruction = `Move ${NAMES.earth} up to 1 hex`;
        const targets = this.executor.getValidTargets('raise-mountain');
        this.dialog.showInfo('Raise Mountain', instruction, () => {
          this.validTargets = targets;
          this.state.stepInstruction = instruction;
          this.board.render(this.state);
          this.board.highlightValidTargets(targets, this.state.currentPlayer);
          this.topBar.render(this.state);
        });
      } else {
        // Step 0 was move — apply movement
        const earth = this.state.getPlayer('earth');
        if (hexId !== earth.hexId) {
          this.state.setElementalOnHex(hexId, 'earth');
        }
        // Step 1: place mountain
        const instruction = 'Place a Mountain on any empty hex';
        const targets = this.executor.getRaiseMountainPlaceTargets();
        this.dialog.showInfo('Raise Mountain', instruction, () => {
          this.validTargets = targets;
          this.state.stepInstruction = instruction;
          this.board.render(this.state);
          this.board.highlightValidTargets(targets, this.state.currentPlayer);
          this.topBar.render(this.state);
        });
      }
    } else {
      this.actionTargets.push(hexId);

      if (this.raiseMountainPlaceFirst) {
        // Step 1 was move — apply movement
        const earth = this.state.getPlayer('earth');
        if (hexId !== earth.hexId) {
          this.state.setElementalOnHex(hexId, 'earth');
        }
      } else {
        // Step 1 was place — apply mountain
        this.state.addToken(hexId, 'mountain');
      }

      this.state.phase = 'CONFIRM';
      this.board.render(this.state);
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    }
  }

  private handleLandslideStep(hexId: HexId) {
    if (this.currentStep === 0) {
      this.actionTargets.push(hexId);
      this.currentStep = 1;

      const earth = this.state.getPlayer('earth');
      if (hexId !== earth.hexId) {
        this.state.setElementalOnHex(hexId, 'earth');
      }

      const targets = this.executor.getLandslideDestroyTargets();
      if (targets.length === 0) {
        this.state.phase = 'CONFIRM';
        this.topBar.render(this.state);
        this.showConfirmDialog();
        return;
      }

      this.dialog.showChoice('Landslide', 'Destroy a Mountain?', [
        { text: 'Choose a Mountain', callback: () => {
          this.state.stepInstruction = 'Choose a Mountain to destroy';
          this.validTargets = targets;
          this.board.render(this.state);
          this.board.highlightValidTargets(targets, this.state.currentPlayer);
          this.topBar.render(this.state);

          for (const mt of targets) {
            const neighbors = getNeighbors(mt);
            const dangerHexes = neighbors.filter(n => {
              const hex = this.state.getHex(n);
              return hex.tokens.some(t => t !== 'fog');
            });
            this.board.highlightDanger(dangerHexes);
          }
        }},
        { text: 'Skip', primary: false, callback: () => {
          this.state.phase = 'CONFIRM';
          this.topBar.render(this.state);
          this.showConfirmDialog();
        }},
      ]);
    } else {
      this.actionTargets.push(hexId);
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    }
  }

  private handleConjureStep(hexId: HexId) {
    this.actionTargets.push(hexId);
    this.board.highlightSelected(hexId);

    if (this.actionTargets.length >= 2) {
      this.state.phase = 'CONFIRM';
      this.topBar.render(this.state);
      for (const t of this.actionTargets) this.board.highlightSelected(t);
      this.showConfirmDialog();
    } else {
      this.validTargets = this.validTargets.filter(t => t !== hexId);
      const instruction = 'Place 1 more Lake on an empty hex within range';
      this.dialog.showInfo('Conjure Lakes', instruction, () => {
        this.state.stepInstruction = instruction;
        this.board.render(this.state);
        this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
        this.board.highlightSelected(hexId);
        this.topBar.render(this.state);
      });
    }
  }

  private handleFirestormStep(hexId: HexId) {
    this.actionTargets.push(hexId);
    this.board.highlightSelected(hexId);

    if (this.currentStep === 1) {
      this.state.phase = 'CONFIRM';
      this.topBar.render(this.state);
      this.showConfirmDialog();
      return;
    }

    if (this.actionTargets.length >= 3) {
      this.firestormMoveToMovement();
      return;
    }

    const remaining = 3 - this.actionTargets.length;
    this.validTargets = this.validTargets.filter(t => t !== hexId);

    this.dialog.showChoice('Firestorm', `${this.actionTargets.length} fire token${this.actionTargets.length > 1 ? 's' : ''} placed. Place more or move?`, [
      { text: `Place More (${remaining} left)`, callback: () => {
        this.state.stepInstruction = `Place fire adjacent to existing fire (${remaining} remaining)`;
        this.board.render(this.state);
        this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
        for (const t of this.actionTargets) this.board.highlightSelected(t);
        this.topBar.render(this.state);
      }},
      { text: 'Move Now', primary: false, callback: () => {
        this.firestormMoveToMovement();
      }},
    ]);
  }

  private firestormMoveToMovement() {
    this.currentStep = 1;
    const instruction = `Move ${NAMES.fire} through connected fire`;
    const moveTargets = this.executor.getFirestormMoveTargets();
    this.dialog.showInfo('Firestorm', instruction, () => {
      this.state.stepInstruction = instruction;
      this.validTargets = moveTargets;
      this.board.render(this.state);
      this.board.highlightValidTargets(moveTargets, this.state.currentPlayer);
      this.topBar.render(this.state);
    });
  }

  private handleFlameDashStep(hexId: HexId) {
    this.actionTargets = [hexId];
    this.state.phase = 'CONFIRM';
    this.board.render(this.state);
    this.board.highlightSelected(hexId);
    this.topBar.render(this.state);
    this.showConfirmDialog();
  }

  private handleSpecialStep(hexId: HexId) {
    this.actionTargets.push(hexId);
    this.state.setElementalOnHex(hexId, this.state.currentPlayer);
    this.state.phase = 'CONFIRM';
    this.checkWin();
    this.board.render(this.state);
    this.board.highlightSelected(hexId);
    this.topBar.render(this.state);
    this.showConfirmDialog();
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
    this.fogMoveIndex = 0;
    this.fogMoveTotal = fogHexes.length;
    this.postFogCallback = callback;
    this.promptNextFogMove();
  }

  private promptNextFogMove() {
    if (this.pendingFogMoves.length === 0) {
      const cb = this.postFogCallback;
      this.postFogCallback = null;
      this.fogMoveRange = 0;
      this.fogMoveIndex = 0;
      this.fogMoveTotal = 0;
      if (cb) cb();
      return;
    }

    this.fogMoveIndex++;
    const fogHex = this.pendingFogMoves[0];
    const targets = this.executor.getFogMoveTargets(fogHex, this.fogMoveRange);
    this.validTargets = targets;

    if (this.fogMoveTotal === 1) {
      this.state.stepInstruction = `Move your Fog (click its hex to skip)`;
    } else {
      const ordinal = this.fogMoveIndex === 1 ? 'first' : 'second';
      this.state.stepInstruction = `Move your ${ordinal} Fog (click its hex to skip)`;
    }

    this.state.phase = 'EXECUTING';
    this.board.render(this.state);
    this.board.highlightValidTargets(targets, 'water');
    this.topBar.render(this.state);
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
    this.dialog.showInfo(
      'Forced Move!',
      'Fire was placed on Kaijom\'s hex. Earth must move!',
      () => {
        this.validTargets = fm.validTargets;
        this.state.stepInstruction = 'Choose a hex for Kaijom';
        this.state.phase = 'EXECUTING';
        this.board.render(this.state);
        this.board.highlightValidTargets(fm.validTargets, 'earth');
        this.topBar.render(this.state);
      },
    );
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
    this.dialog.hide();

    if (this.state.phase === 'CONFIRM' && this.selectedAction) {
      // Flame Dash special handling
      if (this.selectedAction === 'flame-dash') {
        const targetHex = this.actionTargets[0];
        const placeOnDest = !this.flameDashPlacedFirst;
        const result = this.executor.executeFlameDashMove(targetHex, placeOnDest);
        this.state.addLog(result);
        this.turnMgr.setActionMarker(this.selectedAction);
        this.checkWin();

        if (this.state.pendingForcedMove) {
          this.startForcedMovePhase(() => {
            this.finishTurn();
          });
          return;
        }

        this.finishTurn();
        return;
      }

      // Raise Mountain with place-first: swap targets so executor gets [moveHex, placeHex]
      if (this.selectedAction === 'raise-mountain' && this.raiseMountainPlaceFirst) {
        this.actionTargets = [this.actionTargets[1], this.actionTargets[0]];
      }

      // Save water hex before mosey execution for fog check
      if (this.selectedAction === 'mosey') {
        const water = this.state.getPlayer('water');
        this.waterHexBeforeMosey = water.hexId;
      }

      // Execute the action
      const result = this.executor.executeAction(this.selectedAction, this.actionTargets);
      this.state.addLog(result);
      this.turnMgr.setActionMarker(this.selectedAction);

      this.checkWin();

      if (this.state.pendingForcedMove) {
        this.startForcedMovePhase(() => {
          this.finishActionWithFogCheck();
        });
        return;
      }

      this.finishActionWithFogCheck();
    } else if (this.state.phase === 'EXECUTING' && this.selectedAction === 'landslide' && this.currentStep === 1) {
      this.state.phase = 'CONFIRM';
      this.onConfirm();
    } else if (this.state.phase === 'EXECUTING' && this.selectedAction === 'firestorm' && this.currentStep === 0) {
      this.currentStep = 1;
      const moveTargets = this.executor.getFirestormMoveTargets();
      this.validTargets = moveTargets;
      this.state.stepInstruction = `Move ${NAMES.fire} through connected fire`;
      this.board.render(this.state);
      this.board.highlightValidTargets(moveTargets, this.state.currentPlayer);
      this.topBar.render(this.state);
    }
  }

  /** After action execution, check if Mosey needs fog movement, then end turn */
  private finishActionWithFogCheck() {
    const wasMosey = this.selectedAction === 'mosey';
    const water = this.state.getPlayer('water');
    // Use saved hex from before execution to correctly detect movement
    const didMove = wasMosey && this.waterHexBeforeMosey !== null && this.waterHexBeforeMosey !== water.hexId;

    if (wasMosey && didMove) {
      this.selectedAction = null;
      this.actionTargets = [];
      this.currentStep = 0;
      this.savedState = null;
      this.state.stepInstruction = '';
      this.waterHexBeforeMosey = null;

      const fogHexes = this.executor.getFogTokenHexes();
      if (fogHexes.length > 0) {
        this.dialog.showChoice('Fog Movement', `Move your ${fogHexes.length} Fog token${fogHexes.length > 1 ? 's' : ''}?`, [
          { text: 'Yes', callback: () => {
            this.startFogMovePhase(1, () => {
              this.turnMgr.endTurn();
              this.executor = new ActionExecutor(this.state);
              this.showTurnBanner(() => this.renderAll());
            });
          }},
          { text: 'No', primary: false, callback: () => {
            this.turnMgr.endTurn();
            this.executor = new ActionExecutor(this.state);
            this.showTurnBanner(() => this.renderAll());
          }},
        ]);
        return;
      }

      this.turnMgr.endTurn();
      this.executor = new ActionExecutor(this.state);
      this.showTurnBanner(() => this.renderAll());
      return;
    }

    this.waterHexBeforeMosey = null;
    this.finishTurn();
  }

  private finishTurn() {
    this.selectedAction = null;
    this.actionTargets = [];
    this.currentStep = 0;
    this.savedState = null;
    this.state.stepInstruction = '';
    this.flameDashPlacedFirst = false;
    this.raiseMountainPlaceFirst = false;
    this.waterHexBeforeMosey = null;
    this.turnMgr.endTurn();
    this.executor = new ActionExecutor(this.state);
    this.showTurnBanner(() => this.renderAll());
  }

  private showTurnBanner(callback: () => void) {
    const name = NAMES[this.state.currentPlayer];
    // Apply theme immediately so banner picks up correct colors
    const layout = document.querySelector('.game-layout');
    if (layout) layout.className = `game-layout theme-${this.state.currentPlayer}`;

    const banner = document.createElement('div');
    banner.className = 'turn-banner';
    banner.innerHTML = `<div class="turn-banner-text">${name}'s Turn!</div>`;
    document.body.appendChild(banner);

    // Remove banner after animation; show UI immediately
    setTimeout(() => banner.remove(), 1600);
    callback();
  }

  private onUndo() {
    this.dialog.hide();

    const wasSOT = !this.selectedAction && this.state.phase === 'EXECUTING';

    if (this.savedState) {
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
    this.raiseMountainPlaceFirst = false;
    this.waterHexBeforeMosey = null;
    this.pendingFogMoves = [];
    this.fogMoveRange = 0;
    this.fogMoveIndex = 0;
    this.fogMoveTotal = 0;
    this.postFogCallback = null;
    this.postForcedMoveCallback = null;

    if (wasSOT) {
      // Cancel during SOT = skip SOT
      this.state.phase = 'CHOOSE_ACTION';
      this.state.sotUsed = false;
    } else if (this.state.sotUsed) {
      this.state.phase = 'CHOOSE_ACTION';
    } else {
      this.state.phase = 'START_OF_TURN';
    }

    this.renderAll();
  }

  private getStepInstruction(actionId: ActionId, step: number): string {
    const name = NAMES[this.state.currentPlayer];

    switch (actionId) {
      case 'raise-mountain':
        return step === 0 ? `Move ${name} up to 1 hex` : 'Place a Mountain on any empty hex';
      case 'landslide': {
        const mtCount = ALL_HEX_IDS.reduce((n, id) => n + (this.state.getHex(id).tokens.includes('mountain') ? 1 : 0), 0);
        return step === 0 ? `Move ${name} up to ${mtCount} hex${mtCount !== 1 ? 'es' : ''} (1 per mountain on board)` : 'Choose a Mountain to destroy (optional)';
      }
      case 'uproot':
        return `Move ${name} in a straight line`;
      case 'conjure':
        return 'Place 2 Lakes on empty hexes within 3 range';
      case 'firestorm':
        return step === 0 ? 'Place up to 3 fire tokens adjacent to existing fire (3 remaining)' : `Move ${name} through connected fire`;
      case 'flame-dash':
        return `Move ${name} in a straight line`;
      case 'smoke-dash':
        return `Move ${name} in a straight line (up to 2)`;
      case 'firewall':
        return `Choose a direction to place up to 3 Fire tokens in a line`;
      case 'surf':
        return `Teleport ${name} to an empty shore hex`;
      case 'mosey':
        return `Move ${name} up to 1 hex`;
      case 'rematerialize':
        return `Choose a Fog token to swap with ${name}`;
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
