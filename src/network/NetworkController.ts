// ========================================
// Network Controller
// ========================================

import { SignalingClient } from './SignalingClient';
import { PeerConnection } from './PeerConnection';
import { GameState } from '../game/GameState';
import type { ElementalType } from '../game/types';
import type { ActionIntent, LobbyState, NetworkMessage, SignalingMessage, TurnAnimationData } from './types';
import type { HexId } from '../game/types';

export type NetworkRole = 'host' | 'guest';

export class NetworkController {
  private signaling: SignalingClient;
  private peers: Map<string, PeerConnection> = new Map();
  private role: NetworkRole;
  private localId = '';
  private roomCode = '';
  private lobbyState: LobbyState | null = null;
  private gameStarted = false;

  // Callbacks
  private onLobbyUpdateCallback: ((lobby: LobbyState) => void) | null = null;
  private onGameStartCallback: ((state: any, localElemental: ElementalType) => void) | null = null;
  private onRemoteStateCallback: ((state: any, animations?: TurnAnimationData[], fromId?: string, actionLabel?: string) => void) | null = null;
  private onActionIntentCallback: ((intent: ActionIntent, fromId: string) => void) | null = null;
  private onErrorCallback: ((msg: string) => void) | null = null;
  private onPeerConnectedCallback: ((peerId: string) => void) | null = null;
  private onPeerDisconnectedCallback: ((peerId: string) => void) | null = null;
  private onReturnToLobbyCallback: (() => void) | null = null;
  private onRematchRequestCallback: ((playerId: string) => void) | null = null;
  private onRematchStartCallback: ((state: any, playerAssignments: Record<string, ElementalType>) => void) | null = null;
  private onForcedMoveChoiceCallback: ((hexId: HexId, fromId: string) => void) | null = null;

