# Aeterna: Clash of Elements — Architecture & Status

## Overview

3- or 4-player hotseat/multiplayer hex board game built with vanilla TypeScript + Vite. No game framework — SVG hex grid with CSS 3D transforms for a tilted board perspective, Three.js WebGL overlay for 3D meeple and token models.

## Tech Stack

- **Runtime**: Vanilla TypeScript, no framework
- **Bundler**: Vite
- **3D Models**: Three.js + GLTFLoader for 3D meeples and token models (GLB format)
- **Rendering**: SVG hex grid + Three.js WebGL overlay for 3D models + HTML fallback for standees
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
  MainMenu.ts               ← Main menu: local play, host/join game, lobby UI
  BoardRenderer.ts          ← SVG hex grid, token images, integrates ThreeOverlay
  ThreeOverlay.ts           ← Three.js WebGL overlay: 3D model loading, positioning, animation
  HexInteraction.ts         ← Game flow orchestrator: phases, clicks, multi-step actions
  GameDialog.ts             ← Modal dialogs: action choice, confirm, info, victory screen
  ActionBar.ts              ← Bottom panel: SOT card (phase 1), action cards (phase 2)
  PlayerPanel.ts            ← Left sidebar: opponent cards with supplies/cooldowns
  GameLog.ts                ← Right sidebar: turn order, special card, log entries
  TopBar.ts                 ← Header: turn indicator, phase label

src/network/                ← Multiplayer networking
  types.ts                  ← ActionIntent, LobbyState, NetworkMessage, SignalingMessage
  SignalingClient.ts        ← WebSocket client for Cloudflare Worker signaling server
  PeerConnection.ts         ← WebRTC peer connection + data channel wrapper
  NetworkController.ts      ← High-level multiplayer orchestrator (host/guest roles)

signaling-worker/           ← Cloudflare Worker signaling server
  src/index.ts              ← Worker entry + GameRoom Durable Object
  wrangler.toml             ← Worker config
  package.json              ← Worker dependencies
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

### 3D Model System (ThreeOverlay)

- **Singleton models**: One instance per type (earth, fire, water, stone_minion). Loaded at init, positioned via `setPosition(type, hexId)`.
- **Multi-instance models**: Fog and mountain tokens. Template GLB loaded once, cloned per hex. Synced via `setTokenPositions(type, hexIds[])` which diffs current vs target and adds/removes clones.
- **Orientation**: Per-model `preRotateX`/`preRotateY` to fix authoring orientation, then `tilt` (-1.15 rad) for board perspective.
- **Movement animation**: `animateAlongPath()` for singletons (turn→move→turn per hop, 260ms/hex). `animateTokenMove()` for tokens (turn→slide→turn, 350ms). Per-model `facingOffset` controls rotation direction.
- **Async loading**: Pending positions queued while GLB loads, applied automatically on load complete.

## Game Rules Implemented

### Elementals

| Elemental | Hunts | Actions | SOT Ability |
|-----------|-------|---------|-------------|
| Earth (Kaijom) | Water | Uproot, Raise Mountain, Landslide, Sprout | Move Stone Minion 1 hex |
| Water (Nitsuji) | Fire | Mosey, Conjure Lakes, Ocean Surf, Re-Materialize | Move 1 OR teleport to Lake/Fog |
| Fire (Krakatoa) | Earth | Smoke Dash, Flame Dash, Firestorm, Firewall | Place Fire under self OR adjacent to fire |
| Aeterna (The Island) | None | Tide's Embrace, Ash to Lush, Bark and Bough, Aeterna's Favor | If powers balanced → win; else duplicate a token within 2 range |

### Win Conditions

