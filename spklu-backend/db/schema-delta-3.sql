-- =============================================
-- Schema delta 3 — keamanan: nomor HP unik
-- =============================================
-- Temuan security review: login menerima email ATAU phone, tapi registrasi
-- hanya menjaga email unik. Dua akun dengan phone sama membuat login via
-- phone bisa mendarat di akun orang lain.
--
-- Langkah 1: bersihkan duplikat yang sudah ada — phone duplikat di-NULL-kan,
-- hanya akun terlama (id terkecil) yang mempertahankan nomornya.
-- (UNIQUE index MySQL mengizinkan banyak NULL, jadi akun tanpa phone aman.)
UPDATE users u
JOIN (
  SELECT phone, MIN(id) AS keep_id
  FROM users
  WHERE phone IS NOT NULL AND phone <> ''
  GROUP BY phone
  HAVING COUNT(*) > 1
) d ON u.phone = d.phone AND u.id <> d.keep_id
SET u.phone = NULL;

-- Phone kosong ('') juga di-NULL-kan supaya tidak bentrok di UNIQUE index.
UPDATE users SET phone = NULL WHERE phone = '';

-- Langkah 2: kunci di level schema.
ALTER TABLE users ADD UNIQUE KEY uq_users_phone (phone);
