import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { getAccessToken } from '../api/http';

export interface IPeer {
  userId: string;
  name: string;
  color: string;
}

export interface ICursor extends IPeer {
  x: number;
  y: number;
  lastSeen: number;
}

export type CardEvent =
  | { type: 'card.created'; card: any; by: string }
  | { type: 'card.updated'; card: any; by: string }
  | { type: 'card.deleted'; id: string; by: string };

export type WorkspaceBounce = 'kicked' | 'deleted';

type RealtimeEvent =
  | CardEvent
  | { type: 'cursor.move'; userId: string; name: string; color: string; x: number; y: number }
  | { type: 'presence.join'; userId: string; name: string; color: string }
  | { type: 'presence.leave'; userId: string }
  | { type: 'member.kicked'; userId: string }
  | { type: 'workspace.deleted' };

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private ws: WebSocket | null = null;
  private currentWorkspaceId: string | null = null;
  private reconnectDelay = 1000;

  readonly peers = signal<Map<string, IPeer>>(new Map());
  readonly cursors = signal<Map<string, ICursor>>(new Map());

  private cardListeners: Array<(ev: CardEvent) => void> = [];
  private workspaceEventListeners: Array<(t: WorkspaceBounce, userId?: string) => void> = [];

  onCardEvent(fn: (ev: CardEvent) => void): () => void {
    this.cardListeners.push(fn);
    return () => { this.cardListeners = this.cardListeners.filter((l) => l !== fn); };
  }

  onWorkspaceEvent(fn: (t: WorkspaceBounce, userId?: string) => void): () => void {
    this.workspaceEventListeners.push(fn);
    return () => { this.workspaceEventListeners = this.workspaceEventListeners.filter((l) => l !== fn); };
  }

  connect(workspaceId: string | null): void {
    if (this.currentWorkspaceId === workspaceId) return;
    this.disconnect();
    this.currentWorkspaceId = workspaceId;
    if (!workspaceId) return;
    this.openSocket(workspaceId);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.currentWorkspaceId = null;
    this.peers.set(new Map());
    this.cursors.set(new Map());
  }

  sendCursor(x: number, y: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'cursor.move', x, y }));
  }

  private openSocket(workspaceId: string): void {
    const base = environment.apiBase.replace(/^http/, 'ws');
    const token = getAccessToken();
    const tokenQS = token ? `&token=${encodeURIComponent(token)}` : '';
    const url = `${base}/ws?workspace_id=${encodeURIComponent(workspaceId)}${tokenQS}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => { this.reconnectDelay = 1000; };

    ws.onmessage = (ev) => {
      let msg: RealtimeEvent;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handle(msg);
    };

    ws.onclose = () => {
      if (this.currentWorkspaceId === workspaceId && this.ws === ws) {
        setTimeout(() => {
          if (this.currentWorkspaceId === workspaceId) this.openSocket(workspaceId);
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
      }
    };

    ws.onerror = () => { /* onclose will handle cleanup */ };
  }

  private handle(msg: RealtimeEvent): void {
    switch (msg.type) {
      case 'presence.join':
        this.peers.update((m) => {
          const n = new Map(m);
          n.set(msg.userId, { userId: msg.userId, name: msg.name, color: msg.color });
          return n;
        });
        break;
      case 'presence.leave':
        this.peers.update((m) => { const n = new Map(m); n.delete(msg.userId); return n; });
        this.cursors.update((m) => { const n = new Map(m); n.delete(msg.userId); return n; });
        break;
      case 'cursor.move':
        this.cursors.update((m) => {
          const n = new Map(m);
          n.set(msg.userId, { ...msg, lastSeen: Date.now() });
          return n;
        });
        this.peers.update((m) => {
          if (m.has(msg.userId)) return m;
          const n = new Map(m);
          n.set(msg.userId, { userId: msg.userId, name: msg.name, color: msg.color });
          return n;
        });
        break;
      case 'card.created':
      case 'card.updated':
      case 'card.deleted':
        this.cardListeners.forEach((fn) => fn(msg));
        break;
      case 'member.kicked':
        this.workspaceEventListeners.forEach((fn) => fn('kicked', msg.userId));
        break;
      case 'workspace.deleted':
        this.workspaceEventListeners.forEach((fn) => fn('deleted'));
        break;
    }
  }
}
