# Migrasi VPS Lama → VPS Baru

Panduan memindahkan sistem SPKLU produksi (backend + frontend + database) dari
VPS lama (`202.74.75.231`) ke VPS baru dari tim IT perusahaan, **dengan data
yang sudah ada** (user, saldo, riwayat sesi, dsb) — bukan instalasi kosong.

Strategi: **VPS lama tetap hidup sampai VPS baru terverifikasi benar**, baru
cutover (pindah DNS/akses) dan matikan yang lama. Downtime ditekan ke jendela
singkat saat cutover saja (idealnya < 5 menit), bukan selama proses migrasi.

---

## Bagian A — Yang perlu diminta ke tim IT

Minta VPS dengan spesifikasi setara/lebih baik dari yang sekarang:

- **OS**: Ubuntu 22.04 LTS atau Debian 12 (sama seperti VPS lama — supaya
  `DEPLOY.md` bisa dipakai persis tanpa penyesuaian)
- **RAM**: minimal 1 GB (2 GB lebih aman untuk headroom MySQL + Node + Nginx)
- **Storage**: minimal 20 GB
- **Akses**: SSH dengan sudo (user + key pair, atau password — kalau key pair,
  minta file `.pem`/private key-nya dikirim lewat kanal aman, **bukan** chat
  biasa — lihat catatan keamanan di bagian bawah)
- **IP publik statis** — wajib, supaya domain/DNS bisa diarahkan permanen
- **Port terbuka**: 22 (SSH), 80 (HTTP), 443 (HTTPS) — minta tim IT pastikan
  firewall/security group cloud provider mengizinkan ini masuk

Kalau perusahaan sudah punya domain internal atau ingin pakai domain baru
untuk SPKLU (bukan cuma IP), siapkan juga domain itu di tahap ini — TLS/HTTPS
(Tahap 4 di `DEPLOY.md`) butuh domain, tidak bisa pakai IP polos.

---

## Bagian B — Backup dari VPS lama (sebelum sentuh apa pun di VPS baru)

Jalankan semua ini dari VPS **lama**.

### B.1 Dump database

```bash
sudo mysqldump spklu_db > ~/spklu-migrate-$(date +%F).sql
```

### B.2 Salin `.env` backend (berisi secrets — JANGAN commit ke git)

```bash
cat /opt/spklu/spklu-backend/.env
```
Catat isinya di tempat aman (password manager, bukan chat/notes biasa):
`DB_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN`, `NODE_ENV`.

> **Penting soal `JWT_SECRET`**: kalau dipindah apa adanya, semua token login
> yang aktif sekarang tetap valid di VPS baru (user tidak perlu login ulang
> saat cutover). Kalau di-generate baru, semua orang otomatis ter-logout saat
> cutover — pilih generate baru **hanya** kalau ada alasan keamanan spesifik
> (misal `JWT_SECRET` lama sempat bocor).

### B.3 Catat `device_key` tiap mesin (dipakai ulang di Raspberry Pi)

```bash
sudo mysql spklu_db -e "SELECT id, name, device_key FROM devices;"
```
Ini **tidak berubah** saat migrasi — device_key sudah tersimpan di dump
database (B.1), tapi baik dicatat terpisah untuk sanity-check nanti.

### B.4 Salin sertifikat TLS (kalau sudah pakai HTTPS/certbot)

```bash
sudo tar czf ~/letsencrypt-backup.tar.gz /etc/letsencrypt
```
(Opsional — lebih simpel biasanya re-run `certbot` di VPS baru dari nol,
lihat Bagian D.4. Backup ini hanya jaga-jaga.)

### B.5 Pindahkan semua backup ke lokal (bukan tinggal di VPS lama)

Dari laptop Anda:
```bash
scp -i <path-key-lama> "CMW-Charger@202.74.75.231:~/spklu-migrate-*.sql" .
```

---

## Bagian C — Setup VPS baru (instalasi dasar)

