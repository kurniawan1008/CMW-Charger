# SPKLU Web Payment System — Design Spec

Tanggal: 2026-07-05 · Status: disetujui user (via sesi brainstorming)

## Konteks

Jaringan SPKLU khusus **motor listrik**. Rantai: ESP32 (firmware Rev8.2, XY12550S,
final — tidak diubah) ⇄ UART 115200 ⇄ Raspberry Pi Zero 2W (gateway) ⇄ WebSocket ⇄
backend cloud ⇄ browser (admin & user dashboard).

**Konstanta hardware (seragam seluruh fleet):** maksimal **3 channel per mesin**,
total daya **7 kW per mesin**. Bukan field per-mesin yang dikonfigurasi — jadi aturan
validasi (`device_ch` 1..3) dan angka tampilan.

## Keputusan yang sudah dikunci

| Topik | Keputusan |
|---|---|
| Transport Pi↔backend | WebSocket client persisten dari Pi (auto-reconnect), tanpa broker MQTT |
| Peran Pi | Translator tipis: teruskan baris serial apa adanya dua arah, tanpa logika bisnis |
| Motor profile → firmware | **Slot mapping**: kolom `fw_slot` (0..9) di `motor_profiles`; backend kirim `$SELECT,<ch>,<slot>` sebelum `$START`. Parameter teknis (vset/iset/ocp/otp/lvp) di DB = master reference admin; nilai aktual di ESP32 diatur via HMI mesin (sinkron manual oleh operator). Firmware TIDAK diubah di tahap 1 |
| Session ID | ≤23 karakter (buffer firmware `char[24]`), hanya `[A-Za-z0-9_-]` (firmware men-sanitize), bukan UUID |
| Tarif | Global tunggal **Rp 2.440/kWh** di tabel `settings` — sama dengan `PRICE_PER_KWH` firmware |
| Billing | Reserve-refund: saldo dipotong sebesar target di awal sesi, selisih dikembalikan saat `session_complete` (limit firmware menjamin biaya ≤ target) |
| Mode mesin (ONLINE/OFFLINE) | Diatur level firmware/hardware; admin UI **read-only** (badge). Backend tidak pernah mengirim `$SETONLINE/$SETOFFLINE` |
| Status channel | Real-time dari telemetry firmware; **satu-satunya override admin: paksa OFFLINE (maintenance)**. Tidak bisa set status lain |
| Sesi mesin OFFLINE-mode | Tetap dicatat sebagai `billing_type='TRIAL'`, `user_id` NULL, tanpa billing, ditandai beda visual di log |
| Top-up | Nominal saja, **tanpa upload bukti transfer** (admin verifikasi manual via mutasi bank) → approve/reject (reject wajib alasan) |
| Auth | Email/phone + password, tanpa OTP, JWT; role `USER`/`ADMIN`/`SUPERADMIN` |
| Role | Sederhana: SUPERADMIN = ADMIN + kelola akun admin lain |
| Notifikasi | In-app saja via WebSocket (bell + toast); tanpa email |
| Scope iterasi 1 | Detail user, pagination server-side, notifikasi in-app, superadmin. Ditunda: multi-tenant, QR-scan |
| Testing | Unit test logic kritis: billing, pembangunan command, session state machine |
| Tech stack | Backend Node.js+Express+ws+mysql2+JWT; Frontend React+TS+Tailwind+shadcn/ui (port pixel-perfect dari bundle Claude Design); deploy Ubuntu VPS+Nginx+PM2 |
| Layout repo | `spklu-backend/` dan `spklu-frontend/` sebagai folder saudara di CMW-Charger |

## Protokol firmware (fakta dari SPKLU_Esp32_Rev8.2.ino — kontrak, bukan asumsi)

Perintah masuk (`$…\n`): `$PING` `$STATUS` `$AUTH,<ch>,<sid>,<ltype>,<lval>`
`$DEAUTH,<ch>` `$SELECT,<ch>,<m>` `$START,<ch>` `$STOP,<ch>` `$CLEAR,<ch>`
`$SLEEP` `$WAKE` `$SETONLINE` `$SETOFFLINE` `$GETMODE`.
`ltype`: 0=none 1=kWh 2=Rupiah 3=detik; `lval>0` wajib bila `ltype>=1`.

