// Koneksi WS klien tunggal: subscribe topik (session.{sid}, notifikasi user/admin).
import { useEffect, useRef } from 'react';
import { api, tokenStore } from './api';

type Handler = (data: unknown) => void;

class ClientSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: string[] = [];

  private ensure() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const token = tokenStore.get();
    if (!token) return;
    this.ws = new WebSocket(api.wsUrl(token));
    this.ws.onopen = () => {
      for (const msg of this.queue.splice(0)) this.ws?.send(msg);
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'event') {
          this.handlers.get(msg.topic)?.forEach((h) => h(msg.data));
        }
      } catch { /* abaikan frame tak dikenal */ }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (this.handlers.size) setTimeout(() => this.ensure(), 2000);
    };
  }

  subscribe(topic: string, handler: Handler) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.ensure();
    const msg = JSON.stringify({ type: 'subscribe', topic });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(msg);
    else this.queue.push(msg);

    return () => {
      const set = this.handlers.get(topic);
      set?.delete(handler);
      if (set && !set.size) this.handlers.delete(topic);
    };
  }
}

export const clientSocket = new ClientSocket();

export function useTopic(topic: string | null, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!topic) return;
    return clientSocket.subscribe(topic, (d) => ref.current(d));
  }, [topic]);
}