Ikuti **`DEPLOY.md` Tahap 1 sampai Tahap 3** apa adanya di VPS baru — SAMPAI
sebelum langkah "terapkan schema" di 1.3. Alasannya: Tahap 1.3 di `DEPLOY.md`
untuk instalasi baru (schema kosong), tapi migrasi butuh **restore dari dump**
supaya data lama tidak hilang. Ganti langkah itu dengan:

```bash
# ganti Tahap 1.3 "Terapkan schema" dengan restore dump:
sudo mysql -e "CREATE DATABASE spklu_db CHARACTER SET utf8mb4;"
sudo mysql spklu_db < ~/spklu-migrate-2026-XX-XX.sql   # dump dari Bagian B.1
```

Lanjutkan sisanya sesuai `DEPLOY.md`:
- **Tahap 1.4** — buat DB user dedicated (boleh pakai password sama seperti
  lama, atau generate baru — tidak berpengaruh ke data)
- **Tahap 1.5** — isi `.env`: pakai nilai yang dicatat di Bagian B.2. Untuk
  `CORS_ORIGIN`, isi domain/IP **baru**.
- **Lewati Tahap 1.6** (device_key) — sudah ikut di dump database, tidak
  perlu di-generate ulang
- **Tahap 1.7 – 3.4** — install dependency, PM2, build frontend, Nginx,
  firewall — jalankan seperti biasa. Untuk `VITE_API_URL` (Tahap 3.1) dan
  `server_name` (Tahap 3.3), pakai domain/IP **VPS baru**.

**Jangan jalankan Tahap 4 (TLS) dulu** kalau DNS belum diarahkan ke VPS baru
— certbot butuh domain sudah resolve ke IP yang benar. Lakukan setelah
Bagian D selesai.

---

## Bagian D — Verifikasi VPS baru (VPS lama masih hidup, belum ada yang tahu)

VPS baru sekarang jalan paralel, belum dipakai siapa pun. Uji dulu lewat IP
langsung (belum lewat domain):

```
http://<IP_VPS_BARU>/
```

Checklist:
- [ ] Login dengan akun **yang sudah ada** (bukan buat baru) — kalau
      `JWT_SECRET` dipindah apa adanya dan token lama masih tersimpan di
      browser Anda, seharusnya bahkan tanpa login ulang pun tetap masuk
- [ ] Saldo, riwayat sesi, daftar lokasi/mesin — semua data lama muncul utuh
- [ ] `/admin` → cek jumlah user, top-up, log transaksi cocok dengan VPS lama
- [ ] Coba wizard charging (kalau ada mesin simulator/testing yang bisa
      dipakai tanpa ganggu mesin produksi asli)

Kalau semua cocok, lanjut ke TLS (`DEPLOY.md` Tahap 4) — **tapi domain-nya
belum diarahkan ke sini dulu**, jadi certbot akan gagal kalau dicoba sekarang.
Urutannya dibalik untuk migrasi: siapkan Nginx tanpa TLS dulu, baru certbot
**setelah** DNS pindah (Bagian E.2).

---

## Bagian E — Cutover (downtime singkat di sini)

Ini satu-satunya bagian yang bikin ada jeda layanan. Kerjakan di luar jam
sibuk pengisian, dan siapkan semua langkah supaya cepat.

### E.1 (Kalau pakai domain) Update DNS

Ubah A record domain dari IP VPS lama → IP VPS baru. Propagasi DNS bisa makan
beberapa menit sampai beberapa jam tergantung TTL — kalau bisa, **turunkan
TTL domain ke 300 (5 menit) satu hari sebelum cutover**, supaya propagasi
cepat saat harinya tiba.

### E.2 Aktifkan TLS di VPS baru (kalau pakai domain)

Setelah DNS mengarah ke VPS baru:
```bash
sudo certbot --nginx -d domain.anda -m email@anda --agree-tos --redirect
```
Lalu update `.env.production` frontend ke `https://domain.anda/api`, rebuild,
redeploy static (`DEPLOY.md` Tahap 4, langkah 1-3).

