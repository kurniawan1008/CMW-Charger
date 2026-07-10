// Orkestrasi sesi charging: start (klaim channel atomik + reserve saldo +
// $SELECT/$AUTH/$START), stop manual, finalisasi dari #EVT firmware (terikat
// device pengirim), sesi TRIAL, relay telemetry, dan reconciler sesi yatim.
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
    `SELECT c.*, d.id AS dev_id FROM channels c
     LEFT JOIN devices d ON d.id = c.device_id WHERE c.id = ?`,
    [channelId],
  );
  if (!channel) throw new ApiError(404, 'Channel tidak ditemukan');
  if (!channel.dev_id || !getDevice(channel.dev_id)) throw new ApiError(409, 'Mesin sedang offline');
  if (getDevice(channel.dev_id).mode !== 'ONLINE') {
    throw new ApiError(409, 'Mesin dalam mode OFFLINE (trial) — tidak menerima sesi berbayar');
  }

  const [profile] = await query(
    'SELECT * FROM motor_profiles WHERE id = ? AND is_active = 1', [motorProfileId],
  );
  if (!profile) throw new ApiError(404, 'Profil motor tidak ditemukan / nonaktif');

  const sid = generateSessionId();

  // KLAIM CHANNEL ATOMIK (audit C1): dua request bersamaan tidak boleh sama-sama
  // lolos — hanya satu yang berhasil mengubah READY -> CHARGING. Klaim terjadi
  // SEBELUM debit saldo dan sebelum perintah apa pun dikirim ke mesin.
  const claim = await query(
    `UPDATE channels SET status='CHARGING', current_user_id=?, current_session_id=?
     WHERE id=? AND status='READY' AND maintenance=0`,
    [userId, sid, channelId],
  );
  if (!claim.affectedRows) throw new ApiError(409, 'Channel sedang dipakai / tidak tersedia');

  const releaseClaim = () =>
    query(
      `UPDATE channels SET status='READY', current_user_id=NULL, current_session_id=NULL
       WHERE id=? AND current_session_id=?`,
      [channelId, sid],
    ).catch(() => {});

  // Reservasi saldo + insert sesi — atomic. SELECT FOR UPDATE cegah saldo balapan.
  try {
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
  } catch (err) {
    await releaseClaim();
    throw err;
  }

  // Kirim rangkaian perintah. Bila gagal, JANGAN langsung refund (audit H1):
  // #OK bisa hilang padahal firmware sudah mengisi. Verifikasi dulu via $STATUS.
  const ch = channel.device_ch;
  try {
    const st = getDevice(channel.dev_id)?.lastState?.ch?.find((x) => x.ch === ch)?.st;
    if (st === CH_STATE.DONE) await sendToDevice(channel.dev_id, buildClear(ch));

    await sendToDevice(channel.dev_id, buildSelect(ch, profile.fw_slot, `${profile.brand} ${profile.model}`));
    await sendToDevice(channel.dev_id, buildAuth(ch, sid, limitType, limitValue));
    await sendToDevice(channel.dev_id, buildStart(ch));
  } catch (err) {
    const live = await isSessionLiveOnDevice(channel.dev_id, ch, sid);
    if (live === false) {
      // Terbukti tidak mengisi -> aman dibatalkan penuh.
      await sendToDevice(channel.dev_id, buildStop(ch)).catch(() => {});
      await sendToDevice(channel.dev_id, buildDeauth(ch)).catch(() => {});
      await releaseClaim();
      await cancelWithFullRefund(sid, userId, reserveRp, `Gagal memulai: ${err.message}`);
      throw new ApiError(502, `Mesin menolak perintah: ${err.message}`);
    }
    // live === true (balasan hilang tapi firmware mengisi) atau null (mesin tidak
    // bisa diverifikasi): biarkan sesi ACTIVE — event firmware / reconciler yang
    // akan menyelesaikan billing dengan konsumsi sebenarnya. Tanpa ini, user bisa
    // dapat listrik gratis (refund penuh padahal mengisi).
  }

  return { sessionId: sid, reservedRp: reserveRp, pricePerKwh: price };
}

// Verifikasi via $STATUS apakah sid benar-benar hidup di channel mesin.
// true = mengisi dengan sid ini; false = pasti tidak; null = tidak bisa dipastikan.
async function isSessionLiveOnDevice(deviceId, ch, sid) {
  try {
    await sendToDevice(deviceId, '$STATUS');
    const entry = getDevice(deviceId)?.lastState?.ch?.find((x) => x.ch === ch);
    if (!entry) return null;
    return (entry.sid || '') === sid && (entry.st === CH_STATE.CHARGING || entry.auth === 1);
  } catch {
    return null;
  }
}

