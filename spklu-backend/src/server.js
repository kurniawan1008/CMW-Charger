import http from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { handleDeviceUpgrade, startDeviceHeartbeat } from './realtime/deviceHub.js';
import { handleClientUpgrade, startClientHeartbeat } from './realtime/clientHub.js';
import { registerDeviceListeners, startReconciler } from './services/sessionService.js';
import { pool } from './db.js';

// Jangan biarkan rejection/exception liar mematikan proses (audit C2):
// satu cegukan MySQL di handler WS bukan alasan seluruh fleet putus.
process.on('unhandledRejection', (err) => console.error('[fatal-guard] unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('[fatal-guard] uncaughtException:', err));

const server = http.createServer(app);

// Dua endpoint WS di port yang sama: /ws/device (gateway Pi) & /ws/client (browser).
server.on('upgrade', (req, socket, head) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/ws/device') return handleDeviceUpgrade(req, socket, head);
    if (pathname === '/ws/client') return handleClientUpgrade(req, socket, head);
    socket.destroy();
  } catch {
    socket.destroy();
  }
});

registerDeviceListeners();

async function main() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    // Boot tanpa DB = semua request 500; lebih baik exit dan biarkan PM2 retry.
    console.error('[spklu-backend] DB tidak bisa dihubungi saat boot:', err.message);
    process.exit(1);
  }
  server.listen(config.port, () => {
    console.log(`[spklu-backend] listening :${config.port} — DB ok (${config.db.database})`);
  });
  startDeviceHeartbeat();
  startClientHeartbeat();
  startReconciler();
}

// Graceful shutdown: berhenti menerima koneksi, tutup pool, lalu keluar.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[spklu-backend] ${signal} — shutting down…`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main();