### E.3 Dump ulang DB dari VPS lama (data terbaru sejak Bagian B.1)

Antara Bagian B dan sekarang, mungkin ada transaksi baru di VPS lama (top-up,
sesi charging). Dump ulang dan restore **hanya delta** ini kalau jaraknya
signifikan — atau, kalau ingin simpel: **matikan sementara VPS lama** (stop
`spklu-backend` PM2) tepat sebelum dump final, supaya tidak ada transaksi baru
selama proses cutover:

```bash
# di VPS LAMA
pm2 stop spklu-backend
sudo mysqldump spklu_db > ~/spklu-final-$(date +%F-%H%M).sql
```

```bash
# salin ke VPS baru, lalu di VPS BARU:
sudo mysql -e "DROP DATABASE spklu_db; CREATE DATABASE spklu_db CHARACTER SET utf8mb4;"
sudo mysql spklu_db < spklu-final-*.sql
pm2 restart spklu-backend
```

### E.4 Update Raspberry Pi — arahkan ke VPS baru

Di **setiap** Raspberry Pi gateway, ganti `SPKLU_WS_URL` ke domain/IP baru:

```bash
sudo nano /etc/spklu-gateway.env
# WS_URL=wss://domain-baru.anda/api/ws/device  (atau ws://IP_BARU/... kalau belum TLS)
sudo systemctl restart spklu-gateway
sudo journalctl -u spklu-gateway -f
```
Verifikasi: dashboard admin di VPS baru menunjukkan mesin **ONLINE**.

### E.5 Verifikasi akhir

Checklist sama seperti Bagian D, tapi sekarang lewat domain/URL final yang
akan dipakai pelanggan:
- [ ] Login, saldo, riwayat — cocok
- [ ] Mesin ONLINE di admin (RPi sudah pindah)
- [ ] Coba 1 sesi charging kecil end-to-end kalau memungkinkan
- [ ] WS realtime jalan (kWh naik live saat charging)

---

## Bagian F — Rollback (kalau ada masalah di VPS baru)

Karena VPS lama **belum dimatikan**, rollback cepat:

1. Kembalikan DNS ke IP VPS lama (kalau sempat diubah)
2. `pm2 start spklu-backend` di VPS lama (kalau sempat di-stop di E.3)
3. Arahkan `SPKLU_WS_URL` di semua Raspberry Pi kembali ke VPS lama, restart
   service
4. Investigasi masalah di VPS baru dengan tenang, tidak buru-buru — pelanggan
   sudah balik ke jalur yang berfungsi

---

## Bagian G — Decommission VPS lama

**Hanya setelah** VPS baru terbukti stabil menangani trafik produksi
beberapa hari (bukan langsung setelah cutover):

1. Backup terakhir dari VPS lama sebagai arsip (`mysqldump` + `.env` values)
2. Batalkan langganan/hapus instance VPS lama ke provider
3. **Rotasi ulang semua secrets** yang pernah ada di VPS lama sebagai
   praktik baik: `JWT_SECRET` baru (akan logout semua user sekali), password
   DB baru, kredensial superadmin baru — supaya VPS lama yang sudah
   di-deprovision tidak menyisakan credential valid di mana pun

---

## Catatan keamanan untuk proses ini

- **Jangan share private key SSH, password, atau isi `.env` lewat chat** —
  kalau tim IT mengirim kredensial VPS baru, minta lewat kanal internal
  perusahaan yang aman (password manager bersama, dsb), bukan Slack/WhatsApp/
  chat AI manapun. Kalau sudah terlanjur terkirim di kanal manapun, anggap
  bocor dan rotasi setelah dipakai — sama seperti insiden `.pem` VPS lama
  sebelumnya di sesi ini.
- Dump database (`spklu-migrate-*.sql`) berisi data pribadi pelanggan (email,
  nomor HP, saldo) — simpan di tempat yang di-enkripsi, hapus dari laptop
  begitu migrasi selesai dan terverifikasi.
