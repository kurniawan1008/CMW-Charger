import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.full_name },
    config.jwtSecret,
    { expiresIn: config.jwtExpires },
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token tidak ada' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid/kedaluwarsa' });
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
