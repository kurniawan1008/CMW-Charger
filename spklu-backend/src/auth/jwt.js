import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.full_name },
    config.jwtSecret,
    { expiresIn: config.jwtExpires },
  );
}

// Verifikasi token + RE-CHECK status & role dari DB tiap request (audit H1):
// user yang di-suspend / admin yang diturunkan tidak boleh tetap punya akses
// sampai token 7 harinya kedaluwarsa.
export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token tidak ada' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Token invalid/kedaluwarsa' });
  }
  try {
    const [u] = await query('SELECT role, status, full_name FROM users WHERE id = ?', [payload.id]);
    if (!u) return res.status(401).json({ error: 'Akun tidak ditemukan' });
    if (u.status !== 'ACTIVE') return res.status(403).json({ error: 'Akun dinonaktifkan' });
    req.user = { id: payload.id, role: u.role, name: u.full_name };
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Akses ditolak untuk role ini' });
  }
  next();
};

export const requireAdmin = requireRole('ADMIN', 'SUPERADMIN');
export const requireSuperadmin = requireRole('SUPERADMIN');
