// ========================================
// Main Menu
// ========================================

import type { ElementalType } from '../game/types';
import type { LobbyState } from '../network/types';

const ELEMENTAL_NAMES: Record<ElementalType, string> = {
  earth: 'Kaijom',
  water: 'Nitsuji',
  fire: 'Krakatoa',
  aeterna: 'Aeterna',
};

const ELEMENTAL_COLORS: Record<ElementalType, string> = {
  earth: '#4caf50',
  water: '#42a5f5',
  fire: '#ff9800',
  aeterna: '#c9a84c',
};

export type MenuScreen = 'main' | 'mode-select' | 'host-lobby' | 'join' | 'join-lobby';

export interface MainMenuCallbacks {
  onLocalPlay: (playerCount: number) => void;
  onHostGame: (playerCount: number) => void;
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
  private pendingAction: 'local' | 'host' | null = null;
  private selectedPlayerCount = 3;

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
      case 'mode-select':
        this.renderModeSelect();
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
      this.pendingAction = 'local';
      this.screen = 'mode-select';
      this.render();
    });
    this.container.querySelector('#menu-host')!.addEventListener('click', () => {
      this.pendingAction = 'host';
      this.screen = 'mode-select';
      this.render();
    });
    this.container.querySelector('#menu-join')!.addEventListener('click', () => {
      this.screen = 'join';
      this.render();
    });
  }

  private renderModeSelect() {
    const title = this.pendingAction === 'host' ? 'Host Game' : 'Local Play';
    this.container.innerHTML = `
      <div class="menu-bg">
        <div class="menu-panel">
          <h2 class="menu-subtitle">${title}</h2>
          <div class="mode-select-label">Choose Game Mode</div>
          <div class="menu-buttons">
            <button class="menu-btn menu-btn-primary" id="mode-3p">3 Players</button>
            <button class="menu-btn" id="mode-4p">4 Players</button>
            <button class="menu-btn menu-btn-secondary" id="mode-back">Back</button>
          </div>
        </div>
      </div>
    `;

    const startWithCount = (count: number) => {
      this.selectedPlayerCount = count;
      if (this.pendingAction === 'local') {
        this.callbacks.onLocalPlay(count);
      } else {
        this.callbacks.onHostGame(count);
      }
    };
    this.container.querySelector('#mode-3p')!.addEventListener('click', () => startWithCount(3));
    this.container.querySelector('#mode-4p')!.addEventListener('click', () => startWithCount(4));
    this.container.querySelector('#mode-back')!.addEventListener('click', () => {
      this.screen = 'main';
      this.pendingAction = null;
      this.render();
    });
  }

  private renderHostLobby() {
    const lobby = this.lobby;
    const playerCount = lobby ? lobby.players.length : 0;
    const roomCode = lobby?.roomCode || '...';
    const localPlayer = lobby?.players.find(p => p.id === this.localPlayerId);
    const pickedElementals = new Set(lobby?.players.filter(p => p.elemental).map(p => p.elemental!) || []);

    const requiredPlayers = this.selectedPlayerCount;
    const allPicked = lobby ? lobby.players.every(p => p.elemental !== null) : false;
    const canStart = playerCount === requiredPlayers && allPicked;

    this.container.innerHTML = `
      <div class="menu-bg">
        <div class="menu-panel">
          <h2 class="menu-subtitle">Host Game</h2>

          <div class="lobby-code-box">
            <div class="lobby-code-label">Room Code</div>
            <div class="lobby-code">${roomCode}</div>
          </div>

          <div class="lobby-players">
            <div class="lobby-players-label">Players (${playerCount}/${requiredPlayers})</div>
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
    // Show aeterna option if host selected 4-player, or if someone in lobby already picked aeterna
    const show4p = this.selectedPlayerCount === 4 || taken.has('aeterna');
    const elementals: ElementalType[] = show4p
      ? ['earth', 'water', 'fire', 'aeterna']
      : ['earth', 'water', 'fire'];
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
                <img src="${el === 'aeterna' ? 'assets/characters/elementals_illustration (aeterna).png' : `assets/meeples/${el}-elemental.png`}" alt="${ELEMENTAL_NAMES[el]}" class="elemental-pick-img">
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
