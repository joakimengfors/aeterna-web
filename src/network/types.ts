// ========================================
// Network Types
// ========================================

import type { ElementalType, HexId, ActionId } from '../game/types';

export type ActionIntentType =
  | 'SOT'
  | 'SOT_SKIP'
  | 'ACTION_SELECT'
  | 'HEX_CLICK'
  | 'CONFIRM'
  | 'UNDO'
  | 'CHOICE'
  | 'SKIP';

export interface ActionIntent {
  type: ActionIntentType;
  player: ElementalType;
  hexId?: HexId;
  actionId?: ActionId;
  choiceIndex?: number;
}

export interface LobbyPlayer {
  id: string;
  elemental: ElementalType | null;
  ready: boolean;
}

export interface LobbyState {
  roomCode: string;
  hostId: string;
  players: LobbyPlayer[];
  started: boolean;
}

export type NetworkMessage =
  | { type: 'full-state'; data: any }
  | { type: 'action'; intent: ActionIntent }
  | { type: 'state-update'; data: any }
  | { type: 'lobby-update'; lobby: LobbyState }
  | { type: 'game-start'; state: any; playerAssignments: Record<string, ElementalType> }
  | { type: 'error'; message: string }
  | { type: 'player-disconnected'; playerId: string };

export type SignalingMessage =
  | { type: 'create-room' }
  | { type: 'join-room'; code: string }
  | { type: 'room-created'; code: string; hostId: string }
  | { type: 'player-joined'; playerId: string; playerCount: number }
  | { type: 'player-left'; playerId: string }
  | { type: 'signal'; to: string; from: string; data: any }
  | { type: 'pick-elemental'; elemental: ElementalType }
  | { type: 'elemental-picked'; playerId: string; elemental: ElementalType }
  | { type: 'start-game'; state?: any; playerAssignments?: Record<string, ElementalType> }
  | { type: 'relay'; from: string; data: any }
  | { type: 'error'; message: string }
  | { type: 'room-joined'; hostId: string; playerId: string; players: { id: string; elemental: ElementalType | null }[] };
