// ========================================
// Action Executor - Core Game Logic
// ========================================
// Returns valid targets for each action step,
// and executes the action when targets are confirmed.

import type { GameState } from './GameState';
import type { ActionId, ElementalType, HexId, TokenType } from './types';
import { getNeighbors, isShore, getReachableHexes, getLinePath, getLineHexes, hexDistance, isStraightLine } from './HexGrid';
import { checkWinConditions, isTrapped } from './WinChecker';

export interface ActionStep {
  type: 'move' | 'place' | 'select-hex' | 'select-direction' | 'select-token' | 'optional';
  label: string;
  validTargets: HexId[];
  completed: boolean;
  selectedHex?: HexId;
}

export class ActionExecutor {
  constructor(private state: GameState) {}

  // ==========================================
  // START OF TURN ABILITIES
  // ==========================================

  getSOTValidTargets(): HexId[] {
    const type = this.state.currentPlayer;
    switch (type) {
      case 'earth': return this.getStoneMinonMoveTargets();
      case 'water': return this.getWaterSOTTargets();
      case 'fire': return this.getFireSOTTargets();
    }
  }

  private getStoneMinonMoveTargets(): HexId[] {
    const minionHex = this.state.getStoneMinionHex();
    if (minionHex === null) return [];
    const neighbors = getNeighbors(minionHex);
    const earthHex = this.state.getPlayer('earth').hexId;
    return neighbors.filter(n => n !== earthHex); // Can't move onto Earth
  }

  private getWaterSOTTargets(): HexId[] {
    // Move 1 hex OR teleport to any Lake/Fog hex
    const water = this.state.getPlayer('water');
    const targets = new Set<HexId>();

    // Move 1
    for (const n of getNeighbors(water.hexId)) {
      if (this.canWaterEnter(n)) targets.add(n);
    }

    // Teleport to any Lake or Fog hex
    for (const [id, hex] of this.state.board) {
      if (id === water.hexId) continue;
      if (hex.tokens.includes('lake') || hex.tokens.includes('fog')) {
        if (!hex.tokens.includes('mountain') && !hex.stoneMinion) {
          targets.add(id);
        }
      }
    }

    return [...targets];
  }

  private getFireSOTTargets(): HexId[] {
    const fire = this.state.getPlayer('fire');
    const targets: HexId[] = [];

    // Place Fire on current hex (if no fire there already)
    if (!this.state.hasToken(fire.hexId, 'fire')) {
      targets.push(fire.hexId);
    }

    // Place Fire on empty hex adjacent to existing fire
    for (const [id, hex] of this.state.board) {
      if (hex.tokens.includes('fire')) {
        for (const n of getNeighbors(id)) {
          const nHex = this.state.getHex(n);
          const nonFogTokens = nHex.tokens.filter(t => t !== 'fog');
          if (nonFogTokens.length === 0 && !nHex.stoneMinion) {
            targets.push(n);
          }
        }
      }
    }

    return [...new Set(targets)];
  }

  executeSOT(targetHex: HexId) {
    const type = this.state.currentPlayer;
    switch (type) {
      case 'earth': this.executeEarthSOT(targetHex); break;
      case 'water': this.executeWaterSOT(targetHex); break;
      case 'fire': this.executeFireSOT(targetHex); break;
    }
    this.state.sotUsed = true;

    // Check wins
    const winner = checkWinConditions(this.state);
    if (winner) this.state.winner = winner;
  }

  private executeEarthSOT(targetHex: HexId) {
    const hex = this.state.getHex(targetHex);

    // Stone Minion destroys ALL tokens on destination
    for (const token of [...hex.tokens]) {
      this.state.destroyToken(targetHex, token);
    }

    // Check if Water is on target hex -> capture
    if (hex.elemental === 'water') {
      // Earth wins via Stone Minion capture
    }

    this.state.setStoneMinion(targetHex);
    this.state.addLog(`Moved Stone Minion to hex ${targetHex}.`);
  }

