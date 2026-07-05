-- ============================================================================
-- SPKLU · Skema Database (MySQL 8 / MariaDB 10.4+)
-- Jalankan sekali di server untuk membuat database + tabel + data awal.
--   mysql -u root -p < db/schema.sql
-- ============================================================================

CREATE DATABASE IF NOT EXISTS spklu_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE spklu_db;

-- ===== Pengguna =====
CREATE TABLE IF NOT EXISTS users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(190) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,            -- hash bcrypt
  full_name   VARCHAR(150) NOT NULL,
  username    VARCHAR(80)  NOT NULL UNIQUE,
  npk         VARCHAR(60)  NULL,
  phone       VARCHAR(40)  NULL,
  balance     DECIMAL(14,2) NOT NULL DEFAULT 0,
  role        ENUM('USER','ADMIN')      NOT NULL DEFAULT 'USER',
  status      ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ===== Kanal / colokan pengisian =====
-- Catatan: TIDAK ada kolom `name` — UI memberi label berdasarkan urutan ("CH 1/2/3").
CREATE TABLE IF NOT EXISTS channels (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  station_id          INT NULL,                          -- SPKLU pemilik kanal (NULL = belum ditetapkan)
  device_id           INT NULL,                          -- mesin fisik (NULL = kanal virtual/simulasi)
  device_ch           TINYINT NULL,                      -- nomor konektor pada mesin (1..3)
  status              ENUM('READY','CHARGING','OFFLINE') NOT NULL DEFAULT 'READY',
  current_user_id     INT NULL,
  current_session_id  VARCHAR(40) NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_channels_station (station_id),
  KEY idx_channels_device (device_id),
  CONSTRAINT fk_channel_user FOREIGN KEY (current_user_id)
    REFERENCES users(id) ON DELETE SET NULL
  -- FK ke stations & devices ditambahkan via ALTER di bawah (tabel dibuat setelah ini).
) ENGINE=InnoDB;

-- ===== Sesi pengisian =====
CREATE TABLE IF NOT EXISTS sessions (
  id            VARCHAR(40) PRIMARY KEY,          -- mis. "SESS-1719100000000"
  user_id       INT NOT NULL,
  channel_id    INT NOT NULL,
  start_mode    ENUM('NOMINAL','KWH') NOT NULL DEFAULT 'NOMINAL',
  target_kwh    DECIMAL(10,4) NOT NULL DEFAULT 0,
  consumed_kwh  DECIMAL(10,4) NOT NULL DEFAULT 0,
  total_cost    DECIMAL(14,2) NULL,
  status        ENUM('ACTIVE','COMPLETED','STOPPED') NOT NULL DEFAULT 'ACTIVE',
  start_time    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time      TIMESTAMP NULL,
  KEY idx_sessions_user   (user_id),
  KEY idx_sessions_status (status),
  CONSTRAINT fk_session_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_session_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Permintaan isi saldo (menunggu persetujuan admin) =====
CREATE TABLE IF NOT EXISTS topup_requests (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  status      ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at  TIMESTAMP NULL,
  KEY idx_topupreq_status (status),
  CONSTRAINT fk_topupreq_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Log transaksi (top up + biaya pengisian) =====
CREATE TABLE IF NOT EXISTS transaction_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  type        ENUM('TOPUP','CHARGING_FEE') NOT NULL,
  description VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_logs_user (user_id),
  KEY idx_logs_type (type),
  KEY idx_logs_created (created_at),
  CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Lokasi SPKLU (dikelola admin via dashboard) =====
CREATE TABLE IF NOT EXISTS stations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150)  NOT NULL,
  address     VARCHAR(255)  NOT NULL,
  city        VARCHAR(100)  NOT NULL,
  lat         DECIMAL(10,7) NOT NULL,                 -- -90..90
  lng         DECIMAL(10,7) NOT NULL,                 -- -180..180
  status      ENUM('ONLINE','BUSY','OFFLINE') NOT NULL DEFAULT 'ONLINE',
  connectors  INT NOT NULL DEFAULT 2,                 -- total konektor
  available   INT NOT NULL DEFAULT 0,                 -- konektor tersedia (<= connectors)
  power_kw    INT NOT NULL DEFAULT 60,                -- daya (kW)
  type        ENUM('DC','AC','DC/AC') NOT NULL DEFAULT 'DC',
  hours       VARCHAR(60) NOT NULL DEFAULT '24 Jam',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_stations_city   (city),
  KEY idx_stations_status (status)
) ENGINE=InnoDB;

