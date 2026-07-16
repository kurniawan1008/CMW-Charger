-- =============================================
-- Schema delta 4 — top-up langsung & rebalancing saldo oleh admin
-- =============================================
-- Admin bisa menambah saldo user langsung (tanpa lewat request+approval user)
-- atau mengoreksi saldo (rebalancing) untuk kasus salah top-up/kesalahan lain.
-- Keduanya tercatat di transaction_logs dengan admin_user_id untuk audit siapa
-- yang melakukan, dan tetap terpisah dari TOPUP (top-up via request user biasa).

ALTER TABLE transaction_logs
  MODIFY type ENUM('TOPUP','CHARGING_FEE','REFUND','ADMIN_TOPUP','ADMIN_ADJUST') NOT NULL,
  ADD COLUMN admin_user_id INT NULL AFTER user_id,
  ADD CONSTRAINT fk_log_admin FOREIGN KEY (admin_user_id)
    REFERENCES users(id) ON DELETE SET NULL;
