// ========================================
// Aeterna: Clash of Elements - Main Entry
// ========================================

import { GameState } from './game/GameState';
import { BoardRenderer } from './ui/BoardRenderer';
import { PlayerPanel } from './ui/PlayerPanel';
import { TopBar } from './ui/TopBar';
import { GameDialog } from './ui/GameDialog';
import { HexInteraction } from './ui/HexInteraction';
import './assets/styles.css';

function init() {
  const state = new GameState();

  const topBarEl = document.getElementById('top-bar')!;
  const leftPanelEl = document.getElementById('left-panel')!;
  const mapAreaEl = document.getElementById('map-area')!;

  const board = new BoardRenderer(mapAreaEl);
  const playerPanel = new PlayerPanel(leftPanelEl);
  const topBar = new TopBar(topBarEl);
  const dialog = new GameDialog();

  // Wire everything up through the interaction controller
  new HexInteraction(state, board, playerPanel, topBar, dialog);
}

document.addEventListener('DOMContentLoaded', init);
