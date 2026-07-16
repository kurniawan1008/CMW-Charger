# Deploy SPKLU — VPS + Raspberry Pi Zero 2W

Panduan langkah demi langkah untuk memasang sistem SPKLU (backend + frontend) ke
VPS produksi dan menghubungkan gateway Raspberry Pi ke mesin ESP32.

**Arsitektur produksi:**

```
[ ESP32 mesin ] --UART--> [ Pi Zero 2W gateway ] --WSS--> [ VPS ]
                                                            ├── Nginx (443)
                                                            │     ├── static SPA  -> /var/www/spklu
                                                            │     └── /api/*      -> 127.0.0.1:3001
                                                            │           (REST + WS /api/ws/device, /api/ws/client)
                                                            ├── PM2 -> Node backend (:3001)
                                                            └── MySQL/MariaDB (:3306, localhost)
```

**Yang dianggap sudah siap:**
- VPS Linux (Ubuntu 22.04+ / Debian 12+) dengan akses `sudo`.
- Raspberry Pi Zero 2W dengan Raspberry Pi OS, terhubung serial ke ESP32.
- Repo ini di-push ke GitHub / clone-able ke VPS.

---

## Tahap 1 — Environment & Database

### 1.1 Install paket dasar

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx mariadb-server
# Node.js 20 LTS (via nodesource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
# PM2 global
sudo npm install -g pm2
```

Verifikasi:
```bash
node -v   # v20.x
npm -v
mysql --version
nginx -v
pm2 -v
```

### 1.2 Amankan MariaDB

```bash
sudo mysql_secure_installation
# Ikuti wizard: set root password, remove anonymous users, disallow remote root,
# remove test db, reload privilege tables.
```

### 1.3 Clone repo & terapkan schema

```bash
cd /opt
sudo git clone https://github.com/USERNAME/spklu.git
sudo chown -R $USER:$USER spklu
cd spklu
```

Terapkan schema (satu kali):
```bash
sudo mysql < schema.sql                       # tabel awal
sudo mysql < spklu-backend/db/schema-delta.sql # motor_profiles, enums, settings
sudo mysql spklu_db < spklu-backend/db/indexes-audit.sql  # index performa
sudo mysql spklu_db < spklu-backend/db/schema-delta-2.sql # audit log remote-write parameter (Part B)
sudo mysql spklu_db < spklu-backend/db/schema-delta-3.sql # nomor HP unik (security review)
```

### 1.4 Buat DB user dedicated

Edit `deploy/db-setup.sql`, ganti `GANTI_PASSWORD_KUAT` dengan password acak minimal
16 karakter. Simpan password itu — nanti dipakai di `.env`.

```bash
# generate password acak 24 char (contoh)
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
# edit deploy/db-setup.sql -> ganti GANTI_PASSWORD_KUAT
nano deploy/db-setup.sql
# terapkan
sudo mysql < deploy/db-setup.sql
```

### 1.5 Konfigurasi backend `.env`

```bash
cd spklu-backend
cp .env.production.example .env
# Generate JWT_SECRET
node ../deploy/gen-jwt-secret.mjs
# Salin output ke JWT_SECRET di .env
nano .env
```

**Wajib di-set di `.env`:**
- `NODE_ENV=production`
- `DB_PASSWORD=<password dari step 1.4>`
- `JWT_SECRET=<output dari gen-jwt-secret.mjs, ≥32 char>`
- `CORS_ORIGIN=https://domain-anda` (atau `http://IP_VPS` kalau belum ada domain)

**Backend akan REFUSE START** kalau salah satu tidak dipenuhi.

### 1.6 Update `device_key` di DB

Backend menolak koneksi dari gateway Pi jika `device_key` masih default
(`CHANGE_ME_DEVICE_KEY`). Generate key unik per mesin:

```bash
node -e "console.log('DK-'+require('crypto').randomBytes(9).toString('base64url'))"
# ulang untuk setiap mesin
```

Update DB:
```sql
sudo mysql spklu_db
UPDATE devices SET device_key='DK-...' WHERE id=1;
-- ulang untuk setiap mesin. Simpan key ini, akan diisi ke config Pi nanti.
```

### 1.7 Install dependency backend

```bash
cd /opt/spklu/spklu-backend
npm ci --omit=dev
mkdir -p logs
```

---

## Tahap 2 — PM2 Process Manager

### 2.1 Start backend

```bash
cd /opt/spklu/spklu-backend
pm2 start ecosystem.config.js --env production
pm2 logs spklu-backend --lines 20
# Tunggu muncul: "[spklu-backend] listening :3001 — DB ok (spklu_db)"
```

Kalau muncul error `FATAL: env produksi belum di-set` — kembali ke step 1.5,
`.env` belum lengkap.

### 2.2 Persist supaya restart otomatis saat boot VPS

```bash
pm2 save
pm2 startup       # copy-paste perintah yang di-print (sudo env PATH=... pm2 startup)
```

### 2.3 Log rotation (VPS storage terbatas)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## Tahap 3 — Nginx Reverse Proxy

### 3.1 Build frontend

Backend mount semua route (REST + WS) di bawah prefix `/api` (lihat Nginx
config di 3.3) — `VITE_API_URL` **wajib** diakhiri `/api`. WS URL diturunkan
otomatis dari `VITE_API_URL` (`http→ws`, `https→wss`), tidak perlu variabel
terpisah.

