// ========================================
// Aeterna: Clash of Elements - Main Entry
// ========================================

import { GameState } from './game/GameState';
import { BoardRenderer } from './ui/BoardRenderer';
import { PlayerPanel } from './ui/PlayerPanel';
import { TopBar } from './ui/TopBar';
import { GameDialog } from './ui/GameDialog';
import { HexInteraction } from './ui/HexInteraction';
import { MainMenu } from './ui/MainMenu';
import { NetworkController } from './network/NetworkController';
import type { ElementalType } from './game/types';
import './assets/styles.css';

// Default signaling server URL — override via ?server= query param
const DEFAULT_SIGNALING_URL = 'wss://aeterna-signaling.joakim-engfors.workers.dev';

function getSignalingUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('server') || DEFAULT_SIGNALING_URL;
}

function init() {
  const menuEl = document.getElementById('main-menu')!;
  const gameLayout = document.querySelector('.game-layout') as HTMLElement;

  let network: NetworkController | null = null;

  const menu = new MainMenu(menuEl, {
    onLocalPlay: (playerCount: number) => {
      menu.hide();
      gameLayout.style.display = '';
      startLocalGame(playerCount);
    },

    onHostGame: async (_playerCount: number) => {
      try {
        network = new NetworkController(getSignalingUrl(), 'host');
        network.onLobbyUpdate((lobby) => {
          menu.setLocalPlayerId(lobby.hostId);
          menu.updateLobby(lobby);
        });
        network.onError((msg) => {
          menu.showError(msg);
        });
        await network.createRoom();
        menu.setScreen('host-lobby');
      } catch (e) {
        menu.showError('Failed to connect to server. Check your connection.');
      }
    },

    onJoinGame: async (code: string) => {
      try {
        network = new NetworkController(getSignalingUrl(), 'guest');
        network.onLobbyUpdate((lobby) => {
          menu.setLocalPlayerId(network!.playerId);
          menu.updateLobby(lobby);
        });
        network.onError((msg) => {
          menu.showError(msg);
        });
        network.onGameStart((stateData, localElemental) => {
          menu.hide();
          gameLayout.style.display = '';
          startMultiplayerGame(stateData, localElemental, network!);
        });
        await network.joinRoom(code);
        menu.setScreen('join-lobby');
      } catch (e) {
        menu.showError('Failed to connect to server.');
      }
    },

    onPickElemental: (elemental: ElementalType) => {
      network?.pickElemental(elemental);
    },

    onStartGame: () => {
      if (!network || !network.isHost || !network.lobby) return;
      const lobby = network.lobby;
      const assignments: Record<string, ElementalType> = {};
      for (const p of lobby.players) {
        if (p.elemental) assignments[p.id] = p.elemental;
      }
      const expectedPlayers = lobby.players.length;
      if (Object.keys(assignments).length !== expectedPlayers) return;

      const state = new GameState(expectedPlayers);
      state.localPlayer = assignments[lobby.hostId];
      network.startGame(state, assignments);

      menu.hide();
      gameLayout.style.display = '';
      startMultiplayerGame(GameState.toJSON(state), state.localPlayer!, network);
    },

    onBackToMenu: () => {
      network?.close();
      network = null;
      menu.show();
    },
  });

  function startLocalGame(playerCount = 3) {
    const state = new GameState(playerCount);
    const topBarEl = document.getElementById('top-bar')!;
    const leftPanelEl = document.getElementById('left-panel')!;
    const mapAreaEl = document.getElementById('map-area')!;

    const board = new BoardRenderer(mapAreaEl);
    const playerPanel = new PlayerPanel(leftPanelEl);
    const topBar = new TopBar(topBarEl);
    const dialog = new GameDialog();

    new HexInteraction(state, board, playerPanel, topBar, dialog);
  }

  function startMultiplayerGame(stateData: any, localElemental: ElementalType, net: NetworkController) {
    const state = GameState.fromJSON(stateData);
    state.localPlayer = localElemental;

    const topBarEl = document.getElementById('top-bar')!;
    const leftPanelEl = document.getElementById('left-panel')!;
    const mapAreaEl = document.getElementById('map-area')!;

    const board = new BoardRenderer(mapAreaEl);
    const playerPanel = new PlayerPanel(leftPanelEl);
    const topBar = new TopBar(topBarEl);
    const dialog = new GameDialog();

    new HexInteraction(state, board, playerPanel, topBar, dialog, net);
  }
}

document.addEventListener('DOMContentLoaded', init);
