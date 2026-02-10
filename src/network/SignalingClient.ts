// ========================================
// Signaling Client (WebSocket to Worker)
// ========================================

import type { SignalingMessage } from './types';
import type { ElementalType } from '../game/types';

export class SignalingClient {
  private ws: WebSocket | null = null;
  private messageHandlers: ((msg: SignalingMessage) => void)[] = [];
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private serverUrl: string) {}

  private connectWs(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        this.startKeepalive();
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = () => {
        this.stopKeepalive();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage;
          for (const handler of this.messageHandlers) {
            handler(msg);
          }
        } catch (e) {
          console.error('Failed to parse signaling message:', e);
        }
      };
    });
  }

  /** Connect and create a new room */
  async createRoom(): Promise<void> {
    const url = `${this.serverUrl}/ws?action=create`;
    await this.connectWs(url);
  }

  /** Connect and join an existing room */
  async joinRoom(code: string): Promise<void> {
    const url = `${this.serverUrl}/ws?action=join&code=${encodeURIComponent(code)}`;
    await this.connectWs(url);
  }

  onMessage(handler: (msg: SignalingMessage) => void) {
    this.messageHandlers.push(handler);
  }

  send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendSignal(to: string, from: string, data: any) {
    this.send({ type: 'signal', to, from, data });
  }

  pickElemental(elemental: ElementalType | null) {
    this.send({ type: 'pick-elemental', elemental });
  }

  startGame(state?: any, playerAssignments?: Record<string, any>) {
    this.send({ type: 'start-game', state, playerAssignments });
  }

  /** Relay game data to a specific player via signaling (WebRTC fallback) */
  relay(toId: string, data: any) {
    this.send({ type: 'relay', to: toId, data });
  }

  /** Request return to lobby (resets server room state) */
  returnToLobby() {
    this.send({ type: 'return-to-lobby' });
  }

  close() {
    this.stopKeepalive();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers = [];
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