  private executeWaterSOT(targetHex: HexId) {
    const water = this.state.getPlayer('water');
    const oldHex = water.hexId;
    const distance = hexDistance(oldHex, targetHex);
    const isMove = distance === 1 && getNeighbors(oldHex).includes(targetHex);

    // Handle conversion: if Water moves onto Fire token -> convert to Lake
    this.handleWaterConversion(targetHex);

    this.state.setElementalOnHex(targetHex, 'water');

    // Fog movement handled interactively by UI (only for 1-hex moves, not teleports)
    // Store whether this was a move (not teleport) so UI can trigger fog movement
    if (isMove) {
      this.state.pendingFogMove = true;
    }

    this.state.addLog(`Water start-of-turn: moved to hex ${targetHex}.`);
  }

  private executeFireSOT(targetHex: HexId) {
    if (!this.state.takeFromSupply('fire', 'fire')) return;
    this.state.addToken(targetHex, 'fire');

    // If placed on Earth's hex, Earth must move
    const earth = this.state.getPlayer('earth');
    if (targetHex === earth.hexId) {
      this.handleFireOnEarth();
    }

    this.state.addLog(`Fire start-of-turn: placed Fire on hex ${targetHex}.`);
  }

  // ==========================================
  // MAIN ACTION EXECUTION
  // ==========================================

  /** Get valid move targets for the selected action */
  getValidTargets(actionId: ActionId): HexId[] {
    const type = this.state.currentPlayer;
    switch (actionId) {
      // Earth
      case 'uproot': return this.getUprootTargets();
      case 'raise-mountain': return this.getRaiseMountainMoveTargets();
      case 'landslide': return this.getLandslideMoveTargets();
      case 'sprout': return this.getSproutTargets();
      // Water
      case 'mosey': return this.getMoseyTargets();
      case 'conjure': return this.getConjureTargets();
      case 'surf': return this.getSurfTargets();
      case 'rematerialize': return this.getRematerializeTargets();
      // Fire
      case 'smoke-dash': return this.getSmokeDashTargets();
      case 'flame-dash': return this.getFlameDashTargets();
      case 'firestorm': return this.getFirestormPlacementTargets();
      case 'firewall': return this.getFirewallDirectionHexes();
      // Special
      case 'special': return [];
      default: return [];
    }
  }

  /** Execute an action with selected targets */
  executeAction(actionId: ActionId, targets: HexId[]): string {
    switch (actionId) {
      case 'uproot': return this.executeUproot(targets[0]);
      case 'raise-mountain': return this.executeRaiseMountain(targets[0], targets[1]);
      case 'landslide': return this.executeLandslide(targets[0], targets[1]);
      case 'sprout': return this.executeSprout(targets[0]);
      case 'mosey': return this.executeMosey(targets[0]);
      case 'conjure': return this.executeConjure(targets);
      case 'surf': return this.executeSurf(targets[0]);
      case 'rematerialize': return this.executeRematerialize(targets[0]);
      case 'smoke-dash': return this.executeSmokeDash(targets[0]);
      case 'flame-dash': return this.executeFlameDash(targets[0]);
      case 'firestorm': return this.executeFirestorm(targets);
      case 'firewall': return this.executeFirewall(targets[0]);
      default: return '';
    }
  }

  // ==========================================
  // EARTH ACTIONS
  // ==========================================

  private getUprootTargets(): HexId[] {
    const earth = this.state.getPlayer('earth');
    const hasForest = this.state.countTokensOnBoard('forest') > 0;
    const range = hasForest ? 4 : 3;
    return [...getReachableHexes(
      earth.hexId, range,
      (h) => this.canEarthEnter(h),
      (h) => this.canEarthPassThrough(h),
    )].filter(h => this.canEarthEnd(h));
  }

  private executeUproot(targetHex: HexId): string {
    const earth = this.state.getPlayer('earth');
    const oldHex = earth.hexId;

    // Lake conversion: if ending on Lake, convert to Forest
    this.handleEarthConversion(targetHex);

    this.state.setElementalOnHex(targetHex, 'earth');

    // Check capture
    if (this.state.getHex(targetHex).elemental === 'water') {
      // Actually both are on same hex after move
    }

    return `Uproot — moved from hex ${oldHex} to hex ${targetHex}`;
  }

