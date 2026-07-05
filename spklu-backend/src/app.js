import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { userRouter } from './routes/user.js';
import { sessionsRouter } from './routes/sessions.js';
import { adminRouter } from './routes/admin.js';

export const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/user', userRouter);
app.use('/', sessionsRouter); // /locations, /motors, /sessions, /price
app.use('/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

// Error handler terpusat — ApiError membawa status; sisanya 500.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Internal error' });
});
