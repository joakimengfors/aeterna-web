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

// Reference resolution for the game layout (16:9)
const REF_WIDTH = 1920;
const REF_HEIGHT = 1080;

function getSignalingUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('server') || DEFAULT_SIGNALING_URL;
}

function init() {
  const menuEl = document.getElementById('main-menu')!;
  const gameViewport = document.querySelector('.game-viewport') as HTMLElement;
  const gameLayout = document.querySelector('.game-layout') as HTMLElement;

  let network: NetworkController | null = null;

  // Scale the game layout to fit the viewport while maintaining 16:9 aspect ratio
  function updateGameScale() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / REF_WIDTH, vh / REF_HEIGHT);
    gameLayout.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', updateGameScale);

  function showGame() {
    gameViewport.style.display = 'flex';
    updateGameScale();
  }

  function hideGame() {
    gameViewport.style.display = 'none';
  }

  const menu = new MainMenu(menuEl, {
    onLocalPlay: (playerCount: number) => {
      menu.hide();
      showGame();
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
          showGame();
          startMultiplayerGame(stateData, localElemental, network!);
        });
        await network.joinRoom(code);
        menu.setScreen('join-lobby');
      } catch (e) {
        menu.showError('Failed to connect to server.');
      }
    },

    onPickElemental: (elemental: ElementalType | null) => {
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
      showGame();
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

    const interaction = new HexInteraction(state, board, playerPanel, topBar, dialog, net);
    interaction.onReturnToLobbyCallback = () => {
      hideGame();
      menuEl.style.display = '';
      menu.setScreen(net.isHost ? 'host-lobby' : 'join-lobby');
    };
  }
}

document.addEventListener('DOMContentLoaded', init);
