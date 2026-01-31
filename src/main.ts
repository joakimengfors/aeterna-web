// ========================================
// Aeterna: Clash of Elements - Main Entry
// ========================================

import { GameState } from './game/GameState';
import { BoardRenderer } from './ui/BoardRenderer';
import { ActionBar } from './ui/ActionBar';
import { PlayerPanel } from './ui/PlayerPanel';
import { GameLog } from './ui/GameLog';
import { TopBar } from './ui/TopBar';
import { HexInteraction } from './ui/HexInteraction';
import './assets/styles.css';

function init() {
  const state = new GameState();

  const topBarEl = document.getElementById('top-bar')!;
  const leftPanelEl = document.getElementById('left-panel')!;
  const mapAreaEl = document.getElementById('map-area')!;
  const rightPanelEl = document.getElementById('right-panel')!;
  const bottomPanelEl = document.getElementById('bottom-panel')!;

  const board = new BoardRenderer(mapAreaEl);
  const actionBar = new ActionBar(bottomPanelEl);
  const playerPanel = new PlayerPanel(leftPanelEl);
  const gameLog = new GameLog(rightPanelEl);
  const topBar = new TopBar(topBarEl);

  // Wire everything up through the interaction controller
  new HexInteraction(state, board, actionBar, playerPanel, gameLog, topBar);
}

document.addEventListener('DOMContentLoaded', init);