Balasan/event (`#…`): `#PONG`, `#OK …`, `#ERR …`, `#MODE ONLINE|OFFLINE`,
`#STATE {"t":ms,"ch":[{ch,en,st,on,pr,m,v,i,p,vset,iset,kwh,rp,sec,tin,auth,sid,lt}]}`
(periodik + jawaban `$STATUS`),
`#EVT {"ev":"session_start|session_stop|session_complete|cable_unplug|fault|cleared","ch":n,"sid":..,"kwh":..,"rp":..,"sec":..,"st":n}`.

`st` (ChState): 0 IDLE, 1 SELECT, 2 CHARGING, 3 DONE, 4 FAULT, 5 PAUSED.
Otorisasi sekali pakai: firmware mencabut `authorized` di setiap akhir sesi.

## Protokol gateway (Pi/simulator ⇄ backend, JSON per pesan WS)

- Gateway→backend saat connect: `{"type":"hello","deviceKey":"…","fw":"…"}`
  → backend validasi ke `devices.device_key`, balas `{"type":"hello_ok","deviceId":n}` atau tutup koneksi.
- Backend→gateway: `{"type":"cmd","line":"$AUTH,1,S…,2,15000"}` → gateway tulis `line+"\n"` ke serial.
- Gateway→backend: `{"type":"line","line":"#STATE {...}"}` untuk setiap baris `#` dari serial.
- Command queue per device di backend: satu perintah outstanding, korelasi berurutan
  dengan balasan `#OK/#ERR/#PONG/#MODE`, timeout 5 detik → gagal.

## Alur sesi berbayar

1. `POST /sessions/start {channelId, motorProfileId, mode:'kwh'|'idr', target}`
2. Validasi: channel READY & !maintenance, device online & mode ONLINE, profile aktif,
   saldo ≥ nilai target (kwh: target×2440; idr: target).
3. Generate sid pendek; **potong saldo = nilai target** (reservasi) + log transaksi;
   insert `sessions` ACTIVE.
4. Kirim berurutan (tunggu #OK tiap langkah): `$SELECT,<ch>,<fw_slot>` →
   `$AUTH,<ch>,<sid>,<ltype>,<lval>` → `$START,<ch>`. Gagal di titik mana pun →
   `$DEAUTH`, refund penuh, sesi dibatalkan.
5. Selama CHARGING: `#STATE` dipetakan ke tick `{energy,voltage,current,power,cost,elapsed,status}`
   → broadcast ke browser subscriber `session.{sid}` via `/ws/client`.
6. `#EVT session_complete|session_stop|cable_unplug` dengan sid → finalisasi:
   `consumed_kwh`, `total_cost=round(kwh×2440)`, refund `target−cost`, update sesi &
   channel, log transaksi, notifikasi in-app.
7. `fault` → sesi FAULT, refund selisih, notifikasi admin.

## Delta schema (additive terhadap schema.sql)

- `motor_profiles`: brand, model, category, max_power_kw, batt_cap_kwh, `fw_slot` 0..9,
  vset_v, iset_a, ocp_a, otp_c, lvp_v, is_active.
- `channels.status` + `FAULT`,`PAUSED`; kolom `maintenance TINYINT(1)`.
- `users.role` + `SUPERADMIN`.
- `sessions`: `user_id` nullable, + `billing_type ENUM('PAYMENT','TRIAL')`,
  `motor_profile_id` FK, `target_rp`, status + `FAULT`.
- `settings` key-value: `price_per_kwh=2440`.
- `notifications`: persist notifikasi in-app (user_id nullable = broadcast admin).

## Tahapan eksekusi

1. **Tahap 1 — Integrasi (localhost, MySQL):** backend + gateway Pi + simulator ESP32 +
   unit test + trial end-to-end. (Plan terpisah.)
2. **Tahap 2 — Frontend UI/UX:** port pixel-perfect bundle Claude Design ke React,
   koreksi addendum (mode read-only, status read-only+maintenance, form teknis motor).
3. **Tahap 3 — Deploy:** VPS Ubuntu, Nginx, PM2, hardening.
