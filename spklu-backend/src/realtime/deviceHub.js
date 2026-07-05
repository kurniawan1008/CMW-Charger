// WS /ws/device — gateway Pi (atau simulator) per mesin.
// Gateway = translator tipis: backend mengirim baris perintah '$...' mentah,
// gateway meneruskan ke serial; setiap baris '#...' dari firmware dikirim balik.
//
// Pesan gateway->backend : {type:'hello',deviceKey,fw?} | {type:'line',line:'#...'}
// Pesan backend->gateway : {type:'hello_ok',deviceId} | {type:'cmd',line:'$...'}
//
// Command queue per device: SATU perintah outstanding; balasan #OK/#ERR/#PONG/#MODE
// dikorelasikan berurutan; timeout 5 s. #STATE/#EVT adalah stream async (bukan
// balasan) KECUALI sedang menunggu $STATUS.
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'node:events';
import { query } from '../db.js';
import { chStateToStatus } from '../services/commands.js';

export const deviceEvents = new EventEmitter(); // 'event' (dev, evt) | 'state' (dev, state)

// maxPayload kecil: baris serial firmware < 1 KB; payload raksasa = DoS (audit M4).
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const devices = new Map(); // deviceId -> conn

const CMD_TIMEOUT_MS = 5000;

class DeviceConn {
  constructor(ws, row) {
    this.ws = ws;
    this.isAlive = true;
    this.id = row.id;
    this.name = row.name;
    this.stationId = row.station_id;
    this.mode = row.mode; // ONLINE | OFFLINE (diperbarui dari #MODE / #STATE auth flow)
    this.queue = [];      // { line, resolve, reject, timer, isStatus }
    this.current = null;
    this.lastState = null;
  }

  send(line) {
    return new Promise((resolve, reject) => {
      const item = { line, resolve, reject, timer: null, isStatus: line === '$STATUS' };
      this.queue.push(item);
      this.#pump();
    });
  }

  #pump() {
    if (this.current || !this.queue.length) return;
    if (this.ws.readyState !== this.ws.OPEN) {
      for (const it of this.queue.splice(0)) it.reject(new Error('device_offline'));
      return;
    }
    this.current = this.queue.shift();
    this.ws.send(JSON.stringify({ type: 'cmd', line: this.current.line }));
    this.current.timer = setTimeout(() => {
      const cur = this.current;
      this.current = null;
      cur?.reject(new Error(`timeout menunggu balasan: ${cur.line}`));
      this.#pump();
    }, CMD_TIMEOUT_MS);
  }

  #settle(reply) {
    const cur = this.current;
    if (!cur) return false;
    clearTimeout(cur.timer);
    this.current = null;
    if (reply.startsWith('#ERR')) cur.reject(new Error(reply));
    else cur.resolve(reply);
    this.#pump();
    return true;
  }

  async handleLine(line) {
    if (line.startsWith('#STATE ')) {
      let state;
      try { state = JSON.parse(line.slice(7)); } catch { return; }
      this.lastState = state;
      if (this.current?.isStatus) this.#settle(line);
      await syncChannels(this, state);
      deviceEvents.emit('state', this, state);
      return;
    }
    if (line.startsWith('#EVT ')) {
      let evt;
      try { evt = JSON.parse(line.slice(5)); } catch { return; }
      deviceEvents.emit('event', this, evt);
      return;
    }
    if (line.startsWith('#MODE ')) {
      const mode = line.includes('ONLINE') ? 'ONLINE' : 'OFFLINE';
      this.mode = mode;
      await query('UPDATE devices SET mode = ? WHERE id = ?', [mode, this.id]);
      this.#settle(line);
      return;
    }
    if (/^#(OK|ERR|PONG)/.test(line)) this.#settle(line);
  }
}

// Sinkron status channel DB dari telemetry (kecuali channel maintenance).
async function syncChannels(dev, state) {
  if (!Array.isArray(state.ch)) return;
  for (const c of state.ch) {
    if (!c || !Number.isInteger(c.ch)) continue;
    await query(
      `UPDATE channels SET status = ?
       WHERE device_id = ? AND device_ch = ? AND maintenance = 0`,
      [chStateToStatus(c.st), dev.id, c.ch],
    );
  }
  await query('UPDATE devices SET last_seen_at = NOW() WHERE id = ?', [dev.id]);
}

async function markOffline(deviceId) {
  await query('UPDATE devices SET online = 0 WHERE id = ?', [deviceId]);
  await query(
    "UPDATE channels SET status = 'OFFLINE' WHERE device_id = ? AND maintenance = 0",
    [deviceId],
  );
}

export function handleDeviceUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    let conn = null;
    const helloTimer = setTimeout(() => { if (!conn) ws.close(4001, 'hello timeout'); }, 5000);

    ws.on('message', async (raw) => {
      // Seluruh handler dibungkus try/catch: error DB pada satu pesan telemetry
      // TIDAK boleh menjadi unhandled rejection yang mematikan proses (audit C2).
      try {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'hello' && !conn) {
        const key = String(msg.deviceKey || '');
        // Tolak key placeholder dari seed — wajib diganti sebelum produksi (audit H3).
        if (!key || key.startsWith('CHANGE_ME')) { ws.close(4003, 'device_key placeholder'); return; }
        const rows = await query('SELECT * FROM devices WHERE device_key = ?', [key]);
        if (!rows.length) { ws.close(4003, 'device_key tidak dikenal'); return; }
        clearTimeout(helloTimer);
        const old = devices.get(rows[0].id);
        if (old) old.ws.close(4000, 'digantikan koneksi baru');
        conn = new DeviceConn(ws, rows[0]);
        devices.set(conn.id, conn);
        await query('UPDATE devices SET online = 1, last_seen_at = NOW(), fw_info = ? WHERE id = ?', [
          msg.fw || null, conn.id,
        ]);
        ws.send(JSON.stringify({ type: 'hello_ok', deviceId: conn.id }));
        // Ambil mode & snapshot awal (tanpa menggantung koneksi bila gagal).
        conn.send('$GETMODE').catch(() => {});
        conn.send('$STATUS').catch(() => {});
        deviceEvents.emit('online', conn);
        return;
      }
      if (msg.type === 'line' && conn && typeof msg.line === 'string') {
        await conn.handleLine(msg.line.trim());
      }
      } catch (err) {
        console.error('[deviceHub] gagal memproses pesan device:', err.message);
      }
    });

    ws.on('pong', () => { if (conn) conn.isAlive = true; });

    ws.on('close', async () => {
      clearTimeout(helloTimer);
      if (conn && devices.get(conn.id) === conn) {
        devices.delete(conn.id);
        await markOffline(conn.id).catch(() => {});
        deviceEvents.emit('offline', conn);
      }
    });
  });
}

export const getDevice = (deviceId) => devices.get(deviceId) || null;
export const isDeviceOnline = (deviceId) => devices.has(deviceId);

// Heartbeat (audit M1): Pi yang mati listrik tanpa TCP FIN akan tampak "online"
// berjam-jam. Ping tiap 30 s; dua kali tanpa pong -> terminate -> markOffline.
export function startDeviceHeartbeat() {
  setInterval(() => {
    for (const conn of devices.values()) {
      if (conn.isAlive === false) { conn.ws.terminate(); continue; }
      conn.isAlive = false;
      try { conn.ws.ping(); } catch { /* socket sudah mati */ }
    }
  }, 30_000).unref();
}

export async function sendToDevice(deviceId, line) {
  const dev = devices.get(deviceId);
  if (!dev) throw new Error('device_offline');
  return dev.send(line);
}
