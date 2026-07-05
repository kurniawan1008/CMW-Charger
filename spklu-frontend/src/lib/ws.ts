// Koneksi WS klien tunggal: subscribe topik (session.{sid}, notifikasi user/admin).
// Perbaikan audit C1/M1/H2: resubscribe setelah reconnect, guard socket basi,
// backoff eksponensial, dan berhenti retry saat auth ditolak.
import { useEffect, useRef } from 'react';
import { api, tokenStore } from './api';

type Handler = (data: unknown) => void;

class ClientSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retryMs = 2000;
  private stopped = false;

  private ensure() {
    if (this.stopped) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const token = tokenStore.get();
    if (!token) return;

    const ws = new WebSocket(api.wsUrl(token));
    this.ws = ws;

    ws.onopen = () => {
      this.retryMs = 2000;
      // Resubscribe SEMUA topik aktif — tanpa ini, satu kedipan WiFi saat
      // charging mematikan telemetry & event refund secara permanen.
      for (const topic of this.handlers.keys()) {
        ws.send(JSON.stringify({ type: 'subscribe', topic }));
      }
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'event') {
          this.handlers.get(msg.topic)?.forEach((h) => h(msg.data));
        }
      } catch { /* abaikan frame tak dikenal */ }
    };
    ws.onclose = (e) => {
      // Guard socket basi: onclose milik socket lama tidak boleh me-null socket baru.
      if (this.ws === ws) this.ws = null;
      if (e.code === 4001 || e.code === 1008) { this.stopped = true; return; } // auth ditolak
      if (this.handlers.size && !this.stopped) {
        setTimeout(() => this.ensure(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 30_000);
      }
    };
  }

  /** Dipanggil setelah login/logout agar koneksi mengikuti token terbaru. */
  reset() {
    this.stopped = false;
    this.retryMs = 2000;
    this.ws?.close();
    this.ws = null;
    if (this.handlers.size) this.ensure();
  }

  subscribe(topic: string, handler: Handler) {
    const first = !this.handlers.has(topic);
    if (first) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.ensure();
    // Satu frame subscribe per TOPIK, bukan per handler.
    if (first && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', topic }));
    }

    return () => {
      const set = this.handlers.get(topic);
      set?.delete(handler);
      if (set && !set.size) {
        this.handlers.delete(topic);
        if (this.ws?.readyState === WebSocket.OPEN && topic.startsWith('session.')) {
          this.ws.send(JSON.stringify({ type: 'unsubscribe', topic }));
        }
      }
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
