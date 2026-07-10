import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, withTx } from '../db.js';
import { authRequired, requireAdmin, requireSuperadmin } from '../auth/jwt.js';
import { paginate } from './helpers.js';
import { notify } from '../realtime/clientHub.js';
import { isDeviceOnline, sendToDevice } from '../realtime/deviceHub.js';
import { buildGetParam, buildSetParam } from '../services/commands.js';
import { config } from '../config.js';

export const adminRouter = Router();
adminRouter.use(authRequired, requireAdmin);

// ===== Overview =====
adminRouter.get('/metrics/summary', async (req, res, next) => {
  try {
    const [[rev]] = [await query(
      `SELECT COALESCE(SUM(CASE WHEN type='CHARGING_FEE' THEN -amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN type='REFUND' THEN amount ELSE 0 END),0) AS revenue
       FROM transaction_logs`)];
    const [[topup]] = [await query(
      "SELECT COALESCE(SUM(amount),0) AS total FROM topup_requests WHERE status='APPROVED'")];
    const [[users]] = [await query("SELECT COUNT(*) AS n FROM users WHERE role='USER'")];
    const [[active]] = [await query("SELECT COUNT(*) AS n FROM sessions WHERE status='ACTIVE'")];
    const [[pending]] = [await query("SELECT COUNT(*) AS n FROM topup_requests WHERE status='PENDING'")];
    const [[mach]] = [await query(
      'SELECT COUNT(*) AS total, COALESCE(SUM(online),0) AS online FROM devices')];
    res.json({
      revenue: Number(rev.revenue),
      approvedTopup: Number(topup.total),
      registeredUsers: Number(users.n),
      activeSessions: Number(active.n),
      pendingTopups: Number(pending.n),
      machines: { total: Number(mach.total), online: Number(mach.online) },
    });
  } catch (err) { next(err); }
});