- **Earth**: Capture Water (stand on same hex) OR 3 Forests on board
- **Water**: Capture Fire OR Fire is trapped (no legal moves)
- **Fire**: Capture Earth OR trap Earth OR 12 Fire tokens on board
- **Aeterna**: All 3 elemental powers equal (checked at Aeterna's SOT) OR special ability deck exhausted

### Aeterna (4th Player)

- **No standee** — Aeterna is an off-board player representing the island itself
- **Turn order**: Earth → Water → Fire → Aeterna → repeat
- **Tokens**: 2 Ocean tiles (block hexes, placed on empty shore hexes)
- **Power tracking**: Each elemental's power = their tokens on board (earth: mountains+forests, water: lakes, fire: fire tokens), capped at 5
- **Ocean tiles** block all movement for all elementals
- **Deck change**: In 4-player mode, the special ability deck does NOT reshuffle when empty
- **Actions**:
  1. **Tide's Embrace** — Place or move an ocean tile on an empty shore hex
  2. **Ash to Lush** — Place fire token (from Fire's supply) or relocate existing fire token
  3. **Bark and Bough** — Place forest (from Earth's supply) or relocate existing forest
  4. **Aeterna's Favor** — Remove action marker cooldown from any elemental (dialog-based)

### Movement Rules

- **Earth (Uproot/Landslide)**: Can pass through mountains and stone minion hexes but cannot end on them. Fire tokens and fog block movement entirely.
- **Ocean tiles**: Block all movement for all elementals (treated as impassable).
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
- [x] 3D tilted board with Three.js GLB models for all elementals, stone minion, fog, and mountain
- [x] Movement animations with turn-move-turn for all 3D models (elementals, minion, fog)
- [x] Board background image (board_big.png) with ocean bleed
- [x] Victory screen with winner portrait, win reason, game stats, and rematch button
- [x] Game log with turn-by-turn history
- [x] Player panels with opponent info, supplies, cooldown status
- [x] Character switcher for hotseat play
- [x] Undo/cancel during action execution
- [x] Hex highlighting: valid targets (purple), selected, dimmed, danger preview
- [x] Theme switching per player (earth green, water blue, fire orange, aeterna gold)
- [x] Scenario 1 starting setup
- [x] Aeterna (4th player) with full game logic, actions, win conditions, power tracking
- [x] 4-player mode with 2x2 player card grid layout
- [x] Multiplayer via WebRTC with STUN/TURN servers and keepalive pings
- [x] Elemental picker in multiplayer lobby (3 or 4 player)
- [x] Deck exhaustion counter in Aeterna's win condition display

## Known Issues & TODOs

### Should Improve

1. **Re-Materialize action** — Swap between Nitsuji and a Fog token. Works but could use better visual feedback showing the swap preview.

2. **Firestorm multi-step** — The 3-step fire group expansion + movement flow works but the UX could be clearer about which step you're on (currently relies on stepInstruction text).

3. **Action card descriptions** — The `ACTION_HTML` map in ActionBar.ts has rich descriptions with inline images, but some descriptions could be more precise about ranges and conditions.

### Polish / Nice to Have

4. **Token animations** — No token placement or destruction animations beyond spawn. Could add CSS transitions or requestAnimationFrame sequences for token appear/disappear.

5. **Sound effects** — No audio at all. Hooks could be added at action execution points.

6. **Board hex numbers** — Still visible (useful for debugging). Could be toggled or hidden for clean gameplay.

7. **Mobile/responsive** — Layout is desktop-only (3-column grid). Would need significant rework for mobile.

8. **Extract CSS** — Most styles are inline in `index.html`. Should be moved to `styles.css` or component-specific CSS files.

## File Sizes

| File | Lines | Role |
|------|-------|------|
| `HexInteraction.ts` | 1234 | Game flow orchestration, input handling |
| `ActionExecutor.ts` | 924 | All game actions + validation |
| `BoardRenderer.ts` | 471 | SVG board + ThreeOverlay integration |
| `ThreeOverlay.ts` | 426 | Three.js 3D model loading + animation |
| `GameDialog.ts` | 352 | Modal dialogs + victory screen |
| `HexGrid.ts` | 270 | Grid math, adjacency, pathfinding |
| `GameState.ts` | 241 | State management |
| `ActionBar.ts` | 210 | Bottom panel UI |
| `PlayerPanel.ts` | 166 | Opponent cards |
| `WinChecker.ts` | 97 | Victory conditions |
| `types.ts` | 95 | Type definitions |
| `GameLog.ts` | 90 | Log panel |
| `TopBar.ts` | 69 | Header |
| `SpecialAbilityDeck.ts` | 62 | Card deck |
| `MainMenu.ts` | 250 | Main menu + lobby UI |
| `NetworkController.ts` | 200 | Multiplayer orchestrator |
| `PeerConnection.ts` | 120 | WebRTC wrapper |
| `SignalingClient.ts` | 85 | Signaling WebSocket |
| `network/types.ts` | 60 | Network type definitions |
| `TurnManager.ts` | 42 | Turn flow |
| `main.ts` | 120 | Entry point + menu wiring |
| `signaling-worker/index.ts` | 210 | Cloudflare Worker signaling |

## Assets

```
public/assets/
  aeterna_splash.png                     ← Main menu splash background
  aeterna_logo.png                       ← Game logo for menu
  board.png                              ← Original board (small)
  board_big.png                          ← Large board with ocean (in use)
  characters/
    elementals_illustration (earth).png  ← Kaijom portrait
    elementals_illustration (water).png  ← Nitsuji portrait
    elementals_illustration (fire).png   ← Krakatoa portrait
    elementals_illustration (aeterna).png ← Aeterna portrait
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