  private getRaiseMountainMoveTargets(): HexId[] {
    const earth = this.state.getPlayer('earth');
    // Move up to 1 hex
    const targets: HexId[] = [earth.hexId]; // Can stay
    for (const n of getNeighbors(earth.hexId)) {
      if (this.canEarthEnd(n)) targets.push(n);
    }
    return targets;
  }

  /** After moving, get valid hexes to place a Mountain */
  getRaiseMountainPlaceTargets(): HexId[] {
    const targets: HexId[] = [];
    const mountainsOnBoard = this.state.countTokensOnBoard('mountain');

    if (mountainsOnBoard < 4) {
      // Place on any empty hex
      for (const [id, hex] of this.state.board) {
        if (this.state.isHexEmpty(id) && !hex.elemental && !hex.stoneMinion) {
          targets.push(id);
        }
      }
    } else {
      // Move an existing mountain: return all mountain hexes as source selection
      for (const [id, hex] of this.state.board) {
        if (hex.tokens.includes('mountain')) targets.push(id);
      }
    }
    return targets;
  }

  private executeRaiseMountain(moveTarget: HexId, placeTarget: HexId): string {
    const earth = this.state.getPlayer('earth');
    const oldHex = earth.hexId;

    // Move
    if (moveTarget !== oldHex) {
      this.handleEarthConversion(moveTarget);
      this.state.setElementalOnHex(moveTarget, 'earth');
    }

    // Place mountain
    const mountainsOnBoard = this.state.countTokensOnBoard('mountain');
    if (mountainsOnBoard >= 4) {
      // Move existing mountain - placeTarget is the source to pick up
      // For simplicity in MVP, we pick up from placeTarget and need a second target for placement
      // This will be handled by the UI as a two-step
    } else {
      if (this.state.takeFromSupply('earth', 'mountain')) {
        this.state.addToken(placeTarget, 'mountain');
      }
    }

    return `Raise Mountain — placed Mountain on hex ${placeTarget}`;
  }

  private getLandslideMoveTargets(): HexId[] {
    const earth = this.state.getPlayer('earth');
    const range = this.state.countTokensOnBoard('mountain');
    if (range === 0) return [earth.hexId];
    return [earth.hexId, ...[...getReachableHexes(
      earth.hexId, range,
      (h) => this.canEarthEnter(h),
      (h) => this.canEarthPassThrough(h),
    )].filter(h => this.canEarthEnd(h))];
  }

  /** After Landslide move, get mountains that can be destroyed */
  getLandslideDestroyTargets(): HexId[] {
    const targets: HexId[] = [];
    for (const [id, hex] of this.state.board) {
      if (hex.tokens.includes('mountain')) targets.push(id);
    }
    return targets;
  }

  private executeLandslide(moveTarget: HexId, destroyTarget?: HexId): string {
    const earth = this.state.getPlayer('earth');
    const oldHex = earth.hexId;

    if (moveTarget !== oldHex) {
      this.handleEarthConversion(moveTarget);
      this.state.setElementalOnHex(moveTarget, 'earth');
    }

    let destroyMsg = '';
    if (destroyTarget !== undefined) {
      destroyMsg = this.chainDestroyMountain(destroyTarget);
    }

    return `Landslide — moved to hex ${moveTarget}${destroyMsg}`;
  }

