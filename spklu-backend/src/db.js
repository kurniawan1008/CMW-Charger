import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  decimalNumbers: true,
});

export async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Jalankan fn dalam transaksi; rollback bila melempar.
export async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getSetting(key, fallback = null) {
  const rows = await query('SELECT v FROM settings WHERE k = ?', [key]);
  return rows.length ? rows[0].v : fallback;
}

export async function getPricePerKwh() {
  return Number(await getSetting('price_per_kwh', '2440'));
}
