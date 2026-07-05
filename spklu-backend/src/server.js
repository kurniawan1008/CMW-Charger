import http from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { handleDeviceUpgrade } from './realtime/deviceHub.js';
import { handleClientUpgrade } from './realtime/clientHub.js';
import { registerDeviceListeners } from './services/sessionService.js';
import { pool } from './db.js';

const server = http.createServer(app);

// Dua endpoint WS di port yang sama: /ws/device (gateway Pi) & /ws/client (browser).
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/ws/device') return handleDeviceUpgrade(req, socket, head);
  if (pathname === '/ws/client') return handleClientUpgrade(req, socket, head);
  socket.destroy();
});

registerDeviceListeners();

server.listen(config.port, async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`[spklu-backend] listening :${config.port} — DB ok (${config.db.database})`);
  } catch (err) {
    console.error(`[spklu-backend] listening :${config.port} — DB GAGAL:`, err.message);
  }
});
