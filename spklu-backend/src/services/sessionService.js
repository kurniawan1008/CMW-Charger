// Orkestrasi sesi charging: start (reserve saldo + $SELECT/$AUTH/$START),
// stop manual, finalisasi dari #EVT firmware, sesi TRIAL mesin OFFLINE-mode,
// dan relay telemetry ke browser.
import { query, withTx, getPricePerKwh } from '../db.js';
import { generateSessionId } from './sessionId.js';
import {
  buildSelect, buildAuth, buildStart, buildStop, buildDeauth, buildClear, CH_STATE,
} from './commands.js';
import { reservationAmount, limitForMode, settleSession, costFromKwh } from './billing.js';
import { deviceEvents, sendToDevice, getDevice } from '../realtime/deviceHub.js';
import { publish, notify } from '../realtime/clientHub.js';

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ============ START (sesi berbayar) ============
export async function startSession({ userId, channelId, motorProfileId, mode, target }) {
  const price = await getPricePerKwh();
  let limitType, limitValue, reserveRp;
  try {
    ({ limitType, limitValue } = limitForMode(mode, target));
    reserveRp = reservationAmount(mode, target, price);
  } catch (err) {
    throw new ApiError(400, err.message); // input mode/target invalid = salah request
  }

  const [channel] = await query(
    `SELECT c.*, d.id AS dev_id, d.online AS dev_online, d.mode AS dev_mode
     FROM channels c LEFT JOIN devices d ON d.id = c.device_id WHERE c.id = ?`,
    [channelId],
  );
  if (!channel) throw new ApiError(404, 'Channel tidak ditemukan');
  if (channel.maintenance) throw new ApiError(409, 'Channel sedang maintenance');
  if (channel.status !== 'READY') throw new ApiError(409, `Channel tidak tersedia (${channel.status})`);
  if (!channel.dev_id || !getDevice(channel.dev_id)) throw new ApiError(409, 'Mesin sedang offline');
  if (getDevice(channel.dev_id).mode !== 'ONLINE') {
    throw new ApiError(409, 'Mesin dalam mode OFFLINE (trial) — tidak menerima sesi berbayar');
  }

  const [profile] = await query(
    'SELECT * FROM motor_profiles WHERE id = ? AND is_active = 1', [motorProfileId],
  );
  if (!profile) throw new ApiError(404, 'Profil motor tidak ditemukan / nonaktif');

  const sid = generateSessionId();

  // Reservasi saldo + insert sesi — atomic. SELECT FOR UPDATE cegah saldo balapan.
  await withTx(async (conn) => {
    const [[user]] = await conn.query(
      'SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId],
    );
    if (!user) throw new ApiError(404, 'User tidak ditemukan');
    if (Number(user.balance) < reserveRp) {
      throw new ApiError(402, `Saldo tidak cukup (butuh Rp ${reserveRp.toLocaleString('id-ID')})`);
    }
    await conn.query('UPDATE users SET balance = balance - ? WHERE id = ?', [reserveRp, userId]);
    await conn.query(
      `INSERT INTO sessions (id, user_id, billing_type, channel_id, motor_profile_id,
         start_mode, target_kwh, target_rp, status)
       VALUES (?,?,?,?,?,?,?,?, 'ACTIVE')`,
      [sid, userId, 'PAYMENT', channelId, motorProfileId,
        mode === 'kwh' ? 'KWH' : 'NOMINAL', mode === 'kwh' ? target : 0, reserveRp],
    );
    await conn.query(
      `INSERT INTO transaction_logs (user_id, amount, type, session_id, description)
       VALUES (?,?,?,?,?)`,
      [userId, -reserveRp, 'CHARGING_FEE', sid, `Reservasi sesi ${sid}`],
    );
  });

  // Kirim rangkaian perintah; gagal di titik mana pun -> rollback penuh.
  const ch = channel.device_ch;
  try {
    // Channel di state DONE butuh $CLEAR dulu agar kembali IDLE.
    const st = getDevice(channel.dev_id).lastState?.ch?.find((x) => x.ch === ch)?.st;
    if (st === CH_STATE.DONE) await sendToDevice(channel.dev_id, buildClear(ch));

    await sendToDevice(channel.dev_id, buildSelect(ch, profile.fw_slot));
    await sendToDevice(channel.dev_id, buildAuth(ch, sid, limitType, limitValue));
    await sendToDevice(channel.dev_id, buildStart(ch));
  } catch (err) {
    await sendToDevice(channel.dev_id, buildDeauth(ch)).catch(() => {});
    await cancelWithFullRefund(sid, userId, reserveRp, `Gagal memulai: ${err.message}`);
    throw new ApiError(502, `Mesin menolak perintah: ${err.message}`);
  }

  await query(
    "UPDATE channels SET status='CHARGING', current_user_id=?, current_session_id=? WHERE id=?",
    [userId, sid, channelId],
  );
  return { sessionId: sid, reservedRp: reserveRp, pricePerKwh: price };
}