// Grafik pendapatan: harian/mingguan/bulanan + rentang custom + per lokasi.
adminRouter.get('/metrics/revenue', async (req, res, next) => {
  try {
    const { period = 'daily', from, to, location } = req.query;
    const fmt = period === 'monthly' ? '%Y-%m' : period === 'weekly' ? '%x-W%v' : '%Y-%m-%d';
    const params = [];
    let where = "tl.type IN ('CHARGING_FEE','REFUND')";
    if (from) { where += ' AND tl.created_at >= ?'; params.push(from); }
    if (to)   { where += ' AND tl.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; params.push(to); }
    if (location && location !== 'all') {
      where += ` AND tl.session_id IN (
        SELECT s.id FROM sessions s JOIN channels c ON c.id=s.channel_id WHERE c.station_id = ?)`;
      params.push(location);
    }
    const rows = await query(
      `SELECT DATE_FORMAT(tl.created_at, '${fmt}') AS bucket,
              SUM(CASE WHEN tl.type='CHARGING_FEE' THEN -tl.amount ELSE -tl.amount END) AS revenue
       FROM transaction_logs tl WHERE ${where}
       GROUP BY bucket ORDER BY bucket`, params,
    );
    res.json(rows.map((r) => ({ bucket: r.bucket, revenue: Number(r.revenue) })));
  } catch (err) { next(err); }
});

// ===== Lokasi =====
adminRouter.get('/locations', async (req, res, next) => {
  try {
    const q = `%${req.query.search || ''}%`;
    res.json(await paginate(
      `SELECT s.*,
        (SELECT COUNT(*) FROM devices d WHERE d.station_id = s.id) AS machine_count
       FROM stations s WHERE s.name LIKE ? OR s.city LIKE ? ORDER BY s.name`,
      [q, q], req.query,
    ));
  } catch (err) { next(err); }
});

adminRouter.post('/locations', async (req, res, next) => {
  try {
    const { name, address, city, lat, lng, power_kw, type, hours } = req.body || {};
    if (!name || !address || !city) return res.status(400).json({ error: 'name/address/city wajib' });
    const r = await query(
      `INSERT INTO stations (name, address, city, lat, lng, power_kw, type, hours)
       VALUES (?,?,?,?,?,?,?,?)`,
      [name, address, city, lat ?? 0, lng ?? 0, power_kw ?? config.machinePowerKw, type || 'DC', hours || '24 Jam'],
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
});

adminRouter.patch('/locations/:id', async (req, res, next) => {
  try {
    const { name, address, city, lat, lng, status, power_kw, type, hours } = req.body || {};
    await query(
      `UPDATE stations SET name=COALESCE(?,name), address=COALESCE(?,address),
        city=COALESCE(?,city), lat=COALESCE(?,lat), lng=COALESCE(?,lng),
        status=COALESCE(?,status), power_kw=COALESCE(?,power_kw),
        type=COALESCE(?,type), hours=COALESCE(?,hours)
       WHERE id=?`,
      [name, address, city, lat, lng, status, power_kw, type, hours, req.params.id]
        .map((v) => v ?? null),
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get('/locations/:id', async (req, res, next) => {
  try {
    const [station] = await query('SELECT * FROM stations WHERE id = ?', [req.params.id]);
    if (!station) return res.status(404).json({ error: 'Lokasi tidak ditemukan' });
    const machines = await query(
      `SELECT d.*, (SELECT COUNT(*) FROM channels c WHERE c.device_id = d.id) AS channel_count
       FROM devices d WHERE d.station_id = ?`, [req.params.id],
    );
    const [[stats]] = [await query(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(s.total_cost),0) AS revenue
       FROM sessions s JOIN channels c ON c.id = s.channel_id
       WHERE c.station_id = ? AND s.billing_type='PAYMENT'`, [req.params.id])];
    res.json({ station, machines, stats: { sessions: Number(stats.sessions), revenue: Number(stats.revenue) } });
  } catch (err) { next(err); }
});

// ===== Mesin (mode = READ-ONLY, dari firmware) =====
adminRouter.get('/machines', async (req, res, next) => {
  try {
    const q = `%${req.query.search || ''}%`;
    const result = await paginate(
      `SELECT d.id, d.name, d.station_id, d.mode, d.online, d.last_seen_at, d.fw_info,
              st.name AS station_name,
              (SELECT COUNT(*) FROM channels c WHERE c.device_id = d.id) AS channel_count
       FROM devices d LEFT JOIN stations st ON st.id = d.station_id
       WHERE d.name LIKE ? ORDER BY d.name`, [q], req.query,
    );
    result.data = result.data.map((m) => ({ ...m, online: isDeviceOnline(m.id) ? 1 : 0 }));
    res.json(result);
  } catch (err) { next(err); }
});

adminRouter.post('/machines', async (req, res, next) => {
  try {
    const { name, stationId, deviceKey, channels } = req.body || {};
    if (!name || !deviceKey) return res.status(400).json({ error: 'name & deviceKey wajib' });
    const nCh = Number(channels) || config.maxChannelsPerMachine;
    if (nCh < 1 || nCh > config.maxChannelsPerMachine) {
      return res.status(400).json({ error: `Jumlah channel 1..${config.maxChannelsPerMachine} (batas hardware)` });
    }
    const id = await withTx(async (conn) => {
      const [r] = await conn.query(
        'INSERT INTO devices (device_key, name, station_id) VALUES (?,?,?)',
        [deviceKey, name, stationId || null],
      );
      for (let i = 1; i <= nCh; i++) {
        await conn.query(
          'INSERT INTO channels (station_id, device_id, device_ch) VALUES (?,?,?)',
          [stationId || null, r.insertId, i],
        );
      }
      return r.insertId;
    });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

adminRouter.patch('/machines/:id', async (req, res, next) => {
  try {
    // `mode` sengaja TIDAK diterima — diatur level firmware (spec/addendum).
    const { name, stationId } = req.body || {};
    if ('mode' in (req.body || {})) {
      return res.status(400).json({ error: 'mode mesin read-only (diatur di firmware)' });
    }
    await query('UPDATE devices SET name=COALESCE(?,name), station_id=COALESCE(?,station_id) WHERE id=?',
      [name ?? null, stationId ?? null, req.params.id]);
    if (stationId) {
      await query('UPDATE channels SET station_id=? WHERE device_id=?', [stationId, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===== Channel (status read-only; satu-satunya override: maintenance) =====
adminRouter.get('/channels', async (req, res, next) => {
  try {
    res.json(await paginate(
      `SELECT c.*, d.name AS machine_name, d.online AS device_online, st.name AS station_name
       FROM channels c
       LEFT JOIN devices d ON d.id = c.device_id
       LEFT JOIN stations st ON st.id = c.station_id
       ORDER BY c.station_id, c.device_id, c.device_ch`, [], req.query,
    ));
  } catch (err) { next(err); }
});

adminRouter.post('/channels/:id/maintenance', async (req, res, next) => {
  try {
    const on = Boolean(req.body?.enabled);
    const [chn] = await query('SELECT status FROM channels WHERE id = ?', [req.params.id]);
    if (!chn) return res.status(404).json({ error: 'Channel tidak ditemukan' });
    if (on && chn.status === 'CHARGING') {
      return res.status(409).json({ error: 'Tidak bisa maintenance saat sesi berjalan' });
    }
    await query('UPDATE channels SET maintenance=?, status=? WHERE id=?',
      [on ? 1 : 0, on ? 'OFFLINE' : 'READY', req.params.id]);
    res.json({ ok: true, maintenance: on });
  } catch (err) { next(err); }
});

// ===== Parameter Motor per-slot (SUPERADMIN) — remote V/I write =====
adminRouter.get('/channels/:id/params/:slot', requireSuperadmin, async (req, res, next) => {
  try {
    const slot = Number(req.params.slot);
    const [chn] = await query(
      `SELECT c.device_ch, d.id AS device_id FROM channels c
       JOIN devices d ON d.id = c.device_id WHERE c.id = ?`,
      [req.params.id],
    );
    if (!chn) return res.status(404).json({ error: 'Channel tidak ditemukan' });

    let line;
    try { line = buildGetParam(chn.device_ch, slot); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    const reply = await sendToDevice(chn.device_id, line);
    res.json(JSON.parse(reply.slice('#OK getparam '.length)));
  } catch (err) { next(err); }
});

adminRouter.post('/channels/:id/params', requireSuperadmin, async (req, res, next) => {
  try {
    const { slot, vset, iset, ocp, otp, lvp } = req.body || {};
    const [chn] = await query(
      `SELECT c.device_ch, c.status, d.id AS device_id FROM channels c
       JOIN devices d ON d.id = c.device_id WHERE c.id = ?`,
      [req.params.id],
    );
    if (!chn) return res.status(404).json({ error: 'Channel tidak ditemukan' });
    if (chn.status === 'CHARGING') {
      return res.status(409).json({ error: 'Tidak bisa ubah parameter saat channel sedang CHARGING' });
    }

    let line;
    try { line = buildSetParam(chn.device_ch, Number(slot), { vset, iset, ocp, otp, lvp }); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    let reply;
    try {
      reply = await sendToDevice(chn.device_id, line);
    } catch (err) {
      await query(
        `INSERT INTO motor_param_audit_log
           (admin_user_id, device_id, channel, fw_slot, old_values, new_values, result)
         VALUES (?,?,?,?,NULL,?,'FAILED')`,
        [req.user.id, chn.device_id, chn.device_ch, slot, JSON.stringify({ vset, iset, ocp, otp, lvp })],
      );
      return res.status(502).json({ error: `Mesin menolak: ${err.message}` });
    }

    const json = JSON.parse(reply.slice('#OK setparam '.length));
    await query(
      `INSERT INTO motor_param_audit_log
         (admin_user_id, device_id, channel, fw_slot, old_values, new_values, result)
       VALUES (?,?,?,?,?,?,'OK')`,
      [req.user.id, chn.device_id, chn.device_ch, slot, JSON.stringify(json.old), JSON.stringify(json.new)],
    );
    res.json(json);
  } catch (err) { next(err); }
});

// ===== Motor Profiles (CRUD penuh, termasuk parameter teknis + fw_slot) =====
adminRouter.get('/motors', async (req, res, next) => {
  try {
    const q = `%${req.query.search || ''}%`;
    res.json(await paginate(
      'SELECT * FROM motor_profiles WHERE brand LIKE ? OR model LIKE ? ORDER BY brand, model',
      [q, q], req.query,
    ));
  } catch (err) { next(err); }
});

function motorFields(body) {
  const f = {};
  for (const k of ['brand', 'model', 'category']) if (body[k] !== undefined) f[k] = body[k];
  for (const k of ['max_power_kw', 'batt_cap_kwh', 'fw_slot', 'vset_v', 'iset_a', 'ocp_a', 'otp_c', 'lvp_v']) {
    if (body[k] !== undefined) f[k] = Number(body[k]);
  }
  if (body.is_active !== undefined) f.is_active = body.is_active ? 1 : 0;
  if (f.fw_slot !== undefined && !(Number.isInteger(f.fw_slot) && f.fw_slot >= 0 && f.fw_slot <= 9)) {
    throw Object.assign(new Error('fw_slot harus 0..9 (slot M0..M9 firmware)'), { status: 400 });
  }
  return f;
}

adminRouter.post('/motors', async (req, res, next) => {
  try {
    const f = motorFields(req.body || {});
    for (const k of ['brand', 'model', 'fw_slot', 'vset_v', 'iset_a', 'ocp_a', 'otp_c', 'lvp_v']) {
      if (f[k] === undefined) return res.status(400).json({ error: `${k} wajib diisi` });
    }
    const cols = Object.keys(f);
    const r = await query(
      `INSERT INTO motor_profiles (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      Object.values(f),
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
});

adminRouter.patch('/motors/:id', async (req, res, next) => {
  try {
    const f = motorFields(req.body || {});
    if (!Object.keys(f).length) return res.status(400).json({ error: 'Tidak ada field' });
    await query(
      `UPDATE motor_profiles SET ${Object.keys(f).map((k) => `${k}=?`).join(',')} WHERE id=?`,
      [...Object.values(f), req.params.id],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.delete('/motors/:id', async (req, res, next) => {
  try {
    // Soft-delete: profil bisa dirujuk sesi lama.
    await query('UPDATE motor_profiles SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===== Top-Up (approve atomic: saldo + log) =====
adminRouter.get('/topups', async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = '1=1';
    if (status) { where += ' AND t.status = ?'; params.push(status.toUpperCase()); }
    res.json(await paginate(
      `SELECT t.*, u.full_name, u.email FROM topup_requests t
       JOIN users u ON u.id = t.user_id WHERE ${where} ORDER BY t.id DESC`,
      params, req.query,
    ));
  } catch (err) { next(err); }
});

adminRouter.post('/topups/:id/approve', async (req, res, next) => {
  try {
    const result = await withTx(async (conn) => {
      const [[t]] = await conn.query(
        'SELECT * FROM topup_requests WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!t) throw Object.assign(new Error('Request tidak ditemukan'), { status: 404 });
      if (t.status !== 'PENDING') throw Object.assign(new Error('Sudah diputuskan'), { status: 409 });
      await conn.query(
        "UPDATE topup_requests SET status='APPROVED', decided_at=NOW(), decided_by=? WHERE id=?",
        [req.user.id, t.id]);
      await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [t.amount, t.user_id]);
      await conn.query(
        "INSERT INTO transaction_logs (user_id, amount, type, description) VALUES (?,?,'TOPUP',?)",
        [t.user_id, t.amount, `Top-up #${t.id} disetujui`]);
      return t;
    });
    await notify({
      userId: result.user_id, type: 'topup_approved', title: 'Top-up disetujui',
      body: `Rp ${Number(result.amount).toLocaleString('id-ID')} sudah masuk saldo`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/topups/:id/reject', async (req, res, next) => {
  try {
    const reason = (req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Alasan reject wajib diisi' });
    const [t] = await query('SELECT * FROM topup_requests WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Request tidak ditemukan' });
    // Guard status di UPDATE (audit M2): approve & reject bersamaan tidak boleh
    // menghasilkan saldo masuk tapi status REJECTED.
    const upd = await query(
      "UPDATE topup_requests SET status='REJECTED', reason=?, decided_at=NOW(), decided_by=? WHERE id=? AND status='PENDING'",
      [reason, req.user.id, t.id]);
    if (!upd.affectedRows) return res.status(409).json({ error: 'Sudah diputuskan' });
    await notify({
      userId: t.user_id, type: 'topup_rejected', title: 'Top-up ditolak', body: reason,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===== Log transaksi (semua sesi; TRIAL ditandai billing_type) =====
adminRouter.get('/transactions', async (req, res, next) => {
  try {
    const { location, machine, channel, user, status, billing, from, to } = req.query;
    const params = [];
    let where = '1=1';
    if (location) { where += ' AND c.station_id = ?'; params.push(location); }
    if (machine)  { where += ' AND c.device_id = ?'; params.push(machine); }
    if (channel)  { where += ' AND s.channel_id = ?'; params.push(channel); }
    if (user)     { where += ' AND s.user_id = ?'; params.push(user); }
    if (status)   { where += ' AND s.status = ?'; params.push(status.toUpperCase()); }
    if (billing)  { where += ' AND s.billing_type = ?'; params.push(billing.toUpperCase()); }
    if (from)     { where += ' AND s.start_time >= ?'; params.push(from); }
    if (to)       { where += ' AND s.start_time < DATE_ADD(?, INTERVAL 1 DAY)'; params.push(to); }
    res.json(await paginate(
      `SELECT s.*, u.full_name, u.email, st.name AS station_name, d.name AS machine_name,
              c.device_ch, mp.brand, mp.model
       FROM sessions s
       LEFT JOIN users u ON u.id = s.user_id
       JOIN channels c ON c.id = s.channel_id
       LEFT JOIN stations st ON st.id = c.station_id
       LEFT JOIN devices d ON d.id = c.device_id
       LEFT JOIN motor_profiles mp ON mp.id = s.motor_profile_id
       WHERE ${where} ORDER BY s.start_time DESC`, params, req.query,
    ));
  } catch (err) { next(err); }
});

// ===== User management =====
adminRouter.get('/users', async (req, res, next) => {
  try {
    const q = `%${req.query.search || ''}%`;
    res.json(await paginate(
      `SELECT id, email, phone, full_name, username, balance, role, status, created_at
       FROM users WHERE full_name LIKE ? OR email LIKE ? ORDER BY id DESC`,
      [q, q], req.query,
    ));
  } catch (err) { next(err); }
});

adminRouter.get('/users/:id', async (req, res, next) => {
  try {
    const [u] = await query(
      'SELECT id, email, phone, full_name, username, balance, role, status, created_at FROM users WHERE id=?',
      [req.params.id]);
    if (!u) return res.status(404).json({ error: 'User tidak ditemukan' });
    const [[stats]] = [await query(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(total_cost),0) AS spent,
              COALESCE(SUM(consumed_kwh),0) AS kwh
       FROM sessions WHERE user_id = ?`, [u.id])];
    const recent = await query(
      'SELECT id, status, consumed_kwh, total_cost, start_time FROM sessions WHERE user_id=? ORDER BY start_time DESC LIMIT 10',
      [u.id]);
    res.json({ user: { ...u, balance: Number(u.balance) }, stats, recentSessions: recent });
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/deactivate', async (req, res, next) => {
  try {
    await query("UPDATE users SET status='SUSPENDED' WHERE id=? AND role='USER'", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
adminRouter.post('/users/:id/activate', async (req, res, next) => {
  try {
    // Scope role='USER' (audit M6): admin biasa tidak boleh menghidupkan lagi
    // akun admin yang dinonaktifkan superadmin.
    await query("UPDATE users SET status='ACTIVE' WHERE id=? AND role='USER'", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===== Superadmin: kelola akun admin =====
adminRouter.get('/admins', requireSuperadmin, async (req, res, next) => {
  try {
    res.json(await query(
      "SELECT id, email, full_name, role, status, created_at FROM users WHERE role IN ('ADMIN','SUPERADMIN')"));
  } catch (err) { next(err); }
});

adminRouter.post('/admins', requireSuperadmin, async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'name/email/password (min 8) wajib' });
    }
    const hash = await bcrypt.hash(password, 10);
    const username = `adm_${String(email).split('@')[0]}_${Date.now().toString(36)}`.slice(0, 80);
    const r = await query(
      "INSERT INTO users (email, password, full_name, username, role) VALUES (?,?,?,?,'ADMIN')",
      [email, hash, name, username]);
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
});

adminRouter.post('/admins/:id/deactivate', requireSuperadmin, async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Tidak bisa menonaktifkan diri sendiri' });
    }
    await query("UPDATE users SET status='SUSPENDED' WHERE id=? AND role='ADMIN'", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===== Notifikasi admin =====
adminRouter.get('/notifications', async (req, res, next) => {
  try {
    res.json(await paginate(
      "SELECT id, type, title, body, is_read, created_at FROM notifications WHERE audience='ADMIN' ORDER BY id DESC",
      [], req.query,
    ));
  } catch (err) { next(err); }
});
