import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { authRequired } from '../auth/jwt.js';
import { paginate } from './helpers.js';

export const userRouter = Router();
userRouter.use(authRequired);

userRouter.get('/me', async (req, res, next) => {
  try {
    const [u] = await query(
      'SELECT id, email, phone, full_name, username, balance, role, status, created_at FROM users WHERE id = ?',
      [req.user.id],
    );
    if (!u) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json({ ...u, balance: Number(u.balance) });
  } catch (err) { next(err); }
});

userRouter.patch('/me', async (req, res, next) => {
  try {
    const { name, phone } = req.body || {};
    await query('UPDATE users SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone) WHERE id = ?',
      [name || null, phone || null, req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

userRouter.post('/me/password', async (req, res, next) => {
  try {
    const { old: oldPw, new: newPw } = req.body || {};
    if (!oldPw || !newPw || String(newPw).length < 8) {
      return res.status(400).json({ error: 'Password lama & baru (min 8 char) wajib' });
    }
    const [u] = await query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (!u || !(await bcrypt.compare(oldPw, u.password))) {
      return res.status(401).json({ error: 'Password lama salah' });
    }
    await query('UPDATE users SET password = ? WHERE id = ?',
      [await bcrypt.hash(newPw, 10), req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Top-up: nominal saja, tanpa upload bukti (keputusan desain) — admin
// memverifikasi manual lewat mutasi bank sebelum approve.
userRouter.post('/topups', async (req, res, next) => {
  try {
    const amount = Number(req.body?.amount);
    if (!(amount >= 10000)) return res.status(400).json({ error: 'Nominal minimal Rp 10.000' });
    const pending = await query(
      "SELECT id FROM topup_requests WHERE user_id = ? AND status = 'PENDING'", [req.user.id]);
    if (pending.length) return res.status(409).json({ error: 'Masih ada request top-up pending' });
    const r = await query('INSERT INTO topup_requests (user_id, amount) VALUES (?,?)',
      [req.user.id, amount]);
    res.status(201).json({ id: r.insertId, amount, status: 'PENDING' });
  } catch (err) { next(err); }
});

userRouter.get('/topups', async (req, res, next) => {
  try {
    res.json(await paginate(
      'SELECT id, amount, status, reason, created_at, decided_at FROM topup_requests WHERE user_id = ? ORDER BY id DESC',
      [req.user.id], req.query,
    ));
  } catch (err) { next(err); }
});

// Riwayat sesi charging milik user sendiri.
userRouter.get('/transactions', async (req, res, next) => {
  try {
    res.json(await paginate(
      `SELECT s.id, s.status, s.end_reason, s.start_mode, s.target_kwh, s.target_rp,
              s.consumed_kwh, s.total_cost, s.start_time, s.end_time,
              st.name AS station_name, c.device_ch, mp.brand, mp.model
       FROM sessions s
       JOIN channels c ON c.id = s.channel_id
       LEFT JOIN stations st ON st.id = c.station_id
       LEFT JOIN motor_profiles mp ON mp.id = s.motor_profile_id
       WHERE s.user_id = ? ORDER BY s.start_time DESC`,
      [req.user.id], req.query,
    ));
  } catch (err) { next(err); }
});

userRouter.get('/notifications', async (req, res, next) => {
  try {
    res.json(await paginate(
      'SELECT id, type, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC',
      [req.user.id], req.query,
    ));
  } catch (err) { next(err); }
});

userRouter.post('/notifications/read', async (req, res, next) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
