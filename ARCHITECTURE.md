# Aeterna: Clash of Elements — Architecture & Status

## Overview

3-player hotseat hex board game built with vanilla TypeScript + Vite. No game framework — pure SVG hex grid with CSS 3D transforms for a tilted board perspective and standing meeples.

## Tech Stack

- **Runtime**: Vanilla TypeScript, no framework
- **Bundler**: Vite
- **Rendering**: SVG hex grid + HTML overlay for 3D standees
- **Styling**: Inline CSS in `index.html` + `src/assets/styles.css` (design system)
- **Fonts**: Cinzel (display), Inter (body), Material Icons

## Architecture

```
index.html                  ← Layout grid, all component CSS, character switcher
src/main.ts                 ← Entry point, wires all components together

src/game/                   ← Pure game logic (no DOM)
  types.ts                  ← ElementalType, TokenType, Phase, ActionId, ActionDef, SpecialCard
  HexGrid.ts               ← 41-hex grid: positions, adjacency, pathfinding, shore detection
  GameState.ts              ← Central state: board, players, tokens, turns, phases, undo clone
  TurnManager.ts            ← Turn order, action marker cooldown, turn advancement
  ActionExecutor.ts         ← All action implementations + validation + target computation
  WinChecker.ts             ← Victory conditions + trap detection
  SpecialAbilityDeck.ts     ← 12-card deck (6 unique x2), shuffle, draw, discard

src/ui/                     ← DOM rendering (reads GameState, writes HTML)
  BoardRenderer.ts          ← SVG hex grid, token images, 3D standee overlay
  HexInteraction.ts         ← Game flow orchestrator: phases, clicks, multi-step actions
  ActionBar.ts              ← Bottom panel: SOT card (phase 1), action cards (phase 2)
  PlayerPanel.ts            ← Left sidebar: opponent cards with supplies/cooldowns
  GameLog.ts                ← Right sidebar: turn order, special card, log entries
  TopBar.ts                 ← Header: turn indicator, phase label
```

### Data Flow

```
User clicks hex
  → BoardRenderer fires onHexClick
    → HexInteraction validates against validTargets
      → Updates GameState (move, place token, etc.)
      → Calls renderAll() which re-renders all UI components
        → BoardRenderer.render(state)
        → ActionBar.render(state)
        → PlayerPanel.render(state)
        → GameLog.render(state)
        → TopBar.render(state)
```

### Phase Flow

```
START_OF_TURN → (Use Ability / Skip) → CHOOSE_ACTION → (Pick action) → EXECUTING → (Click hexes) → CONFIRM → (Confirm) → next player's START_OF_TURN
```

Multi-step actions (Raise Mountain, Landslide, Conjure, Firestorm, Flame Dash) stay in EXECUTING across multiple hex clicks, incrementing `currentStep`.

#### Sub-phases

Some actions trigger interactive sub-phases that interrupt the normal flow:

- **Fog Movement**: After Water moves (SOT or Mosey, not teleport), the player is prompted to move each fog token up to the same distance. Fog can move to any adjacent hex. Tracked via `pendingFogMoves` in HexInteraction.
- **Earth Forced Move**: When Fire places a fire token on Earth's hex, Earth's player chooses where to move (1 adjacent hex). Tracked via `pendingForcedMove` in GameState.

### Undo System

Before any action begins, `GameState.clone()` saves a deep copy. On undo, `Object.assign` restores the snapshot. This means all intermediate state mutations (preview moves, token placements) are safely reversible.

## Board Rendering

- **SVG viewBox**: `0 0 628 700` — hex positions are hardcoded in HexGrid.ts
- **Container**: `aspect-ratio: 628/700` with `rotateX(42deg) scale(1.7)` for 3/4 perspective
- **Background**: `board_big.png` on `::before` pseudo-element with `inset: -40%` for ocean bleed
- **Standees**: Three.js WebGL overlay for 3D models (earth, water, fire elementals + stone minion), HTML div fallback for types without GLB
- **Tokens**: SVG `<image>` elements for forest/fire/lake tokens. Fog and mountain rendered as 3D models via ThreeOverlay (multi-instance cloning). HTML standee fallback when 3D unavailable

## Game Rules Implemented

### Elementals

| Elemental | Hunts | Actions | SOT Ability |
|-----------|-------|---------|-------------|
| Earth (Kaijom) | Water | Uproot, Raise Mountain, Landslide, Sprout | Move Stone Minion 1 hex |
| Water (Nitsuji) | Fire | Mosey, Conjure Lakes, Ocean Surf, Re-Materialize | Move 1 OR teleport to Lake/Fog |
| Fire (Krakatoa) | Earth | Smoke Dash, Flame Dash, Firestorm, Firewall | Place Fire under self OR adjacent to fire |

### Win Conditions

- **Earth**: Capture Water (stand on same hex) OR 3 Forests on board
- **Water**: Capture Fire OR Fire is trapped (no legal moves)
- **Fire**: Capture Earth OR trap Earth OR 12 Fire tokens on board

### Movement Rules

- **Earth (Uproot/Landslide)**: Can pass through mountains and stone minion hexes but cannot end on them. Fire tokens and fog block movement entirely.
- **Flame Dash**: Player may place fire on their current hex before moving OR on the destination hex after moving (not both).
- **Fog Movement**: Whenever Water moves (not teleports), all fog tokens may be moved up to the same distance. Fog can move to any adjacent hex.
- **Fog Auto-deploy**: When the last lake token is placed (via Conjure or fire→lake conversion), fog automatically deploys from supply onto the same hex.

