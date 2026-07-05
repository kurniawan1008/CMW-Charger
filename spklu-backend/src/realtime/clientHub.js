// WS /ws/client — browser: subscribe topik (session.{sid}, admin, user.{id})
// untuk live telemetry + notifikasi in-app. Auth via ?token=<JWT>.
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

const wss = new WebSocketServer({ noServer: true });
const sockets = new Set(); // { ws, user, topics:Set }

export function handleClientUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://x');
  let user;
  try {
    user = jwt.verify(url.searchParams.get('token') || '', config.jwtSecret);
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client = { ws, user, topics: new Set([`user.${user.id}`]) };
    if (user.role === 'ADMIN' || user.role === 'SUPERADMIN') client.topics.add('admin');
    sockets.add(client);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      // Hanya boleh subscribe topik sesi; topik lain ditetapkan server dari role.
      if (msg.type === 'subscribe' && /^session\.[A-Za-z0-9_-]+$/.test(msg.topic || '')) {
        client.topics.add(msg.topic);
      }
      if (msg.type === 'unsubscribe' && client.topics.has(msg.topic)) {
        if (msg.topic.startsWith('session.')) client.topics.delete(msg.topic);
      }
    });
    ws.on('close', () => sockets.delete(client));
    ws.send(JSON.stringify({ type: 'hello_ok' }));
  });
}

export function publish(topic, payload) {
  const msg = JSON.stringify({ type: 'event', topic, data: payload });
  for (const c of sockets) {
    if (c.topics.has(topic) && c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
  }
}

// Notifikasi in-app: persist ke DB + push realtime.
// userId null + audience ADMIN = broadcast semua admin.
export async function notify({ userId = null, audience = 'USER', type, title, body = null }) {
  await query(
    'INSERT INTO notifications (user_id, audience, type, title, body) VALUES (?,?,?,?,?)',
    [userId, audience, type, title, body],
  );
  const payload = { type, title, body, at: new Date().toISOString() };
  if (userId) publish(`user.${userId}`, { notification: payload });
  if (audience === 'ADMIN') publish('admin', { notification: payload });
}
