-- ============================================================================
-- SPKLU · Delta Schema — dijalankan SETELAH schema.sql (additive, disetujui)
--   mysql -u root -p spklu_db < db/schema-delta.sql
-- Catatan: ALTER di bawah tidak idempotent; jalankan sekali. Bila perlu ulang,
-- cek dulu dengan SHOW COLUMNS.
-- ============================================================================
USE spklu_db;

-- ===== Role superadmin (kelola akun admin lain) =====
ALTER TABLE users
  MODIFY role ENUM('USER','ADMIN','SUPERADMIN') NOT NULL DEFAULT 'USER';

-- ===== Status channel mengikuti ChState firmware + flag maintenance =====
-- FAULT/PAUSED dari telemetry; maintenance = override manual admin (paksa OFFLINE).
ALTER TABLE channels
  MODIFY status ENUM('READY','CHARGING','OFFLINE','FAULT','PAUSED')
    NOT NULL DEFAULT 'READY',
  ADD COLUMN maintenance TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

-- ===== Profil motor listrik (katalog merk/model + parameter charging) =====
-- fw_slot = index profil M0..M9 di ESP32 (slot mapping — firmware tidak menerima
-- parameter via serial; nilai vset/iset/ocp/otp/lvp di bawah adalah master
-- reference yang harus disinkronkan manual ke HMI mesin oleh operator).
CREATE TABLE IF NOT EXISTS motor_profiles (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  brand         VARCHAR(80)  NOT NULL,
  model         VARCHAR(120) NOT NULL,
  category      VARCHAR(60)  NULL,               -- mis. "Skutik", "Sport"
  max_power_kw  DECIMAL(5,2) NULL,               -- info tampilan user
  batt_cap_kwh  DECIMAL(6,3) NULL,               -- info tampilan user
  fw_slot       TINYINT      NOT NULL,           -- 0..9 (M0..M9 di firmware)
  vset_v        DECIMAL(6,2) NOT NULL,           -- voltage set (V)
  iset_a        DECIMAL(6,2) NOT NULL,           -- current set (A, res 0.01)
  ocp_a         DECIMAL(6,2) NOT NULL,           -- over-current protection (A)
  otp_c         SMALLINT     NOT NULL,           -- over-temp protection (°C)
  lvp_v         DECIMAL(6,2) NOT NULL,           -- low-voltage protection (V)
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_motor_active (is_active),
  CONSTRAINT chk_fw_slot CHECK (fw_slot BETWEEN 0 AND 9)
) ENGINE=InnoDB;

-- ===== Sesi: dukung sesi TRIAL (mesin mode OFFLINE, tanpa user/billing) =====
ALTER TABLE sessions
  DROP FOREIGN KEY fk_session_user;
ALTER TABLE sessions
  MODIFY user_id INT NULL,
  ADD COLUMN billing_type ENUM('PAYMENT','TRIAL') NOT NULL DEFAULT 'PAYMENT' AFTER user_id,
  ADD COLUMN motor_profile_id INT NULL AFTER channel_id,
  ADD COLUMN target_rp DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER target_kwh,
  ADD COLUMN end_reason VARCHAR(40) NULL AFTER status,   -- target_reached|user_stop|cable_unplug|fault
  MODIFY status ENUM('ACTIVE','COMPLETED','STOPPED','FAULT') NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE sessions
  ADD CONSTRAINT fk_session_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_session_motor FOREIGN KEY (motor_profile_id)
    REFERENCES motor_profiles(id) ON DELETE SET NULL;

-- ===== Alasan keputusan top-up (reject wajib alasan) =====
ALTER TABLE topup_requests
  ADD COLUMN decided_by INT NULL AFTER status,
  ADD COLUMN reason VARCHAR(255) NULL AFTER decided_by,
  ADD CONSTRAINT fk_topupreq_admin FOREIGN KEY (decided_by)
    REFERENCES users(id) ON DELETE SET NULL;

-- ===== Log transaksi: refund reservasi =====
ALTER TABLE transaction_logs
  MODIFY type ENUM('TOPUP','CHARGING_FEE','REFUND') NOT NULL,
  ADD COLUMN session_id VARCHAR(40) NULL AFTER type;

-- ===== Settings global (tarif dsb) =====
CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(60) PRIMARY KEY,
  v VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT INTO settings (k, v) VALUES ('price_per_kwh', '2440')
  ON DUPLICATE KEY UPDATE k = k;   -- jangan timpa bila sudah ada

-- ===== Notifikasi in-app (user_id NULL = broadcast ke semua admin) =====
CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NULL,
  audience   ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER',
  type       VARCHAR(40)  NOT NULL,              -- topup_approved|topup_rejected|machine_fault|...
  title      VARCHAR(150) NOT NULL,
  body       VARCHAR(255) NULL,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_user (user_id, is_read),
  KEY idx_notif_audience (audience, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Data awal: contoh profil motor (parameter teknis WAJIB diverifikasi
--       teknisi terhadap slot M0..M9 aktual di HMI mesin sebelum produksi) =====
INSERT INTO motor_profiles
  (brand, model, category, max_power_kw, batt_cap_kwh, fw_slot,
   vset_v, iset_a, ocp_a, otp_c, lvp_v)
VALUES
  ('Honda',  'EM1 e:',       'Skutik', 1.70, 1.500, 0, 58.80, 10.00, 12.00, 60, 42.00),
  ('Yamaha', 'E01',          'Skutik', 5.60, 4.900, 1, 84.00, 20.00, 24.00, 60, 60.00),
  ('United', 'T1800',        'Sport',  1.80, 2.160, 2, 71.40, 15.00, 18.00, 60, 51.00);
