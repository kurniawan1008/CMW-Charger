-- ============================================================================
-- SPKLU · Delta Schema 2 — audit log remote-write parameter motor (Part B)
--   mysql -u root -p spklu_db < db/schema-delta-2.sql
-- Prasyarat: schema-delta.sql SUDAH diterapkan (butuh tabel users, devices,
-- channels, dan role SUPERADMIN).
-- ============================================================================
USE spklu_db;

CREATE TABLE IF NOT EXISTS motor_param_audit_log (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  admin_user_id  INT NOT NULL,
  device_id      INT NOT NULL,
  channel        TINYINT NOT NULL,
  fw_slot        TINYINT NOT NULL,
  old_values     JSON NULL,
  new_values     JSON NOT NULL,
  result         ENUM('OK','FAILED') NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mpal_admin  FOREIGN KEY (admin_user_id) REFERENCES users(id),
  CONSTRAINT fk_mpal_device FOREIGN KEY (device_id) REFERENCES devices(id),
  KEY idx_mpal_device (device_id, channel),
  KEY idx_mpal_admin (admin_user_id)
) ENGINE=InnoDB;