-- ===== Data awal: 8 stasiun SPKLU contoh (Jabodetabek, Bandung, Surabaya) =====
INSERT INTO stations (name, address, city, lat, lng, status, connectors, available, power_kw, type, hours) VALUES
  ('CMW SPKLU Sudirman Hub',          'Jl. Jenderal Sudirman Kav. 52-53, Senayan',      'Jakarta Selatan',   -6.2249350, 106.8092040, 'ONLINE',  6, 4, 200, 'DC/AC', '24 Jam'),
  ('CMW SPKLU Kelapa Gading',         'Jl. Boulevard Raya Blok M, Kelapa Gading Barat', 'Jakarta Utara',     -6.1578350, 106.9072040, 'BUSY',    4, 0, 150, 'DC',    '24 Jam'),
  ('CMW SPKLU BSD Green Office Park', 'Jl. BSD Grand Boulevard, BSD City, Sampora',     'Tangerang Selatan', -6.3015200, 106.6501690, 'ONLINE',  5, 3, 120, 'DC/AC', '06.00 - 23.00'),
  ('CMW SPKLU Bekasi Summarecon',     'Jl. Bulevar Selatan, Marga Mulya, Bekasi Utara', 'Bekasi',            -6.2215400, 107.0016200, 'OFFLINE', 2, 0,  60, 'AC',    '06.00 - 22.00'),
  ('CMW SPKLU Bogor Pajajaran',       'Jl. Raya Pajajaran No. 88, Baranangsiang',       'Bogor',             -6.6013890, 106.8064580, 'ONLINE',  3, 2, 120, 'DC',    '24 Jam'),
  ('CMW SPKLU Bandung Dago',          'Jl. Ir. H. Djuanda No. 165, Dago, Coblong',      'Bandung',           -6.8847870, 107.6131440, 'BUSY',    4, 1, 150, 'DC/AC', '24 Jam'),
  ('CMW SPKLU Bandung Pasteur',       'Jl. Dr. Djunjunan No. 143-149, Sukabungah',      'Bandung',           -6.8937030, 107.5780180, 'ONLINE',  2, 2,  60, 'AC',    '07.00 - 21.00'),
  ('CMW SPKLU Surabaya Pakuwon',      'Jl. Mayjen Jonosewojo, Babatan, Wiyung',         'Surabaya',          -7.3011400, 112.6744690, 'ONLINE',  6, 5, 200, 'DC/AC', '24 Jam');

-- ===== Mesin SPKLU fisik (ESP32 XY12550S) =====
-- Satu baris = satu mesin/gateway. Kanal dipetakan ke konektor mesin (device_ch).
-- GANTI device_key di bawah dengan token acak rahasia sebelum produksi.
CREATE TABLE IF NOT EXISTS devices (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  device_key   VARCHAR(80)  NOT NULL UNIQUE,            -- rahasia bersama autentikasi gateway
  name         VARCHAR(120) NOT NULL,
  station_id   INT NULL,
  mode         ENUM('ONLINE','OFFLINE') NOT NULL DEFAULT 'OFFLINE',
  online       TINYINT(1)   NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP NULL,
  fw_info      VARCHAR(120) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_devices_station (station_id),
  CONSTRAINT fk_device_station FOREIGN KEY (station_id)
    REFERENCES stations(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO devices (device_key, name, station_id, mode) VALUES
  ('CHANGE_ME_DEVICE_KEY', 'CMW Charger #01 (XY12550S)', 1, 'OFFLINE');

-- ===== Kaitkan kanal → stasiun & mesin =====
ALTER TABLE channels
  ADD CONSTRAINT fk_channel_station FOREIGN KEY (station_id)
  REFERENCES stations(id) ON DELETE SET NULL;
ALTER TABLE channels
  ADD CONSTRAINT fk_channel_device FOREIGN KEY (device_id)
  REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE channels
  ADD UNIQUE KEY uq_channel_device_ch (device_id, device_ch);

-- ===== Data awal: 3 kanal = 3 konektor mesin CMW Charger #01 (di SPKLU Sudirman Hub) =====
INSERT INTO channels (station_id, device_id, device_ch, status) VALUES
  (1, 1, 1, 'READY'),   -- CH-01 → konektor 1 mesin
  (1, 1, 2, 'READY'),   -- CH-02 → konektor 2 mesin
  (1, 1, 3, 'READY');   -- CH-03 → konektor 3 mesin

-- ============================================================================
-- Membuat admin:
--   1) Daftar akun lewat halaman /register di aplikasi.
--   2) Naikkan perannya menjadi ADMIN:
--        UPDATE users SET role='ADMIN' WHERE email='email-anda@contoh.com';
-- (Password tidak bisa di-hash dari SQL karena memakai bcrypt.)
-- ============================================================================
