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
- Networking lives in `src/network/` (WebRTC + signaling)
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
- Host browser is the game authority (full state sync after each turn)
- Signaling server only relays WebRTC offers/answers/ICE + lobby state
- Deploy signaling: `cd signaling-worker && npm install && npx wrangler deploy`
- Override signaling URL: `?server=wss://your-worker.workers.dev`