async function cancelWithFullRefund(sid, userId, amount, reason) {
  await withTx(async (conn) => {
    await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
    await conn.query(
      `INSERT INTO transaction_logs (user_id, amount, type, session_id, description)
       VALUES (?,?,?,?,?)`,
      [userId, amount, 'REFUND', sid, reason],
    );
    await conn.query(
      "UPDATE sessions SET status='STOPPED', end_reason='start_failed', end_time=NOW(), total_cost=0 WHERE id=?",
      [sid],
    );
  });
}

// ============ STOP manual (user/admin) ============
export async function stopSession(sid, requesterId, { isAdmin = false } = {}) {
  const [sess] = await query(
    `SELECT s.*, c.device_id, c.device_ch FROM sessions s
     JOIN channels c ON c.id = s.channel_id WHERE s.id = ?`, [sid],
  );
  if (!sess) throw new ApiError(404, 'Sesi tidak ditemukan');
  if (!isAdmin && sess.user_id !== requesterId) throw new ApiError(403, 'Bukan sesi milik Anda');
  if (sess.status !== 'ACTIVE') throw new ApiError(409, 'Sesi sudah berakhir');
  await sendToDevice(sess.device_id, buildStop(sess.device_ch));
  // Finalisasi terjadi saat #EVT session_stop tiba (nilai kWh final dari firmware).
  return { ok: true };
}

// ============ Finalisasi dari event firmware ============
const FINAL_EVENTS = new Set(['session_complete', 'session_stop', 'cable_unplug']);

async function finalizePayment(sess, evt, endReason) {
  const price = await getPricePerKwh();
  const kwh = Number(evt.kwh) || 0;
  const { cost, refund } = settleSession(Number(sess.target_rp), kwh, price);
  const status =
    endReason === 'fault' ? 'FAULT' : endReason === 'target_reached' ? 'COMPLETED' : 'STOPPED';

  await withTx(async (conn) => {
    const [res] = await conn.query(
      `UPDATE sessions SET status=?, end_reason=?, consumed_kwh=?, total_cost=?, end_time=NOW()
       WHERE id=? AND status='ACTIVE'`,
      [status, endReason, kwh, cost, sess.id],
    );
    if (!res.affectedRows) return; // sudah difinalisasi (event ganda)
    if (refund > 0) {
      await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [refund, sess.user_id]);
      await conn.query(
        `INSERT INTO transaction_logs (user_id, amount, type, session_id, description)
         VALUES (?,?,?,?,?)`,
        [sess.user_id, refund, 'REFUND', sess.id, `Refund sisa reservasi sesi ${sess.id}`],
      );
    }
    await conn.query(
      "UPDATE channels SET current_user_id=NULL, current_session_id=NULL WHERE current_session_id=?",
      [sess.id],
    );
  });

  publish(`session.${sess.id}`, {
    final: true, status, endReason, kwh, cost, refund,
    durationSec: Number(evt.sec) || 0,
  });
  await notify({
    userId: sess.user_id, type: 'session_finished',
    title: status === 'FAULT' ? 'Sesi berhenti karena gangguan' : 'Sesi charging selesai',
    body: `${kwh.toFixed(3)} kWh · Rp ${cost.toLocaleString('id-ID')}`,
  });
}

