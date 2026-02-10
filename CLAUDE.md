# Aeterna: Clash of Elements

## Running the project

```bash
bun run dev
```

This starts the Vite dev server at http://localhost:5173.

## Building

```bash
bun run build
bun run preview
```

## Key facts

- Vanilla TypeScript + Vite, no framework
- Three.js for 3D meeple models
- Game logic lives in `src/game/` (no DOM dependencies)
- UI/rendering lives in `src/ui/`
- Networking lives in `src/network/` (WebRTC with signaling relay fallback)
- Signaling server: `signaling-worker/` (Cloudflare Worker + Durable Objects)
- Entry point: `src/main.ts`
- All styles: `src/assets/styles.css` + inline in `index.html`
- Assets (images): `public/assets/`

## Deployment

- **Live site**: https://aeterna-541.pages.dev/ (Cloudflare Pages)
- **Signaling server**: https://aeterna-signaling.joakim-engfors.workers.dev (Cloudflare Worker)
- Build & deploy: `bun run build && bun x wrangler@3 pages deploy dist --project-name aeterna --branch main --commit-dirty=true`
- Note: Use wrangler@3 for Pages deploy (v4 has a silent output bug)

## Multiplayer

- WebRTC peer-to-peer with Cloudflare Worker signaling
- **Signaling relay fallback**: if WebRTC can't connect (NAT/firewall), game data is automatically routed through the signaling WebSocket instead
- Host browser is the game authority (full state sync after each turn)
- Signaling server relays WebRTC offers/answers/ICE, lobby state, and game data (as fallback)
- Signaling WebSocket has a 30s keepalive ping to prevent idle timeout
- WebRTC `disconnected` state has a 4s grace period before triggering disconnect (transient blips are ignored)
- Game-start messages are deduplicated (sent via both WebRTC + signaling, only first is processed)
- `isMyTurn` guard in `applyRemoteState` prevents stale/duplicate remote updates from overwriting the active player's in-progress turn
- Network disconnect events use `console.warn` instead of modal dialogs to avoid overwriting active game dialogs
- Phase transitions (e.g. SOT skip → CHOOSE_ACTION) clean up all interaction state to prevent stale targets from interfering
- **Remote animation sync**: Turn animations (standee moves, fog token moves) are collected in `turnAnimations[]` during a turn, sent alongside state updates, and replayed on remote players' boards before applying the new state
- **Background tab safety**: `requestAnimationFrame` is paused in hidden tabs, which would block animation promises and prevent `finishTurn()`/`syncState()`. Three safeguards: (1) `BoardRenderer.animateStandee/animateTokenMove` skip immediately if `document.hidden`, (2) `animateWithTabSafety()` races animation promises against `visibilitychange` to unblock mid-animation tab switches, (3) `visibilitychange` listener refreshes board/panel/topbar (but NOT dialogs) when tab becomes visible
- **Rematch**: After game ends, players vote for rematch via `rematch-request` messages. Victory dialog shows vote count ("Rematch ✓ (2/3)"). When all players vote, host creates fresh GameState and broadcasts `rematch-start` to all peers. Game resets in-place without leaving the game screen.
- **Return to Lobby**: Any player can click "Return to Lobby" after game ends. Sends `return-to-lobby` via signaling server, which resets `started` flag and elemental picks, then broadcasts to all players. All clients transition back to the lobby screen with network connections preserved.
- Deploy signaling: `cd signaling-worker && bun install && bun x wrangler deploy`
- Override signaling URL: `?server=wss://your-worker.workers.dev`
