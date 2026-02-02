// ========================================
// Main Menu
// ========================================

import type { ElementalType } from '../game/types';
import type { LobbyState } from '../network/types';

const ELEMENTAL_NAMES: Record<ElementalType, string> = {
  earth: 'Kaijom',
  water: 'Nitsuji',
  fire: 'Krakatoa',
};

const ELEMENTAL_COLORS: Record<ElementalType, string> = {
  earth: '#4caf50',
  water: '#42a5f5',
  fire: '#ff9800',
};

export type MenuScreen = 'main' | 'host-lobby' | 'join' | 'join-lobby';

export interface MainMenuCallbacks {
  onLocalPlay: () => void;
  onHostGame: () => void;
  onJoinGame: (code: string) => void;
  onPickElemental: (elemental: ElementalType) => void;
  onStartGame: () => void;
  onBackToMenu: () => void;
}

export class MainMenu {
  private container: HTMLElement;
  private callbacks: MainMenuCallbacks;
  private screen: MenuScreen = 'main';
  private lobby: LobbyState | null = null;
  private localPlayerId: string = '';
  private error: string = '';

  constructor(container: HTMLElement, callbacks: MainMenuCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  show() {
    this.container.style.display = '';
    this.screen = 'main';
    this.lobby = null;
    this.error = '';
    this.render();
  }

  hide() {
    this.container.style.display = 'none';
  }

  setScreen(screen: MenuScreen) {
    this.screen = screen;
    this.render();
  }

  setLocalPlayerId(id: string) {
    this.localPlayerId = id;
  }

  updateLobby(lobby: LobbyState) {
    this.lobby = lobby;
    this.render();
  }

  showError(msg: string) {
    this.error = msg;
    this.render();
  }

  private render() {
    switch (this.screen) {
      case 'main':
        this.renderMainScreen();
        break;
      case 'host-lobby':
        this.renderHostLobby();
        break;
      case 'join':
        this.renderJoinScreen();
        break;
      case 'join-lobby':
        this.renderJoinLobby();
        break;
    }
  }

  private renderMainScreen() {
    this.container.innerHTML = `
      <div class="menu-bg">
        <div class="menu-panel">
          <img src="assets/aeterna_logo.png" alt="Aeterna" class="menu-logo">
          <div class="menu-buttons">
            <button class="menu-btn menu-btn-primary" id="menu-local">Local Play</button>
            <button class="menu-btn" id="menu-host">Host Game</button>
            <button class="menu-btn" id="menu-join">Join Game</button>
          </div>
          ${this.error ? `<div class="menu-error">${this.error}</div>` : ''}
        </div>
      </div>
    `;

    this.container.querySelector('#menu-local')!.addEventListener('click', () => {
      this.callbacks.onLocalPlay();
    });
    this.container.querySelector('#menu-host')!.addEventListener('click', () => {
      this.callbacks.onHostGame();
    });
    this.container.querySelector('#menu-join')!.addEventListener('click', () => {
      this.screen = 'join';
      this.render();
    });
  }

  private renderHostLobby() {
    const lobby = this.lobby;
    const playerCount = lobby ? lobby.players.length : 0;
    const roomCode = lobby?.roomCode || '...';
    const localPlayer = lobby?.players.find(p => p.id === this.localPlayerId);
    const pickedElementals = new Set(lobby?.players.filter(p => p.elemental).map(p => p.elemental!) || []);

    const allPicked = lobby ? lobby.players.every(p => p.elemental !== null) : false;
    const canStart = playerCount === 3 && allPicked;

    this.container.innerHTML = `
      <div class="menu-bg">
        <div class="menu-panel">
          <img src="assets/aeterna_logo.png" alt="Aeterna" class="menu-logo">
          <h2 class="menu-subtitle">Host Game</h2>

          <div class="lobby-code-box">
            <div class="lobby-code-label">Room Code</div>
            <div class="lobby-code">${roomCode}</div>
          </div>

          <div class="lobby-players">
            <div class="lobby-players-label">Players (${playerCount}/3)</div>
            ${lobby ? lobby.players.map((p, i) => `
              <div class="lobby-player-row">
                <span class="lobby-player-name">${i === 0 ? 'Host' : 'Player ' + (i + 1)}</span>
                <span class="lobby-player-elemental" style="color: ${p.elemental ? ELEMENTAL_COLORS[p.elemental] : '#666'}">
                  ${p.elemental ? ELEMENTAL_NAMES[p.elemental] : 'Choosing...'}
                </span>
                ${p.id === this.localPlayerId ? ' (You)' : ''}
              </div>
            `).join('') : '<div class="lobby-player-row">Waiting...</div>'}
          </div>

          ${this.renderElementalPicker(localPlayer?.elemental || null, pickedElementals)}

          <div class="menu-buttons">
            <button class="menu-btn menu-btn-primary" id="lobby-start" ${canStart ? '' : 'disabled'}>Start Game</button>
            <button class="menu-btn menu-btn-secondary" id="lobby-back">Back</button>
          </div>
          ${this.error ? `<div class="menu-error">${this.error}</div>` : ''}
        </div>
      </div>
    `;

    this.attachElementalPicker(pickedElementals);
    this.container.querySelector('#lobby-start')?.addEventListener('click', () => {
      if (canStart) this.callbacks.onStartGame();
    });
    this.container.querySelector('#lobby-back')!.addEventListener('click', () => {
      this.callbacks.onBackToMenu();
    });
  }

  private renderJoinScreen() {
    this.container.innerHTML = `
      <div class="menu-bg">
        <div class="menu-panel">
          <img src="assets/aeterna_logo.png" alt="Aeterna" class="menu-logo">
          <h2 class="menu-subtitle">Join Game</h2>

          <div class="join-input-group">
            <label class="join-label">Room Code</label>
            <input type="text" class="join-input" id="join-code" maxlength="6" placeholder="Enter code" autocomplete="off">
          </div>

          <div class="menu-buttons">
            <button class="menu-btn menu-btn-primary" id="join-connect">Connect</button>
            <button class="menu-btn menu-btn-secondary" id="join-back">Back</button>
          </div>
          ${this.error ? `<div class="menu-error">${this.error}</div>` : ''}
        </div>
      </div>
    `;

    const input = this.container.querySelector('#join-code') as HTMLInputElement;
    input.focus();
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    this.container.querySelector('#join-connect')!.addEventListener('click', () => {
      const code = input.value.trim();
      if (code.length === 6) {
        this.callbacks.onJoinGame(code);
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = input.value.trim();
        if (code.length === 6) {
          this.callbacks.onJoinGame(code);
        }
      }
    });

    this.container.querySelector('#join-back')!.addEventListener('click', () => {
      this.screen = 'main';
      this.error = '';
      this.render();
    });
  }

  private renderJoinLobby() {
    const lobby = this.lobby;
    const playerCount = lobby ? lobby.players.length : 0;
    const localPlayer = lobby?.players.find(p => p.id === this.localPlayerId);
    const pickedElementals = new Set(lobby?.players.filter(p => p.elemental).map(p => p.elemental!) || []);

    this.container.innerHTML = `
      <div class="menu-bg">
        <div class="menu-panel">
          <img src="assets/aeterna_logo.png" alt="Aeterna" class="menu-logo">
          <h2 class="menu-subtitle">Lobby</h2>

          <div class="lobby-players">
            <div class="lobby-players-label">Players (${playerCount}/3)</div>
            ${lobby ? lobby.players.map((p, i) => `
              <div class="lobby-player-row">
                <span class="lobby-player-name">${p.id === lobby.hostId ? 'Host' : 'Player ' + (i + 1)}</span>
                <span class="lobby-player-elemental" style="color: ${p.elemental ? ELEMENTAL_COLORS[p.elemental] : '#666'}">
                  ${p.elemental ? ELEMENTAL_NAMES[p.elemental] : 'Choosing...'}
                </span>
                ${p.id === this.localPlayerId ? ' (You)' : ''}
              </div>
            `).join('') : '<div class="lobby-player-row">Connecting...</div>'}
          </div>

          ${this.renderElementalPicker(localPlayer?.elemental || null, pickedElementals)}

          <div class="menu-buttons">
            <div class="menu-waiting">Waiting for host to start...</div>
            <button class="menu-btn menu-btn-secondary" id="lobby-back">Leave</button>
          </div>
          ${this.error ? `<div class="menu-error">${this.error}</div>` : ''}
        </div>
      </div>
    `;

    this.attachElementalPicker(pickedElementals);
    this.container.querySelector('#lobby-back')!.addEventListener('click', () => {
      this.callbacks.onBackToMenu();
    });
  }

  private renderElementalPicker(current: ElementalType | null, taken: Set<ElementalType>): string {
    const elementals: ElementalType[] = ['earth', 'water', 'fire'];
    return `
      <div class="elemental-picker">
        <div class="elemental-picker-label">Choose Your Elemental</div>
        <div class="elemental-picker-options">
          ${elementals.map(el => {
            const isTaken = taken.has(el) && current !== el;
            const isSelected = current === el;
            return `
              <button class="elemental-pick-btn${isSelected ? ' selected' : ''}${isTaken ? ' taken' : ''}"
                      data-elemental="${el}" ${isTaken ? 'disabled' : ''}
                      style="--pick-color: ${ELEMENTAL_COLORS[el]}">
                <img src="assets/meeples/${el}-elemental.png" alt="${ELEMENTAL_NAMES[el]}" class="elemental-pick-img">
                <span class="elemental-pick-name">${ELEMENTAL_NAMES[el]}</span>
                ${isTaken ? '<span class="elemental-pick-taken">Taken</span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private attachElementalPicker(taken: Set<ElementalType>) {
    this.container.querySelectorAll('.elemental-pick-btn').forEach(btn => {
      if (btn.hasAttribute('disabled')) return;
      btn.addEventListener('click', () => {
        const el = btn.getAttribute('data-elemental') as ElementalType;
        this.callbacks.onPickElemental(el);
      });
    });
  }
}
