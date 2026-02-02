# Aeterna: Clash of Elements

A 3-player hotseat strategy board game played on a hex grid. Each player controls an elemental — Earth (Kaijom), Water (Nitsuji), or Fire (Krakatoa) — and competes to capture opposing elementals or control the board through terrain manipulation.

## How to Play

Players take turns in order: Earth → Water → Fire. Each turn consists of:

1. **Start of Turn** — An automatic ability based on your element (can be skipped)
2. **Choose Action** — Pick one of four unique abilities
3. **Execute** — Select targets on the hex grid
4. **Confirm** — Lock in your choices

### Elements

- **Earth (Kaijom)** — Moves forests, raises mountains, triggers landslides, and sprouts new forests
- **Water (Nitsuji)** — Conjures lakes, surfs shorelines, teleports through fog, and controls the water elemental
- **Fire (Krakatoa)** — Dashes through fire lines, builds firewalls, and triggers firestorms

### Special Cards

A shared deck of special ability cards adds variety — players draw and play cards that can swap elementals, grant extra movement, and more.

### Win Condition

Capture an opposing elemental by moving onto their hex (element-specific capture rules apply).

## Tech Stack

- **TypeScript** — No framework, vanilla DOM manipulation
- **Vite** — Dev server and build tool
- **Three.js** — 3D meeple and token models (GLB) rendered via WebGL overlay
- **SVG** — Hex grid rendering with CSS 3D perspective transforms
- **CSS** — Animations, theming per element, responsive layout

## Project Structure

```
src/
├── main.ts                     # Entry point
├── game/
│   ├── types.ts                # Shared types (ElementalType, ActionId, etc.)
│   ├── GameState.ts            # Core game state and phase management
│   ├── HexGrid.ts              # Hex grid geometry and neighbor logic
│   ├── ActionExecutor.ts       # Executes chosen actions on game state
│   ├── TurnManager.ts          # Turn order and phase transitions
│   ├── WinChecker.ts           # Victory condition detection
│   └── SpecialAbilityDeck.ts   # Special card deck management
├── ui/
│   ├── BoardRenderer.ts        # SVG hex board rendering
│   ├── HexInteraction.ts       # Click handling, action flows, targeting
│   ├── GameDialog.ts           # Modal dialogs (action choice, confirm, info)
│   ├── TopBar.ts               # Turn indicator and step instructions
│   ├── PlayerPanel.ts          # Left sidebar player info
│   └── GameLog.ts              # Game event log
├── assets/
│   └── styles.css              # All styles
index.html                      # Single-page shell
```

## Getting Started

This project uses [Bun](https://bun.sh) as its package manager and runtime.

```bash
bun install
bun run dev
```

Open `http://localhost:5173` in your browser.

## Build

```bash
bun run build
bun run preview
```
