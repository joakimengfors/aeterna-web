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
import { getNeighbors, getLineHexes, isShore, ALL_HEX_IDS, getShortestPath, getPixelPos } from '../game/HexGrid';
import type { NetworkController } from '../network/NetworkController';

const NAMES: Record<ElementalType, string> = { earth: 'Kaijom', water: 'Nitsuji', fire: 'Krakatoa', aeterna: 'Aeterna' };

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

  // Firestorm: snapshot of fire groups at start, track which have been extended
  private firestormGroups: { id: string; hexes: Set<HexId> }[] = [];
  private firestormExtendedGroupIds = new Set<string>();
  private firestormMaxTokens = 0;

  // Track which special card is being executed
  private activeSpecialCardId: string | null = null;

  // Mosey fog fix: save water hex before action execution
  private waterHexBeforeMosey: HexId | null = null;

  // Animation: pending move animation to play after render
  private pendingAnimation: { type: ElementalType | 'minion'; path: HexId[] } | null = null;

  // Network
  private network: NetworkController | null = null;

  constructor(
    state: GameState,
    board: BoardRenderer,
    playerPanel: PlayerPanel,
    topBar: TopBar,
    dialog: GameDialog,
    network?: NetworkController,
  ) {
    this.state = state;
    this.executor = new ActionExecutor(state);
    this.turnMgr = new TurnManager(state);
    this.board = board;
    this.playerPanel = playerPanel;
    this.topBar = topBar;
    this.dialog = dialog;
    this.network = network || null;

    if (this.network) {
      this.setupNetworkHandlers();
    }

    this.board.setHexClickHandler((hexId) => this.onHexClick(hexId));
    this.topBar.onMenuClick(() => this.returnToMenu());
    this.showTurnBanner(() => this.renderAll());
  }

  private get isMultiplayer(): boolean {
    return this.state.localPlayer !== null;
  }

  private get isMyTurn(): boolean {
    if (!this.isMultiplayer) return true;
    return this.state.currentPlayer === this.state.localPlayer;
  }

  private setupNetworkHandlers() {
    if (!this.network) return;

    // Both host and guest receive state updates
    this.network.onRemoteState((data) => {
      if (this.network!.isHost) {
        // Host received state from a guest who finished their turn — validate & rebroadcast
        this.applyRemoteState(data);
        this.network!.broadcastState(this.state);
      } else {
        // Guest received authoritative state from host
        this.applyRemoteState(data);
      }
    });

    this.network.onPeerDisconnected((_peerId) => {
      this.dialog.showInfo('Disconnected', 'A player has disconnected from the game.');
    });
  }

  /** Send state to the network after a turn ends or game ends */
  private syncState() {
    if (!this.network) return;
    if (this.network.isHost) {
      this.network.broadcastState(this.state);
    } else {
      this.network.sendStateToHost(this.state);
    }
  }

  private applyRemoteState(stateData: any) {
    const newState = GameState.fromJSON(stateData);
    newState.localPlayer = this.state.localPlayer;

    const prevPlayer = this.state.currentPlayer;

    // Replace state fields
    this.state.board = newState.board;
    this.state.players = newState.players;
    this.state.turnOrder = newState.turnOrder;
    this.state.currentPlayerIndex = newState.currentPlayerIndex;
    this.state.turnNumber = newState.turnNumber;
    this.state.phase = newState.phase;
    this.state.specialDeck = newState.specialDeck;
    this.state.log = newState.log;
    this.state.winner = newState.winner;
    this.state.pendingAction = newState.pendingAction;
    this.state.pendingSteps = newState.pendingSteps;
    this.state.stepInstruction = newState.stepInstruction;
    this.state.sotUsed = newState.sotUsed;
    this.state.pendingForcedMove = newState.pendingForcedMove;
    this.state.pendingFogMove = newState.pendingFogMove;

    // Reset local interaction state
    this.selectedAction = null;
    this.actionTargets = [];
    this.currentStep = 0;
    this.savedState = null;
    this.validTargets = [];
    this.pendingFogMoves = [];
    this.postFogCallback = null;
    this.postForcedMoveCallback = null;

    this.executor = new ActionExecutor(this.state);

    // Check if game is over
    if (this.state.winner) {
      this.board.render(this.state);
      this.dialog.showVictory(this.state, {
        onRematch: () => this.returnToMenu(),
        onReturnToMenu: () => this.returnToMenu(),
        onReturnToLobby: this.network ? () => this.returnToMenu() : undefined,
      });
      return;
    }

    // Show turn banner if the current player changed
    if (this.state.currentPlayer !== prevPlayer) {
      this.showTurnBanner(() => this.renderAll());
    } else {
      this.renderAll();
    }
  }

  /** Queue a movement animation to play after the next board.render() call */
  private queueMoveAnimation(type: ElementalType | 'minion', fromHex: HexId, toHex: HexId, action?: ActionId) {
    if (fromHex === toHex) return;

    let path: HexId[];

    // Straight-line actions: compute the line path
    if (action === 'smoke-dash' || action === 'flame-dash') {
      const lines = getLineHexes(fromHex, 4);
      const line = lines.find(l => l.hexes.includes(toHex));
      if (line) {
        const idx = line.hexes.indexOf(toHex);
        path = [fromHex, ...line.hexes.slice(0, idx + 1)];
      } else {
        path = [fromHex, toHex];
      }
    }
    // Firestorm: fire moves through connected fire tokens
    else if (action === 'firestorm') {
      const bfsPath = getShortestPath(fromHex, toHex, (h) => {
        // Allow fire-token hexes and the destination (which may be 1 hex beyond fire)
        if (h === toHex) return true;
        return this.state.hasToken(h, 'fire');
      });
      path = [fromHex, ...bfsPath];
    }
    // BFS-based movement: compute shortest path through walkable hexes
    else if (action === 'uproot' || action === 'landslide') {
      const bfsPath = getShortestPath(fromHex, toHex, (h) => {
        const hex = this.state.getHex(h);
        if (type === 'minion') return true;
        if (type === 'earth') {
          if (hex.tokens.includes('fire')) return false;
          if (hex.tokens.includes('mountain')) return false;
        }
        if (type === 'fire') {
          if (hex.tokens.includes('mountain')) return false;
          if (hex.tokens.includes('lake')) return false;
        }
        if (type === 'water') {
          if (hex.tokens.includes('mountain')) return false;
        }
        return true;
      });
      path = [fromHex, ...bfsPath];
    }
    // 1-hex moves or teleports: just direct
    else {
      path = [fromHex, toHex];
    }

    this.pendingAnimation = { type, path };
  }

  /** Queue animation based on action type and targets */
  private queueMoveAnimationForAction(action: ActionId, targets: HexId[]) {
    const moveTarget = targets[0];
    switch (action) {
      case 'uproot':
      case 'landslide':
      case 'raise-mountain': {
        const earth = this.state.getPlayer('earth');
        this.queueMoveAnimation('earth', earth.hexId, moveTarget, action);
        break;
      }
      case 'mosey':
      case 'surf':
      case 'rematerialize': {
        const water = this.state.getPlayer('water');
        this.queueMoveAnimation('water', water.hexId, moveTarget, action);
        break;
      }
      case 'smoke-dash': {
        const fire = this.state.getPlayer('fire');
        this.queueMoveAnimation('fire', fire.hexId, moveTarget, action);
        break;
      }
      case 'firestorm': {
        // Last target is the move hex
        const fire = this.state.getPlayer('fire');
        const fireMoveTarget = targets[targets.length - 1];
        this.queueMoveAnimation('fire', fire.hexId, fireMoveTarget, action);
        break;
      }
    }
  }

  /** Play any pending animation. Returns a promise that resolves when done. */
  private async playPendingAnimation(): Promise<void> {
    if (!this.pendingAnimation) return;
    const { type, path } = this.pendingAnimation;
    this.pendingAnimation = null;
    await this.board.animateStandee(type, path);
  }

  private renderAll() {
    const layout = document.querySelector('.game-layout');
    if (layout) {
      layout.className = `game-layout theme-${this.state.currentPlayer}`;
    }

    this.board.render(this.state);
    this.board.clearHighlights();
    this.playerPanel.render(this.state);
    this.topBar.render(this.state);
    this.dialog.setTheme(this.state.currentPlayer);

    // In multiplayer, show waiting message when it's not our turn
    if (this.isMultiplayer && !this.isMyTurn) {
      const waitingName = NAMES[this.state.currentPlayer];
      this.dialog.showInfo(`Waiting for ${waitingName}...`, `${waitingName} is taking their turn.`);
      return;
    }

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
      'tides-embrace': "Tide's Embrace", 'ash-to-lush': 'Ash to Lush', 'bark-and-bough': 'Bark and Bough', 'aeternas-favor': "Aeterna's Favor",
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

    this.dialog.showSOT(this.state.currentPlayer, () => this.onSOTSkip());
  }

  private getSOTInstruction(): string {
    const name = NAMES[this.state.currentPlayer];
    switch (this.state.currentPlayer) {
      case 'earth': return `Move Stone Minion 1 hex`;
      case 'water': return `Move ${name} 1 hex, or teleport to a Lake or Fog`;
      case 'fire': return `Place Fire under ${name} or adjacent to existing fire`;
      case 'aeterna': return 'Pick a token to duplicate';
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
    if (this.isMultiplayer && !this.isMyTurn) return;
    this.savedState = this.state.clone();
    this.selectedAction = actionId;
    this.actionTargets = [];
    this.currentStep = 0;
    this.flameDashPlacedFirst = false;
    this.raiseMountainPlaceFirst = false;
    this.firestormGroups = [];
    this.firestormExtendedGroupIds.clear();
    this.firestormMaxTokens = 0;
    this.waterHexBeforeMosey = null;

    if (actionId === 'special') {
      this.handleSpecialAbility();
      return;
    }

    if (actionId === 'aeternas-favor') {
      this.handleAeternasFavor();
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
            this.validTargets = targets;
            this.state.phase = 'EXECUTING';
            this.state.pendingAction = actionId;
            this.state.stepInstruction = instruction;
            this.board.render(this.state);
            this.board.highlightValidTargets(targets, this.state.currentPlayer);
            this.topBar.render(this.state);
            this.dialog.showInfo('Raise Mountain', instruction, () => this.onUndo());
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
              this.validTargets = moveTargets;
              this.state.phase = 'EXECUTING';
              this.state.pendingAction = actionId;
              this.state.stepInstruction = instruction;
              this.board.render(this.state);
              this.board.highlightValidTargets(moveTargets, 'fire');
              this.topBar.render(this.state);
              this.dialog.showInfo('Flame Dash', instruction, () => this.onUndo());
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

    if (actionId === 'firestorm') {
      this.firestormGroups = this.executor.getFireGroups();
      this.firestormMaxTokens = Math.min(this.firestormGroups.length, 3);
    }

    const instruction = this.getStepInstruction(actionId, 0);
    const displayName = this.getActionDisplayName(actionId);

    this.validTargets = targets;
    this.state.phase = 'EXECUTING';
    this.state.pendingAction = actionId;
    this.state.stepInstruction = instruction;
    this.board.render(this.state);
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.topBar.render(this.state);
    this.dialog.showInfo(displayName, instruction, () => this.onUndo());
  }

  private handleSpecialAbility() {
    const card = this.state.specialDeck.activeCard;
    if (!card) return;
    this.activeSpecialCardId = card.id;

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
    this.state.stepInstruction = 'Choose the first elemental to swap';
    this.currentStep = 0;
    this.board.render(this.state);
    this.board.highlightValidTargets(targets, this.state.currentPlayer);
    this.topBar.render(this.state);
    this.dialog.showInfo('Swap Places', 'Choose 2 elementals to swap places', () => this.onUndo());
  }

  // ==========================================
  // HEX CLICKS
  // ==========================================

  private onHexClick(hexId: HexId) {
    if (this.isMultiplayer && !this.isMyTurn) return;
    if (!this.validTargets.includes(hexId)) return;

    // Auto-dismiss any non-blocking info dialog
    this.dialog.hide();

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
      const type = this.state.currentPlayer;

      // Aeterna SOT: 2-step (source, then destination)
      if (type === 'aeterna') {
        if (this.currentStep === 0) {
          // Step 1: picked source token hex
          this.actionTargets = [hexId];
          this.currentStep = 1;
          this.board.highlightSelected(hexId);
          const destTargets = this.executor.getAeternaSOTDestTargets(hexId);
          this.validTargets = destTargets;
          this.state.stepInstruction = 'Choose an empty hex within 2 range';
          this.board.render(this.state);
          this.board.highlightValidTargets(destTargets, 'aeterna');
          this.board.highlightSelected(hexId);
          this.topBar.render(this.state);
          this.dialog.showInfo('Duplicate Token', 'Choose destination hex', () => this.onUndo());
          return;
        } else {
          // Step 2: picked destination — confirm
          this.actionTargets.push(hexId);
          this.board.highlightSelected(hexId);
          this.state.phase = 'CONFIRM';
          this.topBar.render(this.state);
          this.dialog.showConfirm(
            `Execute <strong>Start of Turn</strong> — Duplicate token?`,
            () => {
              this.dialog.hide();
              this.executor.executeAeternaSOT(this.actionTargets[0], this.actionTargets[1]);
              if (this.checkWin()) return;
              this.board.render(this.state);
              this.finishSOT();
            },
            () => this.onUndo(),
          );
          return;
        }
      }

      // Standard 1-step SOT
      this.actionTargets = [hexId];
      this.board.highlightSelected(hexId);
      this.state.phase = 'CONFIRM';
      this.topBar.render(this.state);
      this.dialog.showConfirm(
        `Execute <strong>Start of Turn</strong> ability?`,
        () => {
          this.dialog.hide();
          // Queue SOT movement animation
          if (type === 'earth') {
            const minionHex = this.state.getStoneMinionHex();
            if (minionHex !== null) this.queueMoveAnimation('minion', minionHex, hexId);
          } else if (type === 'water') {
            const water = this.state.getPlayer('water');
            this.queueMoveAnimation('water', water.hexId, hexId);
          }
          this.executor.executeSOT(hexId);
          if (this.checkWin()) return;
          this.board.render(this.state);
          this.playPendingAnimation().then(() => {
            if (this.state.pendingForcedMove) {
              this.startForcedMovePhase(() => this.finishSOT());
              return;
            }
            this.finishSOT();
          });
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
      case 'tides-embrace':
        this.handleTidesEmbraceStep(hexId);
        return;
      case 'ash-to-lush':
        this.handleAshToLushStep(hexId);
        return;
      case 'bark-and-bough':
        this.handleBarkAndBoughStep(hexId);
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
        this.startFogMovePhase(1, () => {
          this.state.phase = 'CHOOSE_ACTION';
          this.renderAll();
        });
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
        this.validTargets = targets;
        this.state.stepInstruction = instruction;
        this.board.render(this.state);
        this.board.highlightValidTargets(targets, this.state.currentPlayer);
        this.topBar.render(this.state);
        this.dialog.showInfo('Raise Mountain', instruction, () => this.onUndo());
      } else {
        // Step 0 was move — apply movement with animation
        const earth = this.state.getPlayer('earth');
        if (hexId !== earth.hexId) {
          this.queueMoveAnimation('earth', earth.hexId, hexId);
          this.executor.handleEarthConversion(hexId);
          this.state.setElementalOnHex(hexId, 'earth');
        }
        // Step 1: place mountain
        const instruction = 'Place a Mountain on any empty hex';
        const targets = this.executor.getRaiseMountainPlaceTargets();
        this.validTargets = targets;
        this.state.stepInstruction = instruction;
        this.board.render(this.state);
        this.playPendingAnimation().then(() => {
          this.board.highlightValidTargets(targets, this.state.currentPlayer);
          this.topBar.render(this.state);
          this.dialog.showInfo('Raise Mountain', instruction, () => this.onUndo());
        });
      }
    } else {
      this.actionTargets.push(hexId);

      if (this.raiseMountainPlaceFirst) {
        // Step 1 was move — apply movement with animation
        const earth = this.state.getPlayer('earth');
        if (hexId !== earth.hexId) {
          this.queueMoveAnimation('earth', earth.hexId, hexId);
          this.executor.handleEarthConversion(hexId);
          this.state.setElementalOnHex(hexId, 'earth');
        }
      } else {
        // Step 1 was place — apply mountain
        this.state.addToken(hexId, 'mountain');
      }

      this.state.phase = 'CONFIRM';
      this.board.render(this.state);
      this.playPendingAnimation().then(() => {
        this.board.highlightSelected(hexId);
        this.topBar.render(this.state);
        this.showConfirmDialog();
      });
    }
  }

  private handleLandslideStep(hexId: HexId) {
    if (this.currentStep === 0) {
      this.actionTargets.push(hexId);
      this.currentStep = 1;

      const earth = this.state.getPlayer('earth');
      if (hexId !== earth.hexId) {
        this.queueMoveAnimation('earth', earth.hexId, hexId, 'landslide');
        this.executor.handleEarthConversion(hexId);
        this.state.setElementalOnHex(hexId, 'earth');
      }

      this.board.render(this.state);
      this.playPendingAnimation().then(() => {
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
      });
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
      this.state.stepInstruction = instruction;
      this.board.render(this.state);
      this.board.highlightValidTargets(this.validTargets, this.state.currentPlayer);
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.dialog.showInfo('Conjure Lakes', instruction, () => this.onUndo());
    }
  }

  private handleFirestormStep(hexId: HexId) {
    if (this.currentStep === 1) {
      // Movement step
      this.actionTargets.push(hexId);
      this.state.phase = 'CONFIRM';
      this.topBar.render(this.state);
      this.showConfirmDialog();
      return;
    }

    // Placement step: identify which original group this hex is adjacent to
    const group = this.firestormGroups.find(g => {
      for (const fh of g.hexes) {
        if (getNeighbors(fh).includes(hexId)) return true;
      }
      return false;
    });
    if (group) this.firestormExtendedGroupIds.add(group.id);

    this.executor.placeFirestormToken(hexId);
    this.actionTargets.push(hexId);

    const placed = this.actionTargets.length;
    const remaining = this.firestormMaxTokens - placed;

    // Get targets from original groups not yet extended
    const availableGroups = this.firestormGroups.filter(g => !this.firestormExtendedGroupIds.has(g.id));
    const nextTargets = remaining > 0
      ? this.executor.getFirestormPlacementTargetsForGroups(availableGroups)
      : [];

    if (placed >= this.firestormMaxTokens || nextTargets.length === 0) {
      this.firestormMoveToMovement();
      return;
    }

    // Show updated board, highlight next targets, non-blocking skip dialog
    this.validTargets = nextTargets;
    const instruction = `Place fire on a different group (${remaining} remaining)`;
    this.state.stepInstruction = instruction;
    this.board.render(this.state);
    this.board.highlightValidTargets(nextTargets, this.state.currentPlayer);
    this.topBar.render(this.state);
    this.dialog.showInfoWithSkip('Firestorm', instruction, () => {
      this.dialog.hide();
      this.firestormMoveToMovement();
    }, () => this.onUndo());
  }

  private firestormMoveToMovement() {
    this.currentStep = 1;
    const instruction = `Move ${NAMES.fire} through connected fire`;
    const moveTargets = this.executor.getFirestormMoveTargets();
    this.state.stepInstruction = instruction;
    this.validTargets = moveTargets;
    this.board.render(this.state);
    this.board.highlightValidTargets(moveTargets, this.state.currentPlayer);
    this.topBar.render(this.state);
    this.dialog.showInfo('Firestorm', instruction, () => this.onUndo());
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
    // Check if this is a swap-places card (2-step pick)
    if (this.activeSpecialCardId === 'swap-places') {
      this.actionTargets.push(hexId);
      this.board.highlightSelected(hexId);

      if (this.actionTargets.length === 1) {
        // First elemental picked — now pick second
        this.currentStep = 1;
        const remaining = this.validTargets.filter(t => t !== hexId);
        this.validTargets = remaining;
        this.state.stepInstruction = 'Choose the second elemental to swap with';
        this.board.render(this.state);
        this.board.highlightValidTargets(remaining, this.state.currentPlayer);
        this.board.highlightSelected(hexId);
        this.topBar.render(this.state);
        this.dialog.showInfo('Swap Places', 'Now choose the second elemental', () => this.onUndo());
      } else {
        // Both picked — confirm
        this.state.phase = 'CONFIRM';
        this.board.render(this.state);
        for (const t of this.actionTargets) this.board.highlightSelected(t);
        this.topBar.render(this.state);
        this.showConfirmDialog();
      }
      return;
    }

    // Other special cards: single-step move
    this.actionTargets.push(hexId);
    const currentPlayer = this.state.currentPlayer;
    const playerState = this.state.getPlayer(currentPlayer);
    this.queueMoveAnimation(currentPlayer, playerState.hexId, hexId);
    this.state.setElementalOnHex(hexId, currentPlayer);
    this.state.phase = 'CONFIRM';
    this.board.render(this.state);
    this.playPendingAnimation().then(() => {
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    });
  }

  // ==========================================
  // AETERNA ACTION HANDLERS
  // ==========================================

  private handleAeternasFavor() {
    const targets = this.executor.getAeternasFavorTargets();
    if (targets.length === 0) {
      this.dialog.showInfo("Aeterna's Favor", 'No elementals have blocked actions.');
      this.selectedAction = null;
      this.state.phase = 'CHOOSE_ACTION';
      this.renderAll();
      return;
    }

    const choices = targets.map(t => ({
      text: `${NAMES[t.type]} — free ${this.getActionDisplayName(t.blockedAction)}`,
      primary: true,
      callback: () => {
        const result = this.executor.executeAeternasFavor(t.type);
        this.state.addLog(result);
        this.turnMgr.setActionMarker('aeternas-favor');
        if (this.checkWin()) return;
        this.finishTurn();
      },
    }));

    this.dialog.showChoice("Aeterna's Favor", 'Choose an elemental to free from cooldown:', choices);
  }

  private handleTidesEmbraceStep(hexId: HexId) {
    const hex = this.state.getHex(hexId);
    const aeterna = this.state.getPlayer('aeterna');
    const supply = aeterna.supplies.ocean ?? 0;

    if (hex.tokens.includes('ocean')) {
      // Moving existing ocean — step 1: pick source
      this.actionTargets = [hexId];
      this.currentStep = 1;
      const dests = this.executor.getTidesEmbraceMoveDests(hexId);
      this.validTargets = dests;
      this.state.stepInstruction = 'Choose destination shore hex for ocean tile';
      this.board.render(this.state);
      this.board.highlightValidTargets(dests, 'aeterna');
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.dialog.showInfo("Tide's Embrace", 'Choose destination', () => this.onUndo());
    } else if (this.currentStep === 1) {
      // Step 2: destination for move
      this.actionTargets.push(hexId);
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    } else {
      // Placing from supply
      this.actionTargets = [hexId];
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    }
  }

  private handleAshToLushStep(hexId: HexId) {
    const fire = this.state.getPlayer('fire');
    const supply = fire.supplies.fire ?? 0;
    const hex = this.state.getHex(hexId);

    if (supply <= 0 && hex.tokens.includes('fire')) {
      // Moving existing fire — step 1: pick source
      this.actionTargets = [hexId];
      this.currentStep = 1;
      const dests = this.executor.getAshToLushMoveDests(hexId);
      this.validTargets = dests;
      this.state.stepInstruction = 'Choose destination for fire token';
      this.board.render(this.state);
      this.board.highlightValidTargets(dests, 'aeterna');
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.dialog.showInfo('Ash to Lush', 'Choose destination', () => this.onUndo());
    } else if (this.currentStep === 1) {
      // Step 2: destination for move
      this.actionTargets.push(hexId);
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    } else {
      // Placing from supply
      this.actionTargets = [hexId];
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    }
  }

  private handleBarkAndBoughStep(hexId: HexId) {
    const earth = this.state.getPlayer('earth');
    const supply = earth.supplies.forest ?? 0;
    const hex = this.state.getHex(hexId);

    if (supply <= 0 && hex.tokens.includes('forest')) {
      // Moving existing forest — step 1: pick source
      this.actionTargets = [hexId];
      this.currentStep = 1;
      const dests = this.executor.getBarkAndBoughMoveDests(hexId);
      this.validTargets = dests;
      this.state.stepInstruction = 'Choose destination for forest token';
      this.board.render(this.state);
      this.board.highlightValidTargets(dests, 'aeterna');
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.dialog.showInfo('Bark and Bough', 'Choose destination', () => this.onUndo());
    } else if (this.currentStep === 1) {
      // Step 2: destination for move
      this.actionTargets.push(hexId);
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    } else {
      // Placing from supply
      this.actionTargets = [hexId];
      this.state.phase = 'CONFIRM';
      this.board.highlightSelected(hexId);
      this.topBar.render(this.state);
      this.showConfirmDialog();
    }
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

    // Non-blocking fog info with Skip option
    const fogLabel = this.fogMoveTotal === 1
      ? 'Move your Fog'
      : `Move Fog ${this.fogMoveIndex} of ${this.fogMoveTotal}`;
    this.dialog.showInfoWithSkip('Fog Movement', fogLabel, () => {
      // Skip all remaining fog moves
      this.pendingFogMoves = [];
      this.dialog.hide();
      const cb = this.postFogCallback;
      this.postFogCallback = null;
      this.fogMoveRange = 0;
      this.fogMoveIndex = 0;
      this.fogMoveTotal = 0;
      if (cb) cb();
    });
  }

  private handleFogMoveClick(hexId: HexId) {
    const fogHex = this.pendingFogMoves.shift()!;

    if (fogHex !== hexId) {
      // Animate fog token before updating state
      this.board.animateTokenMove('fog', fogHex, hexId).then(() => {
        this.executor.moveFog(fogHex, hexId);
        if (this.checkWin()) return;
        this.renderAll();
        this.promptNextFogMove();
      });
    } else {
      this.executor.moveFog(fogHex, hexId);
      if (this.checkWin()) return;
      this.promptNextFogMove();
    }
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
    this.state.stepInstruction = 'Choose a hex for Kaijom';
    this.state.phase = 'EXECUTING';
    this.board.render(this.state);
    this.board.highlightValidTargets(fm.validTargets, 'earth');
    this.topBar.render(this.state);
    this.dialog.showInfo('Forced Move!', 'Fire was placed on Kaijom\'s hex. Earth must move!');
  }

  private handleForcedMoveClick(hexId: HexId) {
    const earth = this.state.getPlayer('earth');
    this.queueMoveAnimation('earth', earth.hexId, hexId);
    this.executor.executeForcedMove(hexId);
    if (this.checkWin()) return;
    this.board.render(this.state);
    this.playPendingAnimation().then(() => {
      const cb = this.postForcedMoveCallback;
      this.postForcedMoveCallback = null;
      if (cb) cb();
    });
  }

  // ==========================================
  // CONFIRM / UNDO
  // ==========================================

  private onConfirm() {
    this.dialog.hide();

    if (this.state.phase === 'CONFIRM' && this.selectedAction) {
      // Flame Dash special handling
      if (this.selectedAction === 'flame-dash') {
        const fire = this.state.getPlayer('fire');
        const targetHex = this.actionTargets[0];
        this.queueMoveAnimation('fire', fire.hexId, targetHex, 'flame-dash');
        const placeOnDest = !this.flameDashPlacedFirst;
        const result = this.executor.executeFlameDashMove(targetHex, placeOnDest);
        this.state.addLog(result);
        this.turnMgr.setActionMarker(this.selectedAction);
        if (this.checkWin()) return;
        this.board.render(this.state);
        this.playPendingAnimation().then(() => {
          if (this.state.pendingForcedMove) {
            this.startForcedMovePhase(() => this.finishTurn());
            return;
          }
          this.finishTurn();
        });
        return;
      }

      // Swap Places special: swap the two selected elementals
      if (this.selectedAction === 'special' && this.activeSpecialCardId === 'swap-places') {
        const hex1 = this.actionTargets[0];
        const hex2 = this.actionTargets[1];
        const hexState1 = this.state.getHex(hex1);
        const hexState2 = this.state.getHex(hex2);
        const el1 = hexState1.elemental!;
        const el2 = hexState2.elemental!;
        this.queueMoveAnimation(el1, hex1, hex2);
        this.state.setElementalOnHex(hex1, el2);
        this.state.setElementalOnHex(hex2, el1);
        this.state.addLog(`Swap Places — ${NAMES[el1]} and ${NAMES[el2]} swapped positions`);
        this.turnMgr.setActionMarker(this.selectedAction);
        this.activeSpecialCardId = null;
        this.board.render(this.state);
        this.playPendingAnimation().then(() => {
          this.finishTurn();
        });
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

      // Queue movement animation before executing
      this.queueMoveAnimationForAction(this.selectedAction, this.actionTargets);

      // Execute the action
      const result = this.executor.executeAction(this.selectedAction, this.actionTargets);
      this.state.addLog(result);
      this.turnMgr.setActionMarker(this.selectedAction);

      if (this.checkWin()) return;
      this.board.render(this.state);
      this.playPendingAnimation().then(() => {
        if (this.state.pendingForcedMove) {
          this.startForcedMovePhase(() => {
            this.finishActionWithFogCheck();
          });
          return;
        }
        this.finishActionWithFogCheck();
      });
    } else if (this.state.phase === 'EXECUTING' && this.selectedAction === 'landslide' && this.currentStep === 1) {
      this.state.phase = 'CONFIRM';
      this.onConfirm();
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
        this.startFogMovePhase(1, () => {
          this.turnMgr.endTurn();
          this.executor = new ActionExecutor(this.state);
          this.syncState();
          this.showTurnBanner(() => this.renderAll());
        });
        return;
      }

      this.turnMgr.endTurn();
      this.executor = new ActionExecutor(this.state);
      this.syncState();
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
    this.firestormGroups = [];
    this.firestormExtendedGroupIds.clear();
    this.firestormMaxTokens = 0;
    this.activeSpecialCardId = null;
    this.waterHexBeforeMosey = null;
    this.turnMgr.endTurn();
    this.executor = new ActionExecutor(this.state);
    this.syncState();
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
    this.firestormGroups = [];
    this.firestormExtendedGroupIds.clear();
    this.firestormMaxTokens = 0;
    this.activeSpecialCardId = null;
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
        return step === 0 ? `Place fire on a fire group (${this.firestormMaxTokens} token${this.firestormMaxTokens !== 1 ? 's' : ''})` : `Move ${name} through connected fire`;
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
      case 'tides-embrace':
        return 'Place or move an ocean tile on a shore hex';
      case 'ash-to-lush':
        return 'Place or move a fire token';
      case 'bark-and-bough':
        return 'Place or move a forest token';
      case 'aeternas-favor':
        return 'Choose an elemental to free from cooldown';
      default:
        return 'Click a highlighted hex on the map';
    }
  }

  /** Check win conditions. Returns true if game is over. */
  private checkWin(): boolean {
    const winner = checkWinConditions(this.state);
    if (winner) {
      this.state.winner = winner;
      this.syncState();
      this.board.render(this.state);
      this.dialog.showVictory(this.state, {
        onRematch: () => this.returnToMenu(),
        onReturnToMenu: () => this.returnToMenu(),
        onReturnToLobby: this.network ? () => this.returnToMenu() : undefined,
      });
      return true;
    }
    return false;
  }

  private returnToMenu() {
    this.network?.close();
    window.location.reload();
  }
}
