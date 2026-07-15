import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { userRouter } from './routes/user.js';
import { sessionsRouter } from './routes/sessions.js';
import { adminRouter } from './routes/admin.js';

export const app = express();
// Backend selalu di belakang Nginx (proxy_pass 127.0.0.1:3001) — tanpa ini,
// req.ip selalu terbaca sebagai IP Nginx (127.0.0.1) untuk SEMUA request,
// jadi rate-limiter di bawah membagi kuotanya ke satu bucket untuk seluruh
// pengguna produksi sekaligus (bug: 429 masal walau baru sedikit yang top-up).
// 'trust proxy'=1 mempercayai satu hop reverse-proxy terdekat (Nginx) untuk
// membaca X-Forwarded-For asli milik tiap klien.
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '64kb' }));

// Rate limit endpoint sensitif (audit M2): brute-force login & spam register/topup.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const topupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter);
app.use('/api/user/topups', topupLimiter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api', sessionsRouter); // /api/locations, /api/motors, /api/sessions, /api/price
app.use('/api/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

// Error handler terpusat — ApiError membawa status; 500 tidak membocorkan
// detail internal (pesan driver DB dsb) ke klien (audit M5).
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[api]', err);
    return res.status(status).json({ error: 'Terjadi kesalahan pada server' });
  }
  res.status(status).json({ error: err.message || 'Permintaan tidak valid' });
});
