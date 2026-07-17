# Plan: Remediasi Keamanan Sistem SPKLU — 18 Jul 2026

Hasil security review menyeluruh (kode backend/frontend, konfigurasi Nginx,
dan keadaan riil VPS produksi `202.74.75.231`). Ditulis mengikuti alur
writing-plans; setiap item punya langkah eksekusi konkret + verifikasi.

## Ringkasan temuan

| # | Temuan | Severity | Status |
|---|--------|----------|--------|
| C1 | Private key SSH (`CMW-Charger.pem`) terekspos ke transkrip chat dan MASIH terdaftar di `authorized_keys` VPS | 🔴 Critical | Fix sekarang |
| H1 | Situs produksi berjalan HTTP polos (tanpa TLS) — password & JWT lewat jaringan tanpa enkripsi | 🟠 High | Butuh domain (aksi user) |
| M1 | Backend Node listen di `*:3001` (semua interface) — hanya dilindungi UFW; kalau UFW mati, backend terekspos langsung tanpa CSP/log Nginx | 🟡 Medium | Fix sekarang |
| L1 | `PermitRootLogin without-password` — login root via key masih diizinkan | 🟢 Low | Fix sekarang (hati-hati) |
| L2 | fail2ban tidak terpasang — tidak ada throttling brute-force di level SSH (mitigasi: password auth sudah off) | 🟢 Low | Opsional |
| L3 | `Referrer-Policy: no-referrer-when-downgrade` bisa diperketat; HSTS belum ada (baru relevan setelah TLS) | 🟢 Low | Ikut H1 |

## Yang SUDAH baik (tidak perlu diubah)

- UFW aktif, default deny incoming; hanya 22/80/443 terbuka.
- MySQL bind `127.0.0.1`; DB user dedicated; `.env` permission 600.
- `PasswordAuthentication no` di sshd.
- Semua `device_key` custom (bukan placeholder).
- helmet + CSP ketat + CORS origin spesifik + rate limit auth/topup.
- Login timing-safe (dummy bcrypt hash); re-check role/status per request.
- Klaim channel atomik, binding device→sesi, WS topic ownership check.
- Token WS di query string TIDAK masuk access log (`access_log off`).
- Fail-fast produksi tanpa `JWT_SECRET`/`DB_PASSWORD` yang layak.

## Langkah eksekusi

### C1 — Rotasi SSH key (CRITICAL, kerjakan pertama)

Prinsip: add-verify-remove — key baru ditambah dan DIVERIFIKASI login
sebelum key lama dicabut, supaya tidak terkunci dari server.

1. Generate keypair ed25519 baru di laptop:
   `ssh-keygen -t ed25519 -f ~/.ssh/spklu_deploy -C spklu-deploy-2026-07-18`
2. Backup `authorized_keys` di VPS.
3. Append public key baru ke `authorized_keys`.
4. Verifikasi login pakai key baru (`ssh -i ~/.ssh/spklu_deploy -o IdentitiesOnly=yes ...`).
5. Hapus baris key RSA lama (yang terekspos) dari `authorized_keys` —
   dua entry ed25519 lain dibiarkan.
6. Verifikasi key lama DITOLAK dan key baru tetap bisa masuk.
7. **Aksi user**: hapus file `C:\Users\TECH ASIA\Downloads\CMW-Charger.pem`
   dari laptop (dan dari mana pun ia pernah dibagikan/di-download).

### M1 — Bind backend ke 127.0.0.1

1. `config.js`: tambah `host: process.env.HOST || '127.0.0.1'`.
2. `server.js`: `server.listen(config.port, config.host, ...)`.
3. Commit + push + deploy backend (`git pull`, `pm2 restart spklu-backend`).
4. Verifikasi: `ss -tlnp | grep 3001` menunjukkan `127.0.0.1:3001` (bukan `*:3001`),
   situs tetap berfungsi lewat Nginx, device tetap online.

Catatan: gateway Pi connect via Nginx (`/api/ws/device` port 80), bukan
langsung ke 3001 — binding localhost tidak memutus device.

### L1 — PermitRootLogin no

1. Tulis drop-in `/etc/ssh/sshd_config.d/70-hardening.conf`: `PermitRootLogin no`.
2. `sudo sshd -t` (validasi) lalu `sudo systemctl reload ssh`.
3. Sesi berjalan tidak terputus; login harian tetap via user `CMW-Charger` + sudo.

### H1 — TLS/HTTPS (butuh keputusan user)

Certbot tidak bisa menerbitkan sertifikat untuk IP polos — **butuh domain**
dengan A record → `202.74.75.231`. Setelah domain siap, ikuti DEPLOY.md
Tahap 4 (certbot --nginx, update `VITE_API_URL` + `CORS_ORIGIN`, rebuild,
redeploy, pm2 restart). Sekalian: tambah HSTS + perketat Referrer-Policy
ke `strict-origin-when-cross-origin` (L3).

Risiko selama belum TLS: kredensial login & token sesi bisa disadap di
jaringan publik (WiFi umum, ISP). Prioritaskan pengadaan domain.

### L2 — fail2ban (opsional)

`sudo apt install -y fail2ban` — default jail sshd langsung aktif.
Risiko rendah; mitigasi tambahan di atas password-auth-off.

## Urutan eksekusi sesi ini

1. C1 (rotasi key) — critical, kompromi aktif.
2. M1 (bind 127.0.0.1) — code change + deploy.
3. L1 (PermitRootLogin) — setelah C1 terverifikasi.
4. H1, L2 — menunggu keputusan/aksi user (domain; persetujuan install paket).
