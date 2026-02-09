// ========================================
// WebRTC Peer Connection
// ========================================

import { SignalingClient } from './SignalingClient';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

export class PeerConnection {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private messageHandlers: ((data: any) => void)[] = [];
  private onConnectedCallback: (() => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private _connected = false;
  private sendQueue: string[] = [];
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private signaling: SignalingClient,
    private localId: string,
    private remoteId: string,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.sendSignal(this.remoteId, this.localId, {
          type: 'ice-candidate',
          candidate: e.candidate,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'connected') {
        this._connected = true;
        this.clearDisconnectTimer();
        this.onConnectedCallback?.();
      } else if (this.pc.connectionState === 'failed') {
        this._connected = false;
        this.clearDisconnectTimer();
        this.onDisconnectedCallback?.();
      } else if (this.pc.connectionState === 'disconnected') {
        // 'disconnected' is transient — wait before treating as real disconnect
        this.startDisconnectTimer();
      }
    };

    this.pc.ondatachannel = (e) => {
      this.setupChannel(e.channel);
    };
  }

  get connected(): boolean {
    return this._connected;
  }

  get channelOpen(): boolean {
    return this.channel !== null && this.channel.readyState === 'open';
  }

  onConnected(cb: () => void) {
    this.onConnectedCallback = cb;
  }

  onDisconnected(cb: () => void) {
    this.onDisconnectedCallback = cb;
  }

  async createOffer(): Promise<void> {
    this.channel = this.pc.createDataChannel('game');
    this.setupChannel(this.channel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.signaling.sendSignal(this.remoteId, this.localId, {
      type: 'offer',
      sdp: offer,
    });
  }

  async handleSignal(data: any): Promise<void> {
    if (data.type === 'offer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signaling.sendSignal(this.remoteId, this.localId, {
        type: 'answer',
        sdp: answer,
      });
    } else if (data.type === 'answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'ice-candidate') {
      await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }

  onMessage(handler: (data: any) => void) {
    this.messageHandlers.push(handler);
  }

  send(data: any) {
    const msg = JSON.stringify(data);
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(msg);
    } else {
      this.sendQueue.push(msg);
    }
  }

  private flushQueue() {
    if (!this.channel || this.channel.readyState !== 'open') return;
    for (const msg of this.sendQueue) {
      this.channel.send(msg);
    }
    this.sendQueue = [];
  }

  close() {
    this.stopKeepalive();
    this.clearDisconnectTimer();
    this.channel?.close();
    this.pc.close();
    this._connected = false;
    this.messageHandlers = [];
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.channel && this.channel.readyState === 'open') {
        this.channel.send(JSON.stringify({ type: '__ping' }));
      }
    }, 5000);
  }

  private stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private startDisconnectTimer() {
    if (this.disconnectTimer) return;
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;
      // If still not connected after grace period, treat as real disconnect
      if (this.pc.connectionState !== 'connected') {
        this._connected = false;
        this.onDisconnectedCallback?.();
      }
    }, 4000);
  }

  private clearDisconnectTimer() {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  private setupChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      this._connected = true;
      this.flushQueue();
      this.startKeepalive();
      this.onConnectedCallback?.();
    };
    channel.onclose = () => {
      this.stopKeepalive();
      if (this._connected) {
        this._connected = false;
        this.onDisconnectedCallback?.();
      }
    };
    channel.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === '__ping') return;
        for (const handler of this.messageHandlers) {
          handler(data);
        }
      } catch (err) {
        console.error('Failed to parse peer message:', err);
      }
    };
  }
}