  /** Chain destroy a mountain and all adjacent tokens */
  private chainDestroyMountain(hexId: HexId): string {
    const destroyed: string[] = [];
    const toProcess: HexId[] = [hexId];
    const processed = new Set<HexId>();

    while (toProcess.length > 0) {
      const current = toProcess.pop()!;
      if (processed.has(current)) continue;
      processed.add(current);

      const hex = this.state.getHex(current);
      if (hex.tokens.includes('mountain')) {
        this.state.destroyToken(current, 'mountain');
        destroyed.push(`Mountain@${current}`);

        // Chain: destroy all adjacent tokens
        for (const n of getNeighbors(current)) {
          const nHex = this.state.getHex(n);
          for (const token of [...nHex.tokens]) {
            if (token === 'fog') continue; // Fog cannot be destroyed
            if (token === 'mountain') {
              toProcess.push(n); // Chain to adjacent mountains
            } else {
              this.state.destroyToken(n, token);
              destroyed.push(`${token}@${n}`);
            }
          }
        }
      }
    }

    return destroyed.length > 0 ? `. Destroyed: ${destroyed.join(', ')}` : '';
  }

  private getSproutTargets(): HexId[] {
    // Find Lakes adjacent to Forests
    const targets: HexId[] = [];
    for (const [id, hex] of this.state.board) {
      if (!hex.tokens.includes('lake')) continue;
      const neighbors = getNeighbors(id);
      for (const n of neighbors) {
        if (this.state.hasToken(n, 'forest')) {
          targets.push(id);
          break;
        }
      }
    }
    return targets;
  }

  private executeSprout(lakeHex: HexId): string {
    // Replace lake with forest
    this.state.destroyToken(lakeHex, 'lake');
    if (this.state.takeFromSupply('earth', 'forest')) {
      this.state.addToken(lakeHex, 'forest');
    }
    return `Sprout — replaced Lake on hex ${lakeHex} with Forest`;
  }

  // ==========================================
  // WATER ACTIONS
  // ==========================================

  private getMoseyTargets(): HexId[] {
    const water = this.state.getPlayer('water');
    const targets: HexId[] = [water.hexId]; // Can stay
    for (const n of getNeighbors(water.hexId)) {
      if (this.canWaterEnter(n)) targets.push(n);
    }
    return targets;
  }

  private executeMosey(targetHex: HexId): string {
    const water = this.state.getPlayer('water');
    const oldHex = water.hexId;
    if (targetHex === oldHex) return 'Mosey — stayed in place';

    this.handleWaterConversion(targetHex);
    this.state.setElementalOnHex(targetHex, 'water');
    // Fog movement handled interactively by UI

    return `Mosey — moved from hex ${oldHex} to hex ${targetHex}`;
  }

  private getConjureTargets(): HexId[] {
    const water = this.state.getPlayer('water');
    const supply = water.supplies.lake ?? 0;
    const targets: HexId[] = [];

    if (supply > 0) {
      // Place on empty hexes within 3 hexes
      for (const [id, hex] of this.state.board) {
        if (hexDistance(water.hexId, id) <= 3 && this.state.isHexEmpty(id)) {
          targets.push(id);
        }
      }
    } else {
      // Move existing lakes
      for (const [id, hex] of this.state.board) {
        if (hex.tokens.includes('lake')) targets.push(id);
      }
    }
    return targets;
  }

  private executeConjure(targets: HexId[]): string {
    const water = this.state.getPlayer('water');
    const placed: HexId[] = [];

    for (const hex of targets.slice(0, 2)) {
      if (this.state.takeFromSupply('water', 'lake')) {
        this.state.addToken(hex, 'lake');
        placed.push(hex);

        // Auto-place fog when last lake is placed
        if ((water.supplies.lake ?? 0) === 0 && (water.supplies.fog ?? 0) > 0) {
          if (this.state.takeFromSupply('water', 'fog')) {
            this.state.addToken(hex, 'fog');
          }
        }
      }
    }

    return `Conjure Lakes — placed Lakes on hex${placed.length > 1 ? 'es' : ''} ${placed.join(', ')}`;
  }

  private getSurfTargets(): HexId[] {
    const water = this.state.getPlayer('water');
    if (!isShore(water.hexId)) return []; // Must be on shore

    const targets: HexId[] = [];
    for (const [id] of this.state.board) {
      if (id === water.hexId) continue;
      if (isShore(id) && this.state.isHexEmpty(id)) {
        targets.push(id);
      }
    }
    return targets;
  }

