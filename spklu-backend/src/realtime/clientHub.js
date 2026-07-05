// WS /ws/client — browser: subscribe topik (session.{sid}, admin, user.{id})
// untuk live telemetry + notifikasi in-app. Auth via ?token=<JWT>.
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
const sockets = new Set(); // { ws, user, topics:Set, isAlive }

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
    const client = { ws, user, topics: new Set([`user.${user.id}`]), isAlive: true };
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN';
    if (isAdmin) client.topics.add('admin');
    sockets.add(client);

    ws.on('message', async (raw) => {
      try {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'subscribe' && /^session\.[A-Za-z0-9_-]+$/.test(msg.topic || '')) {
          // Cek kepemilikan (audit H2/H3): user hanya boleh menyimak sesi miliknya
          // sendiri — telemetry & ringkasan billing bukan konsumsi publik.
          if (isAdmin) { client.topics.add(msg.topic); return; }
          const sid = msg.topic.slice('session.'.length);
          const [row] = await query('SELECT user_id FROM sessions WHERE id = ?', [sid]);
          if (row && row.user_id === user.id) client.topics.add(msg.topic);
        }
        if (msg.type === 'unsubscribe' && typeof msg.topic === 'string' && msg.topic.startsWith('session.')) {
          client.topics.delete(msg.topic);
        }
      } catch (err) {
        console.error('[clientHub] gagal memproses pesan klien:', err.message);
      }
    });

    ws.on('pong', () => { client.isAlive = true; });
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

export function startClientHeartbeat() {
  setInterval(() => {
    for (const c of sockets) {
      if (c.isAlive === false) { c.ws.terminate(); sockets.delete(c); continue; }
      c.isAlive = false;
      try { c.ws.ping(); } catch { /* socket sudah mati */ }
    }
  }, 30_000).unref();
}