```bash
cd /opt/spklu/spklu-frontend
npm ci
# Domain/IP publik + akhiran /api (WAJIB — lihat catatan di atas)
echo 'VITE_API_URL=https://GANTI_DOMAIN/api' > .env.production
# Kalau belum ada domain, pakai IP: VITE_API_URL=http://IP_VPS/api
npm run build
```

> Setelah TLS aktif nanti (Tahap 4), ganti ke `https://domain/api` dan
> rebuild — WS otomatis ikut jadi `wss://`.

### 3.2 Deploy static ke /var/www/spklu

```bash
sudo mkdir -p /var/www/spklu
sudo cp -r dist/* /var/www/spklu/
sudo chown -R www-data:www-data /var/www/spklu
```

### 3.3 Aktifkan Nginx site

```bash
# Edit domain di file config
sudo cp /opt/spklu/deploy/nginx/spklu.conf /etc/nginx/sites-available/spklu
sudo nano /etc/nginx/sites-available/spklu   # ganti GANTI_DENGAN_DOMAIN_ANDA

sudo ln -sf /etc/nginx/sites-available/spklu /etc/nginx/sites-enabled/spklu
sudo rm -f /etc/nginx/sites-enabled/default   # opsional
sudo nginx -t
sudo systemctl reload nginx
```

### 3.4 Firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (untuk certbot & fallback)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
# Port 3001 TIDAK dibuka — hanya Nginx yang boleh menghubungi backend.
```

### 3.5 Smoke test tanpa TLS

Buka `http://IP_VPS/` di browser. Harusnya:
- Login page SPKLU muncul (Design system Arus)
- DevTools → Network → login → status 200/201 dari `/api/auth/login`
- Setelah login, WS `/api/ws/client` upgrade **101 Switching Protocols**

---

## Tahap 4 (opsional) — TLS/Let's Encrypt

Butuh domain dengan A record menunjuk ke IP VPS.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d domain.anda -m email@anda --agree-tos --redirect
# Certbot otomatis edit /etc/nginx/sites-available/spklu, menambah listen 443 SSL
# dan redirect 80 -> 443.
sudo systemctl reload nginx
```

Setelah HTTPS aktif:
1. Update `.env.production` frontend: `VITE_API_URL=https://domain.anda/api`
2. Rebuild: `npm run build` (WS otomatis jadi `wss://` — diturunkan dari VITE_API_URL)
3. Redeploy static: `sudo cp -r dist/* /var/www/spklu/`
4. Update `.env` backend: `CORS_ORIGIN=https://domain.anda`
5. `pm2 restart spklu-backend`

Certbot memasang cron auto-renew otomatis. Cek: `sudo certbot renew --dry-run`.

---

## Tahap 5 — Raspberry Pi Zero 2W Gateway

Per Pi (satu Pi per mesin ESP32):

```bash
sudo apt update && sudo apt install -y python3-pip python3-venv
cd ~
git clone https://github.com/USERNAME/spklu.git
cd spklu/gateway
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Config:
```bash
cp .env.example .env
nano .env
# WS_URL=wss://domain.anda/ws/device
# DEVICE_KEY=DK-...   (sesuai yang di DB devices row untuk mesin ini)
# SERIAL_PORT=/dev/serial0 (atau /dev/ttyAMA0, cek dengan `ls /dev/serial*`)
```

Install systemd service:
```bash
sudo cp deploy/systemd/spklu-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spklu-gateway
sudo journalctl -u spklu-gateway -f
```

Verifikasi di VPS: di dashboard admin, mesin harusnya tampil status **READY**.

---

## Verifikasi Go-Live

Checklist final:

- [ ] `pm2 status` — backend online, uptime naik
- [ ] `curl https://domain/healthz` → `ok`
- [ ] Login admin & user → sukses
- [ ] Buka `/admin/channel` → mesin online, status READY/CHARGING
- [ ] Coba wizard user: pilih lokasi → charger → motor → mode → jumlah → start
- [ ] WS telemetry masuk (angka kWh naik realtime)
- [ ] Sesi selesai → saldo user berkurang sesuai biaya, refund tercatat di log
- [ ] Reconciler bekerja: matikan simulator/Pi paksa saat sesi jalan, tunggu ~90
      detik, sesi otomatis di-close, refund akurat

---

## Operasi Rutin

### Update code

```bash
cd /opt/spklu
git pull
# Backend
cd spklu-backend && npm ci --omit=dev && pm2 restart spklu-backend
# Frontend
cd ../spklu-frontend && npm ci && npm run build
sudo cp -r dist/* /var/www/spklu/
```

### Backup DB (cron harian)

```bash
sudo crontab -e
# tambahkan:
0 3 * * * mysqldump spklu_db > /root/backup/spklu-$(date +\%F).sql && find /root/backup -mtime +30 -delete
```

### Rotasi log Nginx (sudah otomatis via logrotate default Debian)

Cek: `ls /etc/logrotate.d/nginx`.

### Monitoring

- `pm2 monit` — CPU/RAM realtime
- `pm2 logs spklu-backend` — log app
- `sudo tail -f /var/log/nginx/spklu.error.log` — error web
- `sudo journalctl -u spklu-gateway -f` — di Pi, log gateway