  private executeSurf(targetHex: HexId): string {
    this.state.setElementalOnHex(targetHex, 'water');
    // No fog movement on teleport
    return `Ocean Surf — teleported to shore hex ${targetHex}`;
  }

  private getRematerializeTargets(): HexId[] {
    // Find all fog token locations
    const targets: HexId[] = [];
    for (const [id, hex] of this.state.board) {
      if (hex.tokens.includes('fog')) targets.push(id);
    }
    return targets;
  }

  private executeRematerialize(fogHex: HexId): string {
    const water = this.state.getPlayer('water');
    const oldHex = water.hexId;

    // Swap: Water goes to fog hex, fog goes to water's old hex
    // Lake stays where it was (on fog's hex)
    this.state.removeToken(fogHex, 'fog');
    this.state.addToken(oldHex, 'fog');
    this.state.setElementalOnHex(fogHex, 'water');

    return `Re-Materialize — swapped with Fog. Water to hex ${fogHex}, Fog to hex ${oldHex}`;
  }

  // ==========================================
  // FIRE ACTIONS
  // ==========================================

  private getSmokeDashTargets(): HexId[] {
    const fire = this.state.getPlayer('fire');
    const bonus = this.getFireMovementBonus();
    const range = 2 + bonus;
    const targets: HexId[] = [];

    // Straight line movement, ignoring terrain
    const lines = getLineHexes(fire.hexId, range);
    for (const { hexes } of lines) {
      for (let i = 0; i < hexes.length; i++) {
        const h = hexes[i];
        // Can end here if valid destination
        if (this.canFireEnd(h)) targets.push(h);
        // Smoke Dash ignores terrain for passing through
      }
    }

    return [...new Set(targets)];
  }

  private executeSmokeDash(targetHex: HexId): string {
    const fire = this.state.getPlayer('fire');
    const oldHex = fire.hexId;

    this.handleFireConversion(targetHex);
    this.state.setElementalOnHex(targetHex, 'fire');

    return `Smoke Dash — moved from hex ${oldHex} to hex ${targetHex}`;
  }

  getFlameDashTargets(): HexId[] {
    const fire = this.state.getPlayer('fire');
    const bonus = this.getFireMovementBonus();
    const range = 3 + bonus;
    const targets: HexId[] = [];

    const lines = getLineHexes(fire.hexId, range);
    for (const { hexes } of lines) {
      for (let i = 0; i < hexes.length; i++) {
        const h = hexes[i];
        if (this.canFireEnd(h)) targets.push(h);
        // Stop if blocked by mountain or lake (can't pass through)
        const hex = this.state.getHex(h);
        if (hex.tokens.includes('mountain') || hex.tokens.includes('lake')) break;
      }
    }

    return [...new Set(targets)];
  }

  /** Get Fire's own hex as a target for placing fire before moving */
  canFlameDashPlaceFirst(): boolean {
    const fire = this.state.getPlayer('fire');
    return !this.state.hasToken(fire.hexId, 'fire') && (fire.supplies.fire ?? 0) > 0;
  }

  /** Execute Flame Dash move (fire placement handled by UI) */
  executeFlameDashMove(targetHex: HexId, placeFireOnDest: boolean): string {
    const fire = this.state.getPlayer('fire');
    const oldHex = fire.hexId;

    this.handleFireConversion(targetHex);
    this.state.setElementalOnHex(targetHex, 'fire');

    if (placeFireOnDest && !this.state.hasToken(targetHex, 'fire')) {
      if (this.state.takeFromSupply('fire', 'fire')) {
        this.state.addToken(targetHex, 'fire');
      }
    }

    return `Flame Dash — moved to hex ${targetHex}${placeFireOnDest ? ', placed Fire' : ''}`;
  }

  private executeFlameDash(targetHex: HexId): string {
    return this.executeFlameDashMove(targetHex, true);
  }

  private getFirestormPlacementTargets(): HexId[] {
    return this.getFirestormPlacementTargetsForGroups(this.getFireGroups());
  }