async function cancelWithFullRefund(sid, userId, amount, reason) {
  await withTx(async (conn) => {
    const [res] = await conn.query(
      "UPDATE sessions SET status='STOPPED', end_reason='start_failed', end_time=NOW(), total_cost=0 WHERE id=? AND status='ACTIVE'",
      [sid],
    );
    if (!res.affectedRows) return; // sudah difinalisasi jalur lain
    await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
    await conn.query(
      `INSERT INTO transaction_logs (user_id, amount, type, session_id, description)
       VALUES (?,?,?,?,?)`,
      [userId, amount, 'REFUND', sid, reason],
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

// ============ Sesi aktif user (pemulihan UI setelah refresh) ============
export async function getActiveSession(userId) {
  const [sess] = await query(
    `SELECT s.id, s.start_mode, s.target_kwh, s.target_rp, s.consumed_kwh, s.start_time,
            c.id AS channel_id, c.device_ch, st.name AS station_name,
            mp.brand, mp.model
     FROM sessions s
     JOIN channels c ON c.id = s.channel_id
     LEFT JOIN stations st ON st.id = c.station_id
     LEFT JOIN motor_profiles mp ON mp.id = s.motor_profile_id
     WHERE s.user_id = ? AND s.status = 'ACTIVE' AND s.billing_type='PAYMENT'
     ORDER BY s.start_time DESC LIMIT 1`,
    [userId],
  );
  return sess || null;
}

// ============ Finalisasi dari event firmware ============
const FINAL_EVENTS = new Set(['session_complete', 'session_stop', 'cable_unplug']);

async function finalizePayment(sess, evt, endReason) {
  const price = await getPricePerKwh();
  // Bila kwh event hilang/rusak, pakai konsumsi terakhir dari telemetry (audit M6)
  // — jangan refund penuh untuk energi yang nyata-nyata terpakai.
  const rawKwh = Number(evt.kwh);
  const kwh = Number.isFinite(rawKwh) && rawKwh > 0 ? rawKwh : Number(sess.consumed_kwh) || 0;
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
      "UPDATE channels SET status='READY', current_user_id=NULL, current_session_id=NULL WHERE current_session_id=?",
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
  // Hanya mesin mode OFFLINE yang sah membuat sesi trial (audit L3).
  if (dev.mode !== 'OFFLINE') return;
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
        // Binding device→sesi (audit keamanan C2): event hanya sah bila sesi
        // memang berjalan di channel milik device pengirim. Tanpa ini, satu
        // device_key bocor bisa memalsukan billing sesi mesin lain.
        const [sess] = await query(
          `SELECT s.*, c.device_id, c.device_ch FROM sessions s
           JOIN channels c ON c.id = s.channel_id
           WHERE s.id = ? AND s.billing_type='PAYMENT'`, [sid],
        );
        if (!sess || sess.status !== 'ACTIVE') return;
        if (sess.device_id !== dev.id || Number(sess.device_ch) !== Number(evt.ch)) {
          console.warn(`[sessionService] event ditolak: sid ${sid} bukan milik device ${dev.id} ch ${evt.ch}`);
          return;
        }
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
    try {
      if (!Array.isArray(state.ch)) return;
      const price = await getPricePerKwh();
      for (const c of state.ch) {
        const sid = (c.sid || '').trim();
        if (!sid || c.st !== CH_STATE.CHARGING) continue;
        const kwh = Number(c.kwh) || 0;
        // Update di-scope ke channel milik device ini (binding, audit C2);
        // publish tick hanya bila update mengenai baris yang sah.
        const res = await query(
          `UPDATE sessions s JOIN channels ch ON ch.id = s.channel_id
           SET s.consumed_kwh=?
           WHERE s.id=? AND s.status='ACTIVE' AND ch.device_id=? AND ch.device_ch=?`,
          [kwh, sid, dev.id, c.ch],
        );
        if (!res.affectedRows) continue;
        publish(`session.${sid}`, {
          energy: kwh,
          voltage: Number(c.v) || 0,
          current: Number(c.i) || 0,
          power: Number(c.p) || 0,
          cost: costFromKwh(kwh, price),
          elapsed: Number(c.sec) || 0,
          status: 'CHARGING',
        });
      }
    } catch (err) {
      console.error('[sessionService] gagal memproses telemetry:', err.message);
    }
  });
}

// ============ Reconciler sesi yatim (audit C3) ============
// Mesin mati listrik / backend restart di tengah sesi -> #EVT final tidak pernah
// datang -> tanpa sweep ini reservasi user terkunci selamanya.
const RECONCILE_INTERVAL_MS = 60_000;
const MIN_SESSION_AGE_SQL = 'INTERVAL 2 MINUTE';   // beri waktu sesi baru muncul di telemetry
const DEVICE_DEAD_AFTER_SQL = 'INTERVAL 3 MINUTE'; // device offline selama ini = sesi yatim

export function startReconciler() {
  setInterval(async () => {
    try {
      const rows = await query(
        `SELECT s.*, c.device_id, c.device_ch, d.last_seen_at
         FROM sessions s
         JOIN channels c ON c.id = s.channel_id
         LEFT JOIN devices d ON d.id = c.device_id
         WHERE s.status='ACTIVE' AND s.billing_type='PAYMENT'
           AND s.start_time < DATE_SUB(NOW(), ${MIN_SESSION_AGE_SQL})`,
      );
      for (const sess of rows) {
        const dev = getDevice(sess.device_id);
        let orphaned = false;
        if (dev && dev.lastState) {
          const entry = dev.lastState.ch?.find((x) => Number(x.ch) === Number(sess.device_ch));
          orphaned = !entry || (entry.sid || '') !== sess.id;
        } else if (!dev) {
          const [row] = await query(
            `SELECT 1 AS dead FROM devices WHERE id=? AND (last_seen_at IS NULL OR last_seen_at < DATE_SUB(NOW(), ${DEVICE_DEAD_AFTER_SQL}))`,
            [sess.device_id],
          );
          orphaned = Boolean(row);
        }
        if (!orphaned) continue;
        console.warn(`[reconciler] menutup sesi yatim ${sess.id} (konsumsi ${sess.consumed_kwh} kWh)`);
        await finalizePayment(
          sess,
          { kwh: Number(sess.consumed_kwh) || 0, sec: 0 },
          'reconciled',
        );
      }
    } catch (err) {
      console.error('[reconciler] sweep gagal:', err.message);
    }
  }, RECONCILE_INTERVAL_MS).unref();
}

export { ApiError };