  constructor(serverUrl: string, role: NetworkRole) {
    this.signaling = new SignalingClient(serverUrl);
    this.role = role;
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  get lobby(): LobbyState | null {
    return this.lobbyState;
  }

  get code(): string {
    return this.roomCode;
  }

  get playerId(): string {
    return this.localId;
  }

  // --- Event handlers ---

  onLobbyUpdate(cb: (lobby: LobbyState) => void) { this.onLobbyUpdateCallback = cb; }
  onGameStart(cb: (state: any, localElemental: ElementalType) => void) { this.onGameStartCallback = cb; }
  onRemoteState(cb: (state: any, animations?: TurnAnimationData[], fromId?: string, actionLabel?: string) => void) { this.onRemoteStateCallback = cb; }
  onActionIntent(cb: (intent: ActionIntent, fromId: string) => void) { this.onActionIntentCallback = cb; }
  onError(cb: (msg: string) => void) { this.onErrorCallback = cb; }
  onPeerConnected(cb: (peerId: string) => void) { this.onPeerConnectedCallback = cb; }
  onPeerDisconnected(cb: (peerId: string) => void) { this.onPeerDisconnectedCallback = cb; }
  onReturnToLobby(cb: () => void) { this.onReturnToLobbyCallback = cb; }
  onRematchRequest(cb: (playerId: string) => void) { this.onRematchRequestCallback = cb; }
  onRematchStart(cb: (state: any, playerAssignments: Record<string, ElementalType>) => void) { this.onRematchStartCallback = cb; }
  onForcedMoveChoice(cb: (hexId: HexId, fromId: string) => void) { this.onForcedMoveChoiceCallback = cb; }

  // --- Connection ---

  async createRoom(): Promise<void> {
    this.signaling.onMessage((msg) => this.handleSignalingMessage(msg));
    await this.signaling.createRoom();
  }

  async joinRoom(code: string): Promise<void> {
    this.signaling.onMessage((msg) => this.handleSignalingMessage(msg));
    await this.signaling.joinRoom(code);
  }

  pickElemental(elemental: ElementalType | null) {
    this.signaling.pickElemental(elemental);
  }

  startGame(state: GameState, assignments: Record<string, ElementalType>) {
    if (!this.isHost) return;

    this.gameStarted = true;
    const stateData = GameState.toJSON(state);
    const msg: NetworkMessage = {
      type: 'game-start',
      state: stateData,
      playerAssignments: assignments,
    };

    // Send to all peers (WebRTC if open, signaling relay if not)
    this.sendToAllPeers(msg);

    // Also send via signaling broadcast as fallback
    this.signaling.startGame(stateData, assignments);
  }

  // --- Game messages ---

  sendAction(intent: ActionIntent) {
    const msg: NetworkMessage = { type: 'action', intent };
    if (this.isHost) {
      // Host processes locally — shouldn't call this normally
    } else {
      // Guest sends to host
      this.sendToAllPeers(msg);
    }
  }

  /** Host broadcasts state to all guests (optionally excluding one peer, e.g. the sender) */
  broadcastState(state: GameState, animations?: TurnAnimationData[], excludePeerId?: string, actionLabel?: string) {
    if (!this.isHost) return;
    const stateData = GameState.toJSON(state);
    const msgWithAnim: NetworkMessage = { type: 'state-update', data: stateData, animations, actionLabel };
    const msgNoAnim: NetworkMessage = { type: 'state-update', data: stateData };
    for (const [peerId, peer] of this.peers) {
      // Don't send animations back to the peer who generated them (they already played locally)
      const msg = peerId === excludePeerId ? msgNoAnim : msgWithAnim;
      if (peer.channelOpen) {
        peer.send(msg);
      } else {
        this.signaling.relay(peerId, msg);
      }
    }
  }

  /** Guest sends state to host after completing their turn */
  sendStateToHost(state: GameState, animations?: TurnAnimationData[], actionLabel?: string) {
    if (this.isHost) return;
    const msg: NetworkMessage = { type: 'state-update', data: GameState.toJSON(state), animations, actionLabel };
    this.sendToAllPeers(msg);
  }

  /** Request a rematch — sends to all peers */
  requestRematch() {
    const msg: NetworkMessage = { type: 'rematch-request', playerId: this.localId };
    this.sendToAllPeers(msg);
  }

  /** Host broadcasts rematch start with new game state */
  startRematch(state: GameState, assignments: Record<string, ElementalType>) {
    if (!this.isHost) return;
    this.gameStarted = true;
    const stateData = GameState.toJSON(state);
    const msg: NetworkMessage = { type: 'rematch-start', state: stateData, playerAssignments: assignments };
    this.sendToAllPeers(msg);
  }

  /** Earth player sends their forced move choice to all peers */
  sendForcedMoveChoice(hexId: HexId) {
    const msg: NetworkMessage = { type: 'forced-move-choice', hexId };
    this.sendToAllPeers(msg);
  }

  /** Return all players to lobby (via signaling — server resets and broadcasts) */
  returnToLobby() {
    this.gameStarted = false;
    this.signaling.returnToLobby();
  }

  /** Reset gameStarted flag (for rematch) */
  resetForNewGame() {
    this.gameStarted = false;
  }

  /** Send a message to all peers, falling back to signaling relay if WebRTC isn't open */
  private sendToAllPeers(msg: NetworkMessage) {
    for (const [peerId, peer] of this.peers) {
      if (peer.channelOpen) {
        peer.send(msg);
      } else {
        this.signaling.relay(peerId, msg);
      }
    }
  }

  // --- Internal ---

  private handleSignalingMessage(msg: SignalingMessage) {
    switch (msg.type) {
      case 'room-created':
        this.roomCode = msg.code;
        this.localId = msg.hostId;
        this.lobbyState = {
          roomCode: msg.code,
          hostId: msg.hostId,
          players: [{ id: msg.hostId, elemental: null, ready: false }],
          started: false,
        };
        this.onLobbyUpdateCallback?.(this.lobbyState);
        break;

      case 'room-joined':
        this.localId = msg.playerId;
        this.lobbyState = {
          roomCode: '',
          hostId: msg.hostId,
          players: msg.players.map(p => ({ id: p.id, elemental: p.elemental, ready: false })),
          started: false,
        };
        // Create peer connection to host
        this.createPeer(msg.hostId, false);
        this.onLobbyUpdateCallback?.(this.lobbyState);
        break;

      case 'player-joined':
        if (this.lobbyState) {
          this.lobbyState.players.push({ id: msg.playerId, elemental: null, ready: false });
          this.onLobbyUpdateCallback?.(this.lobbyState);
        }
        // Host creates peer connection to new player
        if (this.isHost) {
          this.createPeer(msg.playerId, true);
        }
        break;

      case 'player-left':
        if (this.lobbyState) {
          this.lobbyState.players = this.lobbyState.players.filter(p => p.id !== msg.playerId);
          this.onLobbyUpdateCallback?.(this.lobbyState);
        }
        if (this.gameStarted) {
          // During gameplay, don't close peer connections based on signaling state.
          // The signaling WebSocket can close independently (idle timeout, etc.)
          // without affecting the WebRTC peer connection which is still alive.
          break;
        }
        this.peers.get(msg.playerId)?.close();
        this.peers.delete(msg.playerId);
        this.onPeerDisconnectedCallback?.(msg.playerId);
        break;

      case 'elemental-picked':
        if (this.lobbyState) {
          const player = this.lobbyState.players.find(p => p.id === msg.playerId);
          if (player) player.elemental = msg.elemental;
          this.onLobbyUpdateCallback?.(this.lobbyState);
        }
        break;

      case 'signal':
        this.handlePeerSignal(msg.from, msg.data);
        break;

      case 'relay':
        // Game data relayed through signaling (WebRTC fallback)
        this.handlePeerMessage(msg.data, msg.from);
        break;

      case 'start-game':
        if (!this.isHost && !this.gameStarted && msg.state && msg.playerAssignments) {
          this.gameStarted = true;
          const myElemental = msg.playerAssignments[this.localId];
          if (myElemental) {
            this.onGameStartCallback?.(msg.state, myElemental);
          }
        }
        break;

      case 'return-to-lobby':
        this.gameStarted = false;
        // Rebuild lobby state from server's player list
        if (this.lobbyState) {
          this.lobbyState.started = false;
          this.lobbyState.players = msg.players.map(p => ({
            id: p.id,
            elemental: null,
            ready: false,
          }));
          this.onLobbyUpdateCallback?.(this.lobbyState);
        }
        this.onReturnToLobbyCallback?.();
        break;

      case 'error':
        this.onErrorCallback?.(msg.message);
        break;
    }
  }

  private createPeer(remoteId: string, initiator: boolean) {
    const peer = new PeerConnection(this.signaling, this.localId, remoteId);
    let wasEverConnected = false;

    peer.onConnected(() => {
      wasEverConnected = true;
      this.onPeerConnectedCallback?.(remoteId);
    });

    peer.onDisconnected(() => {
      // Only show disconnect if this peer previously had a working WebRTC connection.
      // If WebRTC never connected (NAT issues), signaling relay is used instead.
      if (wasEverConnected) {
        this.onPeerDisconnectedCallback?.(remoteId);
      }
    });

    peer.onMessage((data: NetworkMessage) => {
      this.handlePeerMessage(data, remoteId);
    });

    this.peers.set(remoteId, peer);

    if (initiator) {
      peer.createOffer();
    }
  }

  private async handlePeerSignal(fromId: string, data: any) {
    let peer = this.peers.get(fromId);
    if (!peer) {
      // Create peer on demand (for guests receiving from host)
      this.createPeer(fromId, false);
      peer = this.peers.get(fromId)!;
    }
    await peer.handleSignal(data);
  }

  private handlePeerMessage(msg: NetworkMessage, fromId: string) {
    switch (msg.type) {
      case 'action':
        this.onActionIntentCallback?.(msg.intent, fromId);
        break;
      case 'state-update':
        this.onRemoteStateCallback?.(msg.data, msg.animations, fromId, msg.actionLabel);
        break;
      case 'full-state':
        this.onRemoteStateCallback?.(msg.data);
        break;
      case 'game-start':
        if (!this.gameStarted) {
          this.gameStarted = true;
          const myElemental = msg.playerAssignments[this.localId];
          this.onGameStartCallback?.(msg.state, myElemental);
        }
        break;
      case 'rematch-request':
        this.onRematchRequestCallback?.(msg.playerId);
        break;
      case 'rematch-start':
        this.gameStarted = true;
        this.onRematchStartCallback?.(msg.state, msg.playerAssignments);
        break;
      case 'forced-move-choice':
        // Host forwards to all other peers (star topology relay)
        if (this.isHost) {
          const fwdMsg: NetworkMessage = { type: 'forced-move-choice', hexId: msg.hexId };
          for (const [peerId, peer] of this.peers) {
            if (peerId === fromId) continue;
            if (peer.channelOpen) {
              peer.send(fwdMsg);
            } else {
              this.signaling.relay(peerId, fwdMsg);
            }
          }
        }
        this.onForcedMoveChoiceCallback?.(msg.hexId, fromId);
        break;
    }
  }

  close() {
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
    this.signaling.close();
  }
}
