// ========================================
// Game Dialog (Modal Overlays)
// ========================================

import type { GameState } from '../game/GameState';
import type { ActionId, ElementalType } from '../game/types';

const SOT_HTML: Record<ElementalType, string> = {
  earth: 'Move the <img class="token-inline" src="assets/meeples/stone-minion.png" alt="Stone Minion"> Stone Minion up to 1 hex. It can capture <img class="token-inline" src="assets/meeples/water-elemental.png" alt="Nitsuji"> Nitsuji.',
  water: 'Move <img class="token-inline" src="assets/meeples/water-elemental.png"> up to 1 hex <span class="or-text">or</span> teleport to any hex containing a <img class="token-inline" src="assets/tokens/lake-token.png"> or <img class="token-inline" src="assets/tokens/fog.png">.',
  fire: 'Place a <img class="token-inline" src="assets/tokens/fire-token.png"> under you <span class="or-text">or</span> place a <img class="token-inline" src="assets/tokens/fire-token.png"> on an empty hex next to an existing <img class="token-inline" src="assets/tokens/fire-token.png">.',
  aeterna: 'Duplicate a token on the board — pick a token, then choose an empty hex within 2 range.',
};

const ACTION_HTML: Record<string, string> = {
  'uproot': '<img class="meeple-inline" src="assets/meeples/earth-elemental.png"> up to 3 hexes (or 4 if there is a <img class="token-inline" src="assets/tokens/forest-token.png"> on the board).',
  'raise-mountain': '<img class="meeple-inline" src="assets/meeples/earth-elemental.png"> up to 1 hex.<br><br>Place a <img class="token-inline" src="assets/tokens/mountain.png"> on any empty hex.',
  'landslide': '<img class="meeple-inline" src="assets/meeples/earth-elemental.png"> up to as many hexes as there are <img class="token-inline" src="assets/tokens/mountain.png"> in play.<br><br>Destroy a <img class="token-inline" src="assets/tokens/mountain.png"> and chain-destroy all adjacent tokens.',
  'sprout': 'Replace a <img class="token-inline" src="assets/tokens/lake-token.png"> adjacent to a <img class="token-inline" src="assets/tokens/forest-token.png"> with a <img class="token-inline" src="assets/tokens/forest-token.png">.',
  'mosey': '<img class="meeple-inline" src="assets/meeples/water-elemental.png"> up to 1 hex.',
  'conjure': 'Place 2 <img class="token-inline" src="assets/tokens/lake-token.png"> on empty hexes within 3 hexes of <img class="meeple-inline" src="assets/meeples/water-elemental.png">.',
  'surf': 'Teleport <img class="meeple-inline" src="assets/meeples/water-elemental.png"> from a shore hex to another empty shore hex.',
  'rematerialize': '<img class="meeple-inline" src="assets/meeples/water-elemental.png"> and a <img class="token-inline" src="assets/tokens/fog.png"> swap places.',
  'smoke-dash': '<img class="meeple-inline" src="assets/meeples/fire-elemental.png"> 2 in a line, ignore terrain.',
  'flame-dash': '<img class="meeple-inline" src="assets/meeples/fire-elemental.png"> 3 in a line.<br><br>Place <img class="token-inline" src="assets/tokens/fire-token.png"> under you.',
  'firestorm': 'Add <img class="token-inline" src="assets/tokens/fire-token.png"> to up to 3 <img class="token-inline" src="assets/tokens/fire-token.png"> groups. <img class="meeple-inline" src="assets/meeples/fire-elemental.png"> freely through <img class="token-inline" src="assets/tokens/fire-token.png">.',
  'firewall': 'Place 3 <img class="token-inline" src="assets/tokens/fire-token.png"> in a line from <img class="meeple-inline" src="assets/meeples/fire-elemental.png">.',
  'tides-embrace': 'Place an ocean tile on an empty shore hex, or move an existing ocean tile.',
  'ash-to-lush': 'Place a <img class="token-inline" src="assets/tokens/fire-token.png"> from Fire\'s supply on an empty hex.',
  'bark-and-bough': 'Place a <img class="token-inline" src="assets/tokens/forest-token.png"> from Earth\'s supply on an empty hex.',
  'aeternas-favor': 'Remove the action cooldown from one Elemental\'s ability.',
};

const ABILITY_ICONS: Record<string, { image: string; pos: string }> = {
  'uproot':          { image: 'assets/abilities/earth-abilities.png', pos: '0% 0%' },
  'raise-mountain':  { image: 'assets/abilities/earth-abilities.png', pos: '100% 0%' },
  'landslide':       { image: 'assets/abilities/earth-abilities.png', pos: '0% 100%' },
  'sprout':          { image: 'assets/abilities/earth-abilities.png', pos: '100% 100%' },
};

