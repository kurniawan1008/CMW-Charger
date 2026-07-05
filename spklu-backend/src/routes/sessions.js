// Wizard charging sisi user: lokasi -> charger (flat, lintas mesin) -> motor ->
// jumlah -> start -> live (WS) -> ringkasan.
import { Router } from 'express';
import { query, getPricePerKwh } from '../db.js';
import { authRequired, requireAdmin } from '../auth/jwt.js';
import { startSession, stopSession, getActiveSession } from '../services/sessionService.js';

export const sessionsRouter = Router();
sessionsRouter.use(authRequired);

// Daftar lokasi aktif + ketersediaan.
sessionsRouter.get('/locations', async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT s.id, s.name, s.address, s.city, s.lat, s.lng, s.status, s.power_kw, s.type, s.hours,
        (SELECT COUNT(*) FROM channels c JOIN devices d ON d.id = c.device_id
          WHERE c.station_id = s.id AND d.online = 1) AS total_chargers,
        (SELECT COUNT(*) FROM channels c JOIN devices d ON d.id = c.device_id
          WHERE c.station_id = s.id AND d.online = 1 AND c.status = 'READY' AND c.maintenance = 0)
          AS available_chargers
       FROM stations s WHERE s.status <> 'OFFLINE' ORDER BY s.name`,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Daftar charger FLAT per lokasi — mesin disembunyikan dari user.
// Label "Charger N" digenerate dari urutan (device_id, device_ch), stabil lintas mesin.
sessionsRouter.get('/locations/:id/chargers', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT c.id, c.status, c.maintenance, d.online AS device_online, d.mode AS device_mode
       FROM channels c JOIN devices d ON d.id = c.device_id
       WHERE c.station_id = ? ORDER BY c.device_id, c.device_ch`,
      [req.params.id],
    );
    res.json(rows.map((r, i) => ({
      id: r.id,
      label: `Charger ${i + 1}`,
      available: r.status === 'READY' && !r.maintenance && r.device_online === 1
        && r.device_mode === 'ONLINE',
      status: r.maintenance ? 'MAINTENANCE' : r.device_online ? r.status : 'OFFLINE',
    })));
  } catch (err) { next(err); }
});

// Katalog motor untuk user — hanya field tampilan, tanpa parameter teknis.
sessionsRouter.get('/motors', async (_req, res, next) => {
  try {
    res.json(await query(
      `SELECT id, brand, model, category, max_power_kw, batt_cap_kwh
       FROM motor_profiles WHERE is_active = 1 ORDER BY brand, model`,
    ));
  } catch (err) { next(err); }
});

sessionsRouter.get('/price', async (_req, res, next) => {
  try { res.json({ pricePerKwh: await getPricePerKwh() }); } catch (err) { next(err); }
});

// Pemulihan UI: sesi ACTIVE milik user (untuk hydrate wizard setelah refresh).
sessionsRouter.get('/sessions/active', async (req, res, next) => {
  try {
    res.json({ session: await getActiveSession(req.user.id) });
  } catch (err) { next(err); }
});

sessionsRouter.post('/sessions/start', async (req, res, next) => {
  try {
    const { channelId, motorProfileId, mode, target } = req.body || {};
    const result = await startSession({
      userId: req.user.id,
      channelId: Number(channelId),
      motorProfileId: Number(motorProfileId),
      mode, target: Number(target),
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

sessionsRouter.post('/sessions/:id/stop', async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPERADMIN';
    res.json(await stopSession(req.params.id, req.user.id, { isAdmin }));
  } catch (err) { next(err); }
});

sessionsRouter.get('/sessions/:id', async (req, res, next) => {
  try {
    const [s] = await query(
      `SELECT s.*, st.name AS station_name, mp.brand, mp.model
       FROM sessions s
       JOIN channels c ON c.id = s.channel_id
       LEFT JOIN stations st ON st.id = c.station_id
       LEFT JOIN motor_profiles mp ON mp.id = s.motor_profile_id
       WHERE s.id = ?`, [req.params.id],
    );
    if (!s) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
    const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPERADMIN';
    if (!isAdmin && s.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Bukan sesi milik Anda' });
    }
    res.json(s);
  } catch (err) { next(err); }
});