// Sesi TRIAL: mesin mode OFFLINE, start dari HMI, sid kosong. Tetap dicatat
// (tanpa user/billing) untuk monitoring teknis.
async function handleTrialEvent(dev, evt) {
  const [channel] = await query(
    'SELECT id FROM channels WHERE device_id = ? AND device_ch = ?', [dev.id, evt.ch],
  );
  if (!channel) return;

  if (evt.ev === 'session_start') {
    const trialId = `TRIAL-${generateSessionId()}`.slice(0, 40);
    await query(
      `INSERT INTO sessions (id, user_id, billing_type, channel_id, start_mode, status)
       VALUES (?, NULL, 'TRIAL', ?, 'KWH', 'ACTIVE')`,
      [trialId, channel.id],
    );
    return;
  }
  if (FINAL_EVENTS.has(evt.ev) || evt.ev === 'fault') {
    await query(
      `UPDATE sessions SET status=?, end_reason=?, consumed_kwh=?, end_time=NOW()
       WHERE billing_type='TRIAL' AND channel_id=? AND status='ACTIVE'`,
      [evt.ev === 'fault' ? 'FAULT' : 'COMPLETED', evt.ev, Number(evt.kwh) || 0, channel.id],
    );
  }
}

// ============ Wiring event dari deviceHub ============
export function registerDeviceListeners() {
  deviceEvents.on('event', async (dev, evt) => {
    try {
      const sid = (evt.sid || '').trim();

      if (evt.ev === 'fault') {
        await notify({
          audience: 'ADMIN', type: 'machine_fault',
          title: `FAULT di ${dev.name} CH${evt.ch}`,
          body: `reason=${evt.reason || '?'} protect=${evt.pr ?? '?'}`,
        });
      }

      if (!sid) { await handleTrialEvent(dev, evt); return; }

      if (FINAL_EVENTS.has(evt.ev) || evt.ev === 'fault') {
        const [sess] = await query(
          "SELECT * FROM sessions WHERE id = ? AND billing_type='PAYMENT'", [sid],
        );
        if (!sess || sess.status !== 'ACTIVE') return;
        const endReason =
          evt.ev === 'session_complete' ? 'target_reached'
          : evt.ev === 'cable_unplug' ? 'cable_unplug'
          : evt.ev === 'fault' ? 'fault' : 'user_stop';
        await finalizePayment(sess, evt, endReason);
      }
    } catch (err) {
      console.error('[sessionService] gagal memproses event', evt, err);
    }
  });

  // Telemetry #STATE -> tick per sesi aktif + update consumed_kwh berkala.
  deviceEvents.on('state', async (dev, state) => {
    if (!Array.isArray(state.ch)) return;
    const price = await getPricePerKwh();
    for (const c of state.ch) {
      const sid = (c.sid || '').trim();
      if (!sid || c.st !== CH_STATE.CHARGING) continue;
      const kwh = Number(c.kwh) || 0;
      publish(`session.${sid}`, {
        energy: kwh,
        voltage: Number(c.v) || 0,
        current: Number(c.i) || 0,
        power: Number(c.p) || 0,
        cost: costFromKwh(kwh, price),
        elapsed: Number(c.sec) || 0,
        status: 'CHARGING',
      });
      query("UPDATE sessions SET consumed_kwh=? WHERE id=? AND status='ACTIVE'", [kwh, sid])
        .catch(() => {});
    }
  });
}

export { ApiError };
