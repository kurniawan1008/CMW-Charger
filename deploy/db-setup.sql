-- =============================================
-- SPKLU — Setup DB user produksi
-- =============================================
-- Jalankan sebagai root MySQL/MariaDB SEKALI di VPS setelah instalasi:
--   sudo mysql < deploy/db-setup.sql
--
-- Sebelum menjalankan: ganti 'GANTI_PASSWORD_KUAT' di baris di bawah dengan
-- password acak minimal 16 karakter. Password ini juga harus di-set sebagai
-- DB_PASSWORD di spklu-backend/.env.
--
-- Prinsip: user aplikasi TIDAK boleh punya privilege ALTER/DROP/CREATE.
-- Migrasi schema dijalankan manual sebagai root.

-- 1) Buat database jika belum ada
CREATE DATABASE IF NOT EXISTS spklu_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2) Buat user aplikasi (localhost only — backend jalan di VPS yang sama)
CREATE USER IF NOT EXISTS 'spklu'@'localhost'
  IDENTIFIED BY 'GANTI_PASSWORD_KUAT';

-- 3) Grant privilege minimum untuk operasi normal
--    SELECT/INSERT/UPDATE/DELETE cukup untuk aplikasi berjalan.
--    Tidak ada ALTER/DROP/CREATE — mencegah SQL injection eskalasi.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON spklu_db.*
  TO 'spklu'@'localhost';

-- 4) Terapkan
FLUSH PRIVILEGES;

-- 5) Verifikasi (opsional)
SHOW GRANTS FOR 'spklu'@'localhost';
