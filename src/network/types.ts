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

export type TurnAnimationData =
  | { kind: 'standee'; entityType: ElementalType | 'minion'; path: HexId[] }
  | { kind: 'token'; tokenType: string; from: HexId; to: HexId };

export type NetworkMessage =
  | { type: 'full-state'; data: any }
  | { type: 'action'; intent: ActionIntent }
  | { type: 'state-update'; data: any; animations?: TurnAnimationData[]; actionLabel?: string }
  | { type: 'lobby-update'; lobby: LobbyState }
  | { type: 'game-start'; state: any; playerAssignments: Record<string, ElementalType> }
  | { type: 'rematch-request'; playerId: string }
  | { type: 'rematch-start'; state: any; playerAssignments: Record<string, ElementalType> }
  | { type: 'return-to-lobby' }
  | { type: 'error'; message: string }
  | { type: 'player-disconnected'; playerId: string }
  | { type: 'forced-move-choice'; hexId: HexId };

export type SignalingMessage =
  | { type: 'create-room' }
  | { type: 'join-room'; code: string }
  | { type: 'room-created'; code: string; hostId: string }
  | { type: 'player-joined'; playerId: string; playerCount: number }
  | { type: 'player-left'; playerId: string }
  | { type: 'signal'; to: string; from: string; data: any }
  | { type: 'pick-elemental'; elemental: ElementalType | null }
  | { type: 'elemental-picked'; playerId: string; elemental: ElementalType | null }
  | { type: 'start-game'; state?: any; playerAssignments?: Record<string, ElementalType> }
  | { type: 'return-to-lobby'; players: { id: string; elemental: string | null }[] }
  | { type: 'relay'; from: string; data: any }
  | { type: 'error'; message: string }
  | { type: 'room-joined'; hostId: string; playerId: string; players: { id: string; elemental: ElementalType | null }[] };
