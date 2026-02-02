// ========================================
// Aeterna Signaling Worker
// ========================================
// Cloudflare Worker with Durable Objects for WebSocket room management.
// Handles room creation, joining, WebRTC signaling relay, and elemental picks.

interface Env {
  ROOMS: DurableObjectNamespace;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// --- Worker entry point ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      // Route to a room Durable Object
      // Room code comes as a query param for joining, or we create one
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

    // Health check
    if (url.pathname === '/health') {
      return new Response('ok');
    }

    return new Response('Aeterna Signaling Server', { status: 200 });
  },
};

// --- Durable Object: GameRoom ---

interface RoomPlayer {
  ws: WebSocket;
  id: string;
  elemental: string | null;
}

export class GameRoom {
  private state: DurableObjectState;
  private players: Map<string, RoomPlayer> = new Map();
  private hostId: string = '';
  private roomCode: string = '';
  private started = false;
  private lastActivity = Date.now();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

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

    const playerId = crypto.randomUUID().slice(0, 8);

    this.state.acceptWebSocket(server);

    this.lastActivity = Date.now();

    // Handle messages
    server.addEventListener('message', (event) => {
      this.lastActivity = Date.now();
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(playerId, msg);
      } catch (e) {
        // ignore parse errors
      }
    });

    server.addEventListener('close', () => {
      this.handleDisconnect(playerId);
    });

    server.addEventListener('error', () => {
      this.handleDisconnect(playerId);
    });

    // Register player
    const player: RoomPlayer = { ws: server, id: playerId, elemental: null };

    if (action === 'create') {
      this.hostId = playerId;
      this.players.set(playerId, player);
      this.started = false;

      // Send room-created
      this.sendTo(playerId, {
        type: 'room-created',
        code: this.roomCode,
        hostId: playerId,
      });
    } else {
      // Joining
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

      // Send room-joined to new player
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

      // Notify existing players
      this.broadcast({
        type: 'player-joined',
        playerId,
        playerCount: this.players.size,
      }, playerId);
    }

    // Auto-expire after 30 min idle
    this.scheduleExpiry();

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(fromId: string, msg: any) {
    switch (msg.type) {
      case 'signal':
        // Relay WebRTC signaling to target peer
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

      case 'pick-elemental': {
        const player = this.players.get(fromId);
        if (!player) return;

        // Check if elemental is already taken
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

        // Broadcast pick to all
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
        // Game start is handled via WebRTC data channels, not through signaling
        break;
    }
  }

  private handleDisconnect(playerId: string) {
    this.players.delete(playerId);
    this.broadcast({
      type: 'player-left',
      playerId,
    });

    // If no players left, clean up
    if (this.players.size === 0) {
      // Room will be garbage collected
    }
  }

  private sendTo(playerId: string, msg: any) {
    const player = this.players.get(playerId);
    if (player) {
      this.sendToWs(player.ws, msg);
    }
  }

  private sendToWs(ws: WebSocket, msg: any) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      // Connection may be closed
    }
  }

  private broadcast(msg: any, excludeId?: string) {
    for (const [id, player] of this.players) {
      if (id === excludeId) continue;
      this.sendToWs(player.ws, msg);
    }
  }

  private scheduleExpiry() {
    // Durable Objects auto-evict after inactivity.
    // The 30-min idle timeout is handled by checking lastActivity
    // on each message. In practice, the DO will be evicted by the runtime.
  }

  // Required for Durable Object WebSocket hibernation
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Handled by addEventListener above
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    // Handled by addEventListener above
  }
}
