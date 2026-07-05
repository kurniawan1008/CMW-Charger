import crypto from 'node:crypto';

// Firmware menyimpan sessionId di char[24] => maks 23 karakter, dan
// men-sanitize ke [A-Za-z0-9_-]. Format: S<base36 ms><4 random> = ±16 char.
const RAND_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa karakter ambigu

export const SESSION_ID_MAX = 23;

export function generateSessionId(now = Date.now()) {
  // 10 char acak (~50 bit) — id sesi tidak boleh mudah ditebak karena dipakai
  // di topik telemetry & rekonsiliasi billing (audit keamanan L2).
  let rand = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) rand += RAND_ALPHABET[bytes[i] % RAND_ALPHABET.length];
  const id = `S${now.toString(36).toUpperCase()}${rand}`;
  if (id.length > SESSION_ID_MAX) throw new Error(`sessionId melebihi ${SESSION_ID_MAX} char`);
  return id;
}

export function isFirmwareSafeSessionId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= SESSION_ID_MAX &&
    /^[A-Za-z0-9_-]+$/.test(id)
  );
}
