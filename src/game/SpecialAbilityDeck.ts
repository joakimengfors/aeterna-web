// ========================================
// Special Ability Card Deck
// ========================================

import { SPECIAL_CARDS, type SpecialCard } from './types';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class SpecialAbilityDeck {
  deck: SpecialCard[] = [];
  discard: SpecialCard[] = [];
  noReshuffle = false; // true in 4-player: deck doesn't reshuffle

  constructor(noReshuffle = false) {
    this.noReshuffle = noReshuffle;
    this.buildDeck();
  }

  get isDeckExhausted(): boolean {
    return this.deck.length === 0;
  }

  private buildDeck() {
    // 6 unique x 2 copies = 12 cards
    const all: SpecialCard[] = [];
    for (const card of SPECIAL_CARDS) {
      all.push({ ...card }, { ...card });
    }
    this.deck = shuffle(all);
    this.discard = [];
  }

  get activeCard(): SpecialCard | null {
    return this.deck.length > 0 ? this.deck[0] : null;
  }

  get nextCard(): SpecialCard | null {
    return this.deck.length > 1 ? this.deck[1] : null;
  }

  useActiveCard(): SpecialCard | null {
    if (this.deck.length === 0) return null;
    const used = this.deck.shift()!;
    this.discard.push(used);

    // If deck exhausted, reshuffle discard (unless 4-player mode)
    if (this.deck.length === 0 && this.discard.length > 0 && !this.noReshuffle) {
      this.deck = shuffle(this.discard);
      this.discard = [];
    }

    return used;
  }

  clone(): SpecialAbilityDeck {
    const d = new SpecialAbilityDeck(this.noReshuffle);
    d.deck = this.deck.map(c => ({ ...c }));
    d.discard = this.discard.map(c => ({ ...c }));
    return d;
  }
}
