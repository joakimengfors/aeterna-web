// ========================================
// Aeterna Signaling Worker
// ========================================
// Cloudflare Worker with Durable Objects for WebSocket room management.
// Handles room creation, joining, WebRTC signaling relay, and elemental picks.

interface Env {
  ROOMS: DurableObjectNamespace;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    if (url.pathname === '/ws') {
      const code = url.searchParams.get('code');
      const action = url.searchParams.get('action') || 'join';

      let roomCode: string;
      if (action === 'create') {
        roomCode = generateRoomCode();
      } else if (code) {
        roomCode = code.toUpperCase();
      } else {
        return new Response('Missing room code', { status: 400 });
      }

      const roomId = env.ROOMS.idFromName(roomCode);
      const room = env.ROOMS.get(roomId);

      const newUrl = new URL(request.url);
      newUrl.searchParams.set('code', roomCode);
      newUrl.searchParams.set('action', action);

      return room.fetch(new Request(newUrl.toString(), request));
    }

    if (url.pathname === '/health') {
      return new Response('ok', {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response('Aeterna Signaling Server', {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  },
};

// --- Durable Object: GameRoom ---

interface RoomPlayer {
  ws: WebSocket;
  id: string;
  elemental: string | null;
}

export class GameRoom {
  private players: Map<string, RoomPlayer> = new Map();
  private hostId = '';
  private roomCode = '';
  private started = false;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'join';
    this.roomCode = url.searchParams.get('code') || '';

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    const playerId = crypto.randomUUID().slice(0, 8);

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(playerId, msg);
      } catch (e) {
        // ignore
      }
    });

    server.addEventListener('close', () => {
      this.handleDisconnect(playerId);
    });

    server.addEventListener('error', () => {
      this.handleDisconnect(playerId);
    });

    const player: RoomPlayer = { ws: server, id: playerId, elemental: null };

    if (action === 'create') {
      this.hostId = playerId;
      this.players.set(playerId, player);
      this.started = false;

      this.sendTo(playerId, {
        type: 'room-created',
        code: this.roomCode,
        hostId: playerId,
      });
    } else {
      if (this.players.size >= 3) {
        this.sendToWs(server, { type: 'error', message: 'Room is full' });
        server.close(1000, 'Room full');
        return new Response(null, { status: 101, webSocket: client });
      }

      if (this.started) {
        this.sendToWs(server, { type: 'error', message: 'Game already started' });
        server.close(1000, 'Game started');
        return new Response(null, { status: 101, webSocket: client });
      }

      this.players.set(playerId, player);

      const existingPlayers = Array.from(this.players.values()).map(p => ({
        id: p.id,
        elemental: p.elemental,
      }));

      this.sendTo(playerId, {
        type: 'room-joined',
        hostId: this.hostId,
        playerId,
        players: existingPlayers,
      });

      this.broadcast({
        type: 'player-joined',
        playerId,
        playerCount: this.players.size,
      }, playerId);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(fromId: string, msg: any) {
    switch (msg.type) {
      case 'ping':
        // Keepalive — ignore
        break;

      case 'signal': {
        const target = this.players.get(msg.to);
        if (target) {
          this.sendToWs(target.ws, {
            type: 'signal',
            from: fromId,
            to: msg.to,
            data: msg.data,
          });
        }
        break;
      }

      case 'pick-elemental': {
        const player = this.players.get(fromId);
        if (!player) return;

        const taken = new Set(
          Array.from(this.players.values())
            .filter(p => p.id !== fromId && p.elemental)
            .map(p => p.elemental)
        );

        if (taken.has(msg.elemental)) {
          this.sendTo(fromId, { type: 'error', message: 'Elemental already taken' });
          return;
        }

        player.elemental = msg.elemental;

        this.broadcast({
          type: 'elemental-picked',
          playerId: fromId,
          elemental: msg.elemental,
        });
        break;
      }

      case 'start-game':
        if (fromId !== this.hostId) return;
        this.started = true;
        this.broadcast({
          type: 'start-game',
          state: msg.state,
          playerAssignments: msg.playerAssignments,
        }, fromId);
        break;

      case 'relay': {
        // Forward game data to a specific player via signaling (WebRTC fallback)
        const relayTarget = this.players.get(msg.to);
        if (relayTarget) {
          this.sendToWs(relayTarget.ws, {
            type: 'relay',
            from: fromId,
            data: msg.data,
          });
        }
        break;
      }
    }
  }

  private handleDisconnect(playerId: string) {
    this.players.delete(playerId);
    this.broadcast({ type: 'player-left', playerId });
  }

  private sendTo(playerId: string, msg: any) {
    const player = this.players.get(playerId);
    if (player) this.sendToWs(player.ws, msg);
  }

  private sendToWs(ws: WebSocket, msg: any) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      // Connection closed
    }
  }

  private broadcast(msg: any, excludeId?: string) {
    for (const [id, player] of this.players) {
      if (id === excludeId) continue;
      this.sendToWs(player.ws, msg);
    }
  }
}
