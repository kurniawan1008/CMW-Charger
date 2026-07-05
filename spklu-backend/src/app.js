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
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '64kb' }));

// Rate limit endpoint sensitif (audit M2): brute-force login & spam register/topup.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const topupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.use('/auth', authLimiter);
app.use('/user/topups', topupLimiter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/user', userRouter);
app.use('/', sessionsRouter); // /locations, /motors, /sessions, /price
app.use('/admin', adminRouter);

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