  /** Get valid placement hexes adjacent to a specific set of fire group hexes */
  getFirestormPlacementTargetsForGroups(groups: { id: string; hexes: Set<HexId> }[]): HexId[] {
    const targets: HexId[] = [];
    for (const group of groups) {
      for (const fh of group.hexes) {
        for (const n of getNeighbors(fh)) {
          const nHex = this.state.getHex(n);
          if (nHex.tokens.includes('mountain') || nHex.tokens.includes('lake')) continue;
          if (nHex.tokens.includes('fire')) continue; // already has fire
          const nonFog = nHex.tokens.filter(t => t !== 'fog');
          if (nonFog.length === 0 || nHex.tokens.includes('forest')) {
            targets.push(n);
          }
        }
      }
    }
    return [...new Set(targets)];
  }

  /** Snapshot all fire groups on the board (connected components) */
  getFireGroups(): { id: string; hexes: Set<HexId> }[] {
    const fireHexes = new Set<HexId>();
    for (const [id, hex] of this.state.board) {
      if (hex.tokens.includes('fire')) fireHexes.add(id);
    }
    const visited = new Set<HexId>();
    const groups: { id: string; hexes: Set<HexId> }[] = [];
    for (const fh of fireHexes) {
      if (visited.has(fh)) continue;
      const group = this.getConnectedFire(fh);
      const id = [...group].sort().join(',');
      groups.push({ id, hexes: group });
      for (const h of group) visited.add(h);
    }
    return groups;
  }

  /** Place a single firestorm fire token on the board immediately */
  placeFirestormToken(hex: HexId): void {
    if (this.state.hasToken(hex, 'forest')) {
      this.state.destroyToken(hex, 'forest');
    }
    if (this.state.takeFromSupply('fire', 'fire')) {
      this.state.addToken(hex, 'fire');
    }
    // If on Earth's hex, force Earth to move (handled later in UI)
  }

  /** Get firestorm movement targets (after placing fire tokens) */
  getFirestormMoveTargets(): HexId[] {
    const fire = this.state.getPlayer('fire');
    const bonus = this.getFireMovementBonus();
    const targets: HexId[] = [fire.hexId]; // Can stay

    if (this.state.hasToken(fire.hexId, 'fire')) {
      // On fire: move through connected fire only
      const connected = this.getConnectedFire(fire.hexId);
      for (const fh of connected) {
        targets.push(fh);
      }
      // Bonus (supply <= 4): can move 1 hex beyond connected fire
      if (bonus > 0) {
        for (const fh of connected) {
          for (const n of getNeighbors(fh)) {
            if (!connected.has(n) && this.canFireEnd(n)) {
              targets.push(n);
            }
          }
        }
      }
    } else if (bonus > 0) {
      // Not on fire but has bonus: can move 1 hex
      for (const n of getNeighbors(fire.hexId)) {
        if (this.canFireEnd(n)) targets.push(n);
      }
    }

    return [...new Set(targets)];
  }