export class GameDialog {
  private overlay: HTMLElement;
  private content: HTMLElement;
  private cancelCallback: (() => void) | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'dialog-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="dialog-backdrop"></div>
      <div class="dialog-content"></div>
    `;
    const gameLayout = document.querySelector('.game-layout')!;
    gameLayout.appendChild(this.overlay);

    this.content = this.overlay.querySelector('.dialog-content')!;

    // Backdrop click → cancel
    this.overlay.querySelector('.dialog-backdrop')!.addEventListener('click', () => {
      if (this.cancelCallback) this.cancelCallback();
    });

    // Escape key → cancel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.style.display !== 'none') {
        if (this.cancelCallback) this.cancelCallback();
      }
    });
  }

  showSOT(elementalType: ElementalType, onSkip: () => void, onCancel?: () => void) {
    this.cancelCallback = onCancel ? () => { this.hide(); onCancel(); } : null;
    this.content.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-title">Start of Turn</div>
      </div>
      <div class="dialog-body">
        <div class="dialog-message">${SOT_HTML[elementalType]}</div>
      </div>
      <div class="dialog-actions">
        <button class="dialog-btn dialog-btn-secondary" data-idx="skip">Skip</button>
        ${onCancel ? '<button class="dialog-btn dialog-btn-cancel" data-idx="cancel">Cancel</button>' : ''}
      </div>
    `;
    this.content.querySelector('[data-idx="skip"]')!.addEventListener('click', () => {
      this.hide();
      onSkip();
    });
    this.content.querySelector('[data-idx="cancel"]')?.addEventListener('click', () => {
      this.hide();
      if (onCancel) onCancel();
    });
    // Non-blocking: let clicks pass through overlay to hexes beneath
    this.overlay.style.pointerEvents = 'none';
    this.content.style.pointerEvents = 'auto';
    this.show();
  }

  showActionChoice(
    actions: { id: ActionId; name: string; description: string }[],
    blockedAction: ActionId | null,
    specialCardName: string | null,
    onSelect: (actionId: ActionId) => void,
  ) {
    this.cancelCallback = null;
    const cards = actions.map(a => {
      const blocked = a.id === blockedAction;
      const isSpecial = a.id === 'special';
      const icon = ABILITY_ICONS[a.id];
      const desc = isSpecial && specialCardName ? specialCardName : (ACTION_HTML[a.id] || a.description);
      return `
        <div class="dialog-action-card${blocked ? ' blocked' : ''}${isSpecial ? ' special' : ''}" data-action="${a.id}">
          ${icon ? `<div class="dialog-action-icon" style="background-image: url('${icon.image}'); background-position: ${icon.pos};"></div>` : ''}
          <div class="dialog-action-card-content">
            <div class="dialog-action-card-name">${a.name}</div>
            <div class="dialog-action-card-desc">${desc}</div>
          </div>
        </div>
      `;
    }).join('');

    this.content.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-title">Choose Action</div>
      </div>
      <div class="dialog-body dialog-body-actions">
        <div class="dialog-action-grid">${cards}</div>
      </div>
    `;

    const actionCards = this.content.querySelectorAll('.dialog-action-card[data-action]');
    console.log('[Dialog] showActionChoice — %d action cards, %d blocked',
      actionCards.length,
      this.content.querySelectorAll('.dialog-action-card.blocked').length);
    actionCards.forEach(el => {
      if (el.classList.contains('blocked')) return;
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-action') as ActionId;
        this.hide();
        onSelect(id);
      });
    });
    this.show();
  }

  showConfirm(message: string, onConfirm: () => void, onUndo: () => void) {
    this.cancelCallback = () => { this.hide(); onUndo(); };
    this.content.innerHTML = `
      <div class="dialog-body">
        <div class="dialog-message">${message}</div>
      </div>
      <div class="dialog-actions">
        <button class="dialog-btn dialog-btn-secondary" id="dialog-undo">Undo</button>
        <button class="dialog-btn dialog-btn-primary" id="dialog-confirm">Confirm</button>
      </div>
    `;
    this.content.querySelector('#dialog-confirm')!.addEventListener('click', () => {
      this.hide();
      onConfirm();
    });
    this.content.querySelector('#dialog-undo')!.addEventListener('click', () => {
      this.hide();
      onUndo();
    });
    this.show();
  }

  showChoice(title: string, message: string, choices: { text: string; callback: () => void; primary?: boolean }[]) {
    this.cancelCallback = null; // No cancel for choice dialogs — must pick one
    const buttons = choices.map((c, i) => `
      <button class="dialog-btn ${c.primary !== false && (c.primary || i === 0) ? 'dialog-btn-primary' : 'dialog-btn-secondary'}" data-idx="${i}">
        ${c.text}
      </button>
    `).join('');

    this.content.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-title">${title}</div>
      </div>
      <div class="dialog-body">
        <div class="dialog-message">${message}</div>
      </div>
      <div class="dialog-actions">${buttons}</div>
    `;

    choices.forEach((c, i) => {
      this.content.querySelector(`[data-idx="${i}"]`)!.addEventListener('click', () => {
        this.hide();
        c.callback();
      });
    });
    this.show();
  }

  showInfoWithSkip(title: string, message: string, onSkip: () => void, onCancel?: () => void) {
    this.cancelCallback = onCancel ? () => { this.hide(); onCancel(); } : null;
    this.content.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-title">${title}</div>
      </div>
      <div class="dialog-body">
        <div class="dialog-message">${message}</div>
      </div>
      <div class="dialog-actions">
        <button class="dialog-btn dialog-btn-secondary" data-idx="skip">Skip</button>
        ${onCancel ? '<button class="dialog-btn dialog-btn-cancel" data-idx="cancel">Cancel</button>' : ''}
      </div>
    `;
    this.content.querySelector('[data-idx="skip"]')!.addEventListener('click', () => {
      onSkip();
    });
    this.content.querySelector('[data-idx="cancel"]')?.addEventListener('click', () => {
      this.hide();
      if (onCancel) onCancel();
    });
    // Non-blocking
    this.overlay.style.pointerEvents = 'none';
    this.content.style.pointerEvents = 'auto';
    this.show();
  }

  showInfo(title: string, message: string, onCancel?: () => void) {
    this.cancelCallback = onCancel ? () => { this.hide(); onCancel(); } : null;
    this.content.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-title">${title}</div>
      </div>
      <div class="dialog-body">
        <div class="dialog-message">${message}</div>
      </div>
      ${onCancel ? '<div class="dialog-actions"><button class="dialog-btn dialog-btn-cancel" data-idx="cancel">Cancel</button></div>' : ''}
    `;
    if (onCancel) {
      this.content.querySelector('[data-idx="cancel"]')!.addEventListener('click', () => {
        this.hide();
        onCancel();
      });
    }
    // Non-blocking: let clicks pass through to hexes, auto-dismissed on next hex click
    this.overlay.style.pointerEvents = 'none';
    this.content.style.pointerEvents = 'auto';
    // Info dialogs are dismissed by hex clicks (via onHexClick → dialog.hide())
    // or by renderAll() — no need for click-to-dismiss on the dialog itself.
    this.show();
  }

  showVictory(state: GameState, options: { onRematch: () => void; onReturnToMenu: () => void; onReturnToLobby?: () => void }) {
    this.cancelCallback = null;
    const winner = state.winner!;
    const names: Record<ElementalType, string> = { earth: 'Kaijom', water: 'Nitsuji', fire: 'Krakatoa', aeterna: 'Aeterna' };
    const portraits: Record<ElementalType, string> = {
      earth: 'assets/characters/elementals_illustration (earth).png',
      water: 'assets/characters/elementals_illustration (water).png',
      fire: 'assets/characters/elementals_illustration (fire).png',
      aeterna: 'assets/characters/elementals_illustration (aeterna).png',
    };

    // Determine win reason
    const reason = this.getWinReason(state, winner);

    // Gather stats
    const turns = state.turnNumber;
    const totalMoves = state.log.length;
    const tokenStats: Record<ElementalType, number> = { earth: 0, water: 0, fire: 0, aeterna: 0 };
    for (const hex of state.board.values()) {
      tokenStats.earth += hex.tokens.filter(t => t === 'forest' || t === 'mountain').length;
      tokenStats.water += hex.tokens.filter(t => t === 'lake' || t === 'fog').length;
      tokenStats.fire += hex.tokens.filter(t => t === 'fire').length;
    }

    this.content.innerHTML = `
      <div class="dialog-header victory-header victory-header-${winner}">
        <div class="dialog-title victory-title">Victory</div>
      </div>
      <div class="dialog-body victory-body">
        <div class="victory-portrait">
          <img src="${portraits[winner]}" alt="${names[winner]}">
        </div>
        <div class="victory-name">${names[winner]}</div>
        <div class="victory-reason">${reason}</div>
        <div class="victory-stats">
          <div class="victory-stat">
            <span class="victory-stat-value">${turns}</span>
            <span class="victory-stat-label">Rounds</span>
          </div>
          <div class="victory-stat">
            <span class="victory-stat-value">${totalMoves}</span>
            <span class="victory-stat-label">Actions</span>
          </div>
          <div class="victory-stat">
            <span class="victory-stat-value">${tokenStats.earth}</span>
            <span class="victory-stat-label"><img class="token-inline" src="assets/tokens/forest-token.png"> <img class="token-inline" src="assets/tokens/mountain.png"></span>
          </div>
          <div class="victory-stat">
            <span class="victory-stat-value">${tokenStats.water}</span>
            <span class="victory-stat-label"><img class="token-inline" src="assets/tokens/lake-token.png"> <img class="token-inline" src="assets/tokens/fog.png"></span>
          </div>
          <div class="victory-stat">
            <span class="victory-stat-value">${tokenStats.fire}</span>
            <span class="victory-stat-label"><img class="token-inline" src="assets/tokens/fire-token.png"></span>
          </div>
        </div>
      </div>
      <div class="dialog-actions victory-actions">
        <button class="dialog-btn dialog-btn-primary" data-idx="rematch">Rematch</button>
        ${options.onReturnToLobby ? '<button class="dialog-btn dialog-btn-secondary" data-idx="lobby">Return to Lobby</button>' : ''}
        <button class="dialog-btn dialog-btn-secondary" data-idx="menu">Return to Menu</button>
      </div>
    `;

    this.content.querySelector('[data-idx="rematch"]')!.addEventListener('click', () => {
      options.onRematch();
    });
    this.content.querySelector('[data-idx="lobby"]')?.addEventListener('click', () => {
      this.hide();
      options.onReturnToLobby!();
    });
    this.content.querySelector('[data-idx="menu"]')!.addEventListener('click', () => {
      this.hide();
      options.onReturnToMenu();
    });

    // Blocking overlay with backdrop
    this.overlay.style.pointerEvents = '';
    this.content.style.pointerEvents = '';
    this.show();
  }

  /** Update rematch button to show vote count and disable other buttons */
  updateRematchStatus(currentVotes: number, totalPlayers: number) {
    const rematchBtn = this.content.querySelector('[data-idx="rematch"]') as HTMLButtonElement | null;
    if (rematchBtn) {
      rematchBtn.textContent = `Rematch \u2713 (${currentVotes}/${totalPlayers})`;
      rematchBtn.disabled = true;
    }
    // Disable other buttons once player has committed to rematch
    const lobbyBtn = this.content.querySelector('[data-idx="lobby"]') as HTMLButtonElement | null;
    const menuBtn = this.content.querySelector('[data-idx="menu"]') as HTMLButtonElement | null;
    if (lobbyBtn) lobbyBtn.disabled = true;
    if (menuBtn) menuBtn.disabled = true;
  }

  private getWinReason(state: GameState, winner: ElementalType): string {
    const earth = state.getPlayer('earth');
    const water = state.getPlayer('water');
    const fire = state.getPlayer('fire');
    const minionHex = state.getStoneMinionHex();

    if (winner === 'earth') {
      if (earth.hexId === water.hexId) return 'Captured Nitsuji';
      if (minionHex !== null && minionHex === water.hexId) return 'Stone Minion captured Nitsuji';
      if (state.countTokensOnBoard('forest') >= 3) return 'Grew 3 Forests';
    }
    if (winner === 'water') {
      if (water.hexId === fire.hexId) return 'Captured Krakatoa';
      return 'Krakatoa was trapped';
    }
    if (winner === 'fire') {
      if (fire.hexId === earth.hexId) return 'Captured Kaijom';
      if (state.countTokensOnBoard('fire') >= 12) return 'Spread 12 Fire tokens';
      return 'Kaijom was trapped';
    }
    if (winner === 'aeterna') {
      const ep = state.getElementalPower('earth');
      const wp = state.getElementalPower('water');
      const fp = state.getElementalPower('fire');
      if (ep === wp && wp === fp) return 'All elemental powers balanced';
      return 'Special ability deck exhausted';
    }
    return 'Victory';
  }

  setTheme(elementalType: ElementalType) {
    this.overlay.classList.remove('theme-earth', 'theme-water', 'theme-fire', 'theme-aeterna');
    this.overlay.classList.add(`theme-${elementalType}`);
  }

  private show() {
    this.overlay.style.display = '';
    // Force reflow for animation
    this.overlay.offsetHeight;
    this.overlay.classList.add('dialog-visible');
    console.log('[Dialog] show() — title:', this.content.querySelector('.dialog-title')?.textContent || '(no title)',
      'pointerEvents:', this.overlay.style.pointerEvents || 'CSS default');
    // Focus first button
    const btn = this.content.querySelector('button') as HTMLElement | null;
    if (btn) btn.focus();
  }

  hide() {
    const wasVisible = this.overlay.classList.contains('dialog-visible');
    if (wasVisible) {
      console.log('[Dialog] hide() — was visible, content:', this.content.querySelector('.dialog-title')?.textContent || '(no title)');
    }
    this.overlay.classList.remove('dialog-visible');
    this.overlay.style.display = 'none';
    this.overlay.style.pointerEvents = '';
    this.content.style.pointerEvents = '';
    this.cancelCallback = null;
  }
}
