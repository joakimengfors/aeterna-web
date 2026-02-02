// ========================================
// WebRTC Peer Connection
// ========================================

import { SignalingClient } from './SignalingClient';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
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
        this.onConnectedCallback?.();
      } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
        this._connected = false;
        this.onDisconnectedCallback?.();
      }
    };

    this.pc.ondatachannel = (e) => {
      this.setupChannel(e.channel);
    };
  }

  get connected(): boolean {
    return this._connected;
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

  private setupChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      this._connected = true;
      this.flushQueue();
      this.startKeepalive();
      this.onConnectedCallback?.();
    };
    channel.onclose = () => {
      this._connected = false;
      this.stopKeepalive();
      this.onDisconnectedCallback?.();
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