  private getConnectedFire(start: HexId): Set<HexId> {
    const connected = new Set<HexId>();
    const queue: HexId[] = [start];
    connected.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const n of getNeighbors(current)) {
        if (!connected.has(n) && this.state.hasToken(n, 'fire')) {
          connected.add(n);
          queue.push(n);
        }
      }
    }

    return connected;
  }

  private executeFirestorm(targets: HexId[]): string {
    // Fire tokens are already placed live during UI flow.
    // targets: [placed1, placed2, ..., moveTarget]
    // The last target is always the move target (may equal current position = no move)
    const moveTarget = targets[targets.length - 1];
    const placed = targets.slice(0, -1);

    // Check if any placed fire is on Earth's hex
    const earth = this.state.getPlayer('earth');
    for (const hex of placed) {
      if (hex === earth.hexId) {
        this.handleFireOnEarth();
      }
    }

    // Move
    if (moveTarget !== undefined && moveTarget !== this.state.getPlayer('fire').hexId) {
      this.handleFireConversion(moveTarget);
      this.state.setElementalOnHex(moveTarget, 'fire');
    }

    return `Firestorm — placed Fire on ${placed.join(', ')}${moveTarget && moveTarget !== this.state.getPlayer('fire').hexId ? `, moved to ${moveTarget}` : ''}`;
  }

  private getFirewallDirectionHexes(): HexId[] {
    // Return all hexes in all 6 directions (up to 3 each)
    const fire = this.state.getPlayer('fire');
    const lines = getLineHexes(fire.hexId, 3);
    const targets: HexId[] = [];
    for (const { hexes } of lines) {
      for (const h of hexes) targets.push(h);
    }
    return targets;
  }

  /** Get the actual hexes that would get fire in a firewall direction */
  getFirewallPreview(directionHex: HexId): HexId[] {
    const fire = this.state.getPlayer('fire');
    const path = getLinePath(fire.hexId, directionHex);
    if (!path) return [];

    // Extend to 3 hexes in that direction
    const lines = getLineHexes(fire.hexId, 3);
    for (const { hexes } of lines) {
      if (hexes.includes(directionHex)) {
        // Place fire on empty hexes, skip non-empty
        return hexes.filter(h => {
          const hex = this.state.getHex(h);
          const nonFog = hex.tokens.filter(t => t !== 'fog');
          return nonFog.length === 0 && !hex.stoneMinion;
        });
      }
    }
    return [];
  }

  private executeFirewall(directionHex: HexId): string {
    const toPlace = this.getFirewallPreview(directionHex);
    const placed: HexId[] = [];

    for (const hex of toPlace) {
      if (this.state.takeFromSupply('fire', 'fire')) {
        this.state.addToken(hex, 'fire');
        placed.push(hex);
      }
    }

    return `Firewall — placed Fire on hex${placed.length > 1 ? 'es' : ''} ${placed.join(', ')}`;
  }

  // ==========================================
  // SPECIAL ABILITY EXECUTION
  // ==========================================

  executeSpecialAbility(): string {
    const card = this.state.specialDeck.useActiveCard();
    if (!card) return 'No special ability card available';

    // The UI will need to handle each card type's specific interaction
    // For now, return the card info so the UI can prompt accordingly
    return `Used Special Ability: ${card.name}`;
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private canEarthEnter(hexId: HexId): boolean {
    const hex = this.state.getHex(hexId);
    if (hex.tokens.includes('fire')) return false;
    // Mountains and stone minion can be entered (passed through) but not ended on
    return true;
  }

  private canEarthPassThrough(hexId: HexId): boolean {
    const hex = this.state.getHex(hexId);
    if (hex.tokens.includes('fire')) return false;
    // Can pass through mountains and stone minion (but can't end on them)
    // Fog stops movement
    if (hex.tokens.includes('fog') && !hex.elemental) return false;
    return true;
  }

  /** Check if Earth can END on a hex (not mountains, not stone minion, not fire) */
  private canEarthEnd(hexId: HexId): boolean {
    const hex = this.state.getHex(hexId);
    if (hex.tokens.includes('fire')) return false;
    if (hex.tokens.includes('mountain')) return false;
    if (hex.stoneMinion) return false;
    return true;
  }

  private canWaterEnter(hexId: HexId): boolean {
    const hex = this.state.getHex(hexId);
    if (hex.tokens.includes('mountain')) return false;
    if (hex.stoneMinion) return false;
    return true;
  }

  private canFireEnd(hexId: HexId): boolean {
    const hex = this.state.getHex(hexId);
    if (hex.tokens.includes('mountain')) return false;
    if (hex.tokens.includes('lake')) return false;
    if (hex.stoneMinion) return false;
    return true;
  }

  private getFireMovementBonus(): number {
    const fire = this.state.getPlayer('fire');
    return (fire.supplies.fire ?? 0) <= 4 ? 1 : 0;
  }

  /** Earth landing on Lake -> convert to Forest */
  handleEarthConversion(hexId: HexId) {
    if (this.state.hasToken(hexId, 'lake')) {
      this.state.destroyToken(hexId, 'lake');
      if (this.state.takeFromSupply('earth', 'forest')) {
        this.state.addToken(hexId, 'forest');
      }
    }
  }

  /** Water landing on Fire -> convert to Lake */
  private handleWaterConversion(hexId: HexId) {
    if (this.state.hasToken(hexId, 'fire')) {
      this.state.destroyToken(hexId, 'fire');
      if (this.state.takeFromSupply('water', 'lake')) {
        this.state.addToken(hexId, 'lake');

        // Auto-deploy fog when last lake is placed
        const water = this.state.getPlayer('water');
        if ((water.supplies.lake ?? 0) === 0 && (water.supplies.fog ?? 0) > 0) {
          if (this.state.takeFromSupply('water', 'fog')) {
            this.state.addToken(hexId, 'fog');
          }
        }
      }
    }
  }

  /** Fire landing on Forest -> convert to Fire token */
  private handleFireConversion(hexId: HexId) {
    if (this.state.hasToken(hexId, 'forest')) {
      this.state.destroyToken(hexId, 'forest');
      if (this.state.takeFromSupply('fire', 'fire')) {
        this.state.addToken(hexId, 'fire');
      }
    }
  }

  /** When Fire places fire on Earth's hex, Earth must move 1 space */
  handleFireOnEarth() {
    const earth = this.state.getPlayer('earth');
    const neighbors = getNeighbors(earth.hexId);
    const validMoves = neighbors.filter(n => this.canEarthEnd(n));

    if (validMoves.length === 0) {
      // Earth is trapped! Fire wins!
      this.state.winner = 'fire';
      this.state.addLog('Earth is trapped! Fire wins!');
    } else {
      // Set pending forced move for UI to handle interactively
      this.state.pendingForcedMove = { player: 'earth', validTargets: validMoves };
    }
  }

  /** Execute the forced move after Earth player chooses */
  executeForcedMove(targetHex: HexId) {
    this.handleEarthConversion(targetHex);
    this.state.setElementalOnHex(targetHex, 'earth');
    this.state.addLog(`Earth forced to move to hex ${targetHex}.`);
    this.state.pendingForcedMove = null;
  }

  /** Get all hexes that have fog tokens */
  getFogTokenHexes(): HexId[] {
    const hexes: HexId[] = [];
    for (const [id, hex] of this.state.board) {
      if (hex.tokens.includes('fog')) hexes.push(id);
    }
    return hexes;
  }

  /** Get valid movement targets for a fog token */
  getFogMoveTargets(fogHex: HexId, range: number): HexId[] {
    const targets: HexId[] = [fogHex]; // Can stay in place (skip)
    const visited = new Set<HexId>([fogHex]);
    const queue: [HexId, number][] = [[fogHex, 0]];

    while (queue.length > 0) {
      const [current, dist] = queue.shift()!;
      if (dist >= range) continue;
      for (const n of getNeighbors(current)) {
        if (visited.has(n)) continue;
        visited.add(n);
        targets.push(n);
        queue.push([n, dist + 1]);
      }
    }
    return targets;
  }

  /** Move a fog token from one hex to another */
  moveFog(fromHex: HexId, toHex: HexId) {
    if (fromHex === toHex) return; // Skip
    this.state.removeToken(fromHex, 'fog');
    this.state.addToken(toHex, 'fog');
    this.state.addLog(`Fog moved from hex ${fromHex} to hex ${toHex}.`);
  }

  /** Check if current player can execute any action at all */
  canAct(): boolean {
    const player = this.state.getPlayer(this.state.currentPlayer);
    const actions = ['uproot', 'raise-mountain', 'landslide', 'sprout', 'special'] as ActionId[];
    // At least one non-blocked action must have valid targets
    for (const a of actions) {
      if (a === player.actionMarker) continue;
      const targets = this.getValidTargets(a);
      if (targets.length > 0 || a === 'special') return true;
    }
    return false;
  }
}