### Token Conversions (on movement)

- Earth enters Lake hex → Lake becomes Forest
- Water enters Fire hex → Fire becomes Lake (+ fog auto-deploy if last lake)
- Fire enters Forest hex → Forest becomes Fire

### Special Ability Cards (6 unique, 12 total)

1. Start of Turn (extra SOT)
2. Move 2, Ignore Terrain
3. Move 3 in a Line
4. Teleport to Shore
5. Use Any Ability
6. Swap Places

## What's Complete (MVP)

- [x] All 3 elementals with 4 actions + special each
- [x] Start of Turn abilities for all 3
- [x] Action marker cooldown system
- [x] Multi-step action flows (Raise Mountain, Landslide, Conjure, Firestorm)
- [x] Step-by-step instructions in action bar during execution
- [x] Token placement, destruction, conversion
- [x] Mountain chain destruction (Landslide)
- [x] All win conditions (capture, forests, fire tokens, trapping)
- [x] Special ability deck with all 6 card types
- [x] 3D tilted board with standing meeples
- [x] Board background image (board_big.png) with ocean bleed
- [x] Game log with turn-by-turn history
- [x] Player panels with opponent info, supplies, cooldown status
- [x] Character switcher for hotseat play
- [x] Undo/cancel during action execution
- [x] Hex highlighting: valid targets (purple), selected, dimmed, danger preview
- [x] Theme switching per player (earth green, water blue, fire orange)
- [x] Scenario 1 starting setup

## Known Issues & TODOs

### Must Fix

1. **Raise Mountain "move existing mountain"** — When all 4 mountains are placed, the action should let you pick up an existing mountain and relocate it. The target selection flow for this needs refinement (currently implemented but the 2-target UX for source→destination isn't polished).

### Should Improve

2. **Re-Materialize action** — Swap between Nitsuji and a Fog token. Works but could use better visual feedback showing the swap preview.

3. **Firestorm multi-step** — The 3-step fire group expansion + movement flow works but the UX could be clearer about which step you're on (currently relies on stepInstruction text).

4. **Action card descriptions** — The `ACTION_HTML` map in ActionBar.ts has rich descriptions with inline images, but some descriptions could be more precise about ranges and conditions.

### Polish / Nice to Have

7. **Animations** — No token placement or destruction animations beyond spawn. Movement animations exist for elementals and minion. Could add more CSS transitions or requestAnimationFrame sequences.

8. **Sound effects** — No audio at all. Hooks could be added at action execution points.

9. **Win screen** — Currently just `alert()`. Should show a proper victory overlay.

10. **Board hex numbers** — Still visible (useful for debugging). Could be toggled or hidden for clean gameplay.

11. **Mobile/responsive** — Layout is desktop-only (3-column grid). Would need significant rework for mobile.

12. **Extract CSS** — Most styles are inline in `index.html`. Should be moved to `styles.css` or component-specific CSS files.

13. **Aeterna (4th player)** — Not in MVP scope. Would require significant game logic additions.

14. **Multiplayer/networking** — Not in scope. Currently local hotseat only.

## File Sizes

| File | Lines | Role |
|------|-------|------|
| `ActionExecutor.ts` | 855 | Largest — all game actions |
| `HexInteraction.ts` | 531 | Game flow orchestration |
| `BoardRenderer.ts` | 290 | SVG + standee rendering |
| `HexGrid.ts` | 238 | Grid math and adjacency |
| `GameState.ts` | 236 | State management |
| `ActionBar.ts` | 197 | Bottom panel UI |
| `PlayerPanel.ts` | 136 | Opponent cards |
| `WinChecker.ts` | 98 | Victory conditions |
| `types.ts` | 96 | Type definitions |
| `GameLog.ts` | 91 | Log panel |
| `SpecialAbilityDeck.ts` | 63 | Card deck |
| `TopBar.ts` | 55 | Header |
| `TurnManager.ts` | 43 | Turn flow |
| `main.ts` | 33 | Entry point |

## Assets

```
public/assets/
  board.png                              ← Original board (small)
  board_big.png                          ← Large board with ocean (in use)
  characters/
    elementals_illustration (earth).png  ← Kaijom portrait
    elementals_illustration (water).png  ← Nitsuji portrait
    elementals_illustration (fire).png   ← Krakatoa portrait
  meeples/
    earth-elemental.png                  ← Kaijom standee art (2D fallback)
    water-elemental.png                  ← Nitsuji standee art (2D fallback)
    fire-elemental.png                   ← Krakatoa standee art (2D fallback)
    stone-minion.png                     ← Stone Minion standee art (2D fallback)
  tokens/
    mountain.png                         ← Mountain silhouette token (2D fallback)
    forest-token.png                     ← Forest token (circular)
    fire-token.png                       ← Fire token (circular)
    lake-token.png                       ← Lake token (circular)
    fog.png                              ← Fog token (2D fallback)

meeples/                                 ← 3D model files (GLB + textures)
  elemental_earth.glb                    ← Kaijom 3D model
  elemental_fire.glb                     ← Krakatoa 3D model
  elemental_water.glb                    ← Nitsuji 3D model
  meeple_stoneminion.glb                 ← Stone Minion 3D model
  meeple_fog.glb                         ← Fog token 3D model
  mountain.glb                           ← Mountain token 3D model (embedded materials)
  earth.png                              ← Earth model texture
  fire_meeple.png                        ← Fire model texture
  water_meeple.png                       ← Water model texture
  stone.png                              ← Stone Minion model texture
  fog.png                                ← Fog model texture
```
