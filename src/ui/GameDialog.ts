// ========================================
// Game Dialog (Modal Overlays)
// ========================================

import type { ActionId, ElementalType } from '../game/types';

const SOT_HTML: Record<ElementalType, string> = {
  earth: 'Move the <img class="token-inline" src="assets/meeples/stone-minion.png" alt="Stone Minion"> Stone Minion up to 1 hex. It can capture <img class="token-inline" src="assets/meeples/water-elemental.png" alt="Nitsuji"> Nitsuji.',
  water: 'Move <img class="token-inline" src="assets/meeples/water-elemental.png"> up to 1 hex <span class="or-text">or</span> teleport to any hex containing a <img class="token-inline" src="assets/tokens/lake-token.png"> or <img class="token-inline" src="assets/tokens/fog.png">.',
  fire: 'Place a <img class="token-inline" src="assets/tokens/fire-token.png"> under you <span class="or-text">or</span> place a <img class="token-inline" src="assets/tokens/fire-token.png"> on an empty hex next to an existing <img class="token-inline" src="assets/tokens/fire-token.png">.',
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
    document.body.appendChild(this.overlay);

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

  showSOT(elementalType: ElementalType, onDismiss: () => void, onSkip: () => void) {
    this.cancelCallback = null;
    this.content.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-title">Start of Turn</div>
      </div>
      <div class="dialog-body">
        <div class="dialog-message">${SOT_HTML[elementalType]}</div>
      </div>
      <div class="dialog-actions">
        <button class="dialog-btn dialog-btn-secondary" data-idx="skip">Skip</button>
        <button class="dialog-btn dialog-btn-primary" data-idx="ok">OK</button>
      </div>
    `;
    this.content.querySelector('[data-idx="ok"]')!.addEventListener('click', () => {
      this.hide();
      onDismiss();
    });
    this.content.querySelector('[data-idx="skip"]')!.addEventListener('click', () => {
      this.hide();
      onSkip();
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

    this.content.querySelectorAll('.dialog-action-card[data-action]').forEach(el => {
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

  showInfo(title: string, message: string, onContinue: () => void) {
    this.cancelCallback = () => { this.hide(); onContinue(); };
    this.content.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-title">${title}</div>
      </div>
      <div class="dialog-body">
        <div class="dialog-message">${message}</div>
      </div>
      <div class="dialog-actions">
        <button class="dialog-btn dialog-btn-primary" id="dialog-continue">Continue</button>
      </div>
    `;
    this.content.querySelector('#dialog-continue')!.addEventListener('click', () => {
      this.hide();
      onContinue();
    });
    this.show();
  }

  private show() {
    this.overlay.style.display = '';
    // Force reflow for animation
    this.overlay.offsetHeight;
    this.overlay.classList.add('dialog-visible');
    // Focus first button
    const btn = this.content.querySelector('button') as HTMLElement | null;
    if (btn) btn.focus();
  }

  hide() {
    this.overlay.classList.remove('dialog-visible');
    this.overlay.style.display = 'none';
    this.overlay.style.pointerEvents = '';
    this.content.style.pointerEvents = '';
    this.cancelCallback = null;
  }
}
