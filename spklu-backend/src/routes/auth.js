import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { signToken } from '../auth/jwt.js';

export const authRouter = Router();

// Hash valid dari password acak yang tidak dipakai siapa pun — hanya untuk
// menyamakan waktu respons login saat identifier tidak ditemukan.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);

const publicUser = (u) => ({
  id: u.id, email: u.email, phone: u.phone, fullName: u.full_name,
  username: u.username, balance: Number(u.balance), role: u.role, status: u.status,
});

// Registrasi: email/phone + password, tanpa OTP (keputusan arsitektur).
authRouter.post('/register', async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, dan password wajib diisi' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password minimal 8 karakter' });
    }
    const dup = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (dup.length) return res.status(409).json({ error: 'Email sudah terdaftar' });
    // Phone juga harus unik: login menerima phone sebagai identifier, jadi
    // duplikat phone = bisa login ke akun orang lain (security review #4).
    if (phone) {
      const dupPhone = await query('SELECT id FROM users WHERE phone = ?', [phone]);
      if (dupPhone.length) return res.status(409).json({ error: 'Nomor HP sudah terdaftar' });
    }

    const hash = await bcrypt.hash(password, 10);
    const username = `${String(email).split('@')[0]}_${Date.now().toString(36)}`.slice(0, 80);
    const result = await query(
      'INSERT INTO users (email, password, full_name, username, phone) VALUES (?,?,?,?,?)',
      [email, hash, name, username, phone || null],
    );
    const [user] = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) { next(err); }
});

// Login dengan email ATAU phone.
authRouter.post('/login', async (req, res, next) => {
  try {
    const { identifier, email, phone, password } = req.body || {};
    const ident = identifier || email || phone;
    if (!ident || !password) return res.status(400).json({ error: 'identifier & password wajib' });

    const rows = await query('SELECT * FROM users WHERE email = ? OR phone = ?', [ident, ident]);
    const user = rows[0];
    // Selalu jalankan bcrypt.compare meski user tidak ditemukan — tanpa ini,
    // respons "email tak terdaftar" lebih cepat daripada "password salah"
    // dan bisa dipakai menebak email terdaftar (timing user-enumeration).
    const hash = user?.password || DUMMY_HASH;
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) {
      return res.status(401).json({ error: 'Kredensial salah' });
    }
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Akun dinonaktifkan' });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) { next(err); }
});
