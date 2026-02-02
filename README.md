# Aeterna: Clash of Elements

A 3-player strategy board game played on a hex grid with local hotseat and online multiplayer. Each player controls an elemental — Earth (Kaijom), Water (Nitsuji), or Fire (Krakatoa) — and competes to capture opposing elementals or control the board through terrain manipulation.

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

## Game Modes

### Local Play (Hotseat)

All 3 players share one screen, taking turns on the same device.

### Online Multiplayer

Play with friends over the internet using WebRTC peer-to-peer connections.

**Hosting a game:**

1. Click **Host Game** from the main menu
2. A 6-character room code will appear — share this with your friends
3. Pick your elemental (Earth, Water, or Fire)
4. Once all 3 players have joined and picked their elementals, click **Start Game**

**Joining a game:**

1. Click **Join Game** from the main menu
2. Enter the 6-character room code from the host
3. Pick your elemental from the remaining options
4. Wait for the host to start the game

The host's browser acts as the game authority. Game state is synced to all players after each turn via WebRTC data channels.

## Tech Stack

- **TypeScript** — No framework, vanilla DOM manipulation
- **Vite** — Dev server and build tool
- **Three.js** — 3D meeple and token models (GLB) rendered via WebGL overlay
- **SVG** — Hex grid rendering with CSS 3D perspective transforms
- **CSS** — Animations, theming per element, responsive layout
- **WebRTC** — Peer-to-peer multiplayer with data channels
- **Cloudflare Workers** — Signaling server with Durable Objects for room management

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
│   ├── MainMenu.ts             # Main menu, lobby UI, elemental picker
│   ├── BoardRenderer.ts        # SVG hex board rendering
│   ├── HexInteraction.ts       # Click handling, action flows, targeting
│   ├── GameDialog.ts           # Modal dialogs (action choice, confirm, info)
│   ├── TopBar.ts               # Turn indicator and step instructions
│   ├── PlayerPanel.ts          # Left sidebar player info
│   └── GameLog.ts              # Game event log
├── network/
│   ├── types.ts                # Network message types
│   ├── SignalingClient.ts      # WebSocket client for signaling server
│   ├── PeerConnection.ts       # WebRTC peer connection wrapper
│   └── NetworkController.ts    # Multiplayer orchestrator (host/guest)
├── assets/
│   └── styles.css              # All styles
signaling-worker/               # Cloudflare Worker signaling server
├── src/index.ts                # Worker + GameRoom Durable Object
├── wrangler.toml               # Worker config
└── package.json                # Worker dependencies
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

## Deploying the Signaling Server

The multiplayer signaling server runs on Cloudflare Workers (free tier).

```bash
cd signaling-worker
bun install
bunx wrangler login      # authenticate with Cloudflare (first time only)
bunx wrangler deploy     # deploy to workers.dev
```

After deploying, update `DEFAULT_SIGNALING_URL` in `src/main.ts` with your worker URL.

You can also override the signaling server URL at runtime with a query parameter:
```
http://localhost:5173?server=wss://your-worker.workers.dev
```
