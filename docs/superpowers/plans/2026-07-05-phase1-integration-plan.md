# Phase 1 Plan — Integrasi ESP32 ⇄ Pi ⇄ Backend (localhost, MySQL)

Referensi: `docs/superpowers/specs/2026-07-05-spklu-web-payment-system-design.md`

Tujuan: seluruh rantai command/telemetry/billing terbukti jalan end-to-end di
localhost memakai simulator ESP32 (hardware belum perlu dicolok). Frontend penuh
menyusul di Tahap 2 — tahap ini diverifikasi lewat REST + WS langsung.

## Tasks

1. **Docs + git baseline** — spec, plan, commit semua file existing.
2. **`spklu-backend/db/schema-delta.sql`** — delta additive sesuai spec; idempotent
   seaman mungkin (CREATE TABLE IF NOT EXISTS; ALTER dijalankan sekali).
3. **Scaffold backend** — `src/config.js`, `src/db.js` (pool mysql2/promise),
   `src/app.js` (express+routes), `src/server.js` (http + ws upgrade dua path),
   `.env.example`, `ecosystem.config.js`, `package.json` (deps: express, mysql2,
   jsonwebtoken, bcryptjs, ws, cors, dotenv; dev: tidak ada framework test — pakai
   `node --test`).
4. **Device hub** (`src/realtime/deviceHub.js`) — handshake device_key, command
   queue per device (1 outstanding, timeout 5 s), parser `#STATE`/`#EVT`/`#MODE`,
   sinkron `channels.status` + `devices.online/mode/last_seen_at`, deteksi trial
   session (mode OFFLINE, sid kosong): buat/selesaikan baris `sessions` TRIAL.
5. **Session service + billing** (`src/services/`) — `sessionId.js` (≤16 char,
   `[A-Za-z0-9_-]`), `commands.js` (builder `$SELECT/$AUTH/$START/$STOP/$DEAUTH` +
   validasi), `billing.js` (kwh↔rp, reserve/refund), `sessionService.js`
   (start/stop/finalize, transaksi SQL).
6. **REST APIs** — auth (register/login), user (me, topup, transactions paginated,
   password), sessions (start/stop/get), admin (overview metrics, locations CRUD,
   machines CRUD tanpa mode, channels list+maintenance override, motor profiles CRUD,
   topups approve/reject atomic, transactions paginated+filter, users list/detail/
   activate/deactivate, superadmin kelola admin), client WS untuk tick+notif.
7. **Gateway Pi** (`gateway/gateway.py`) — pyserial ⇄ websocket, reconnect backoff,
   passthrough baris; `gateway/README.md` setup Pi Zero 2W.
8. **Simulator ESP32** (`tools/machine-sim/sim.js`) — perilaku firmware yang
   relevan: state machine per channel, validasi $AUTH sama persis (#ERR bad_ltype
   dll), telemetry #STATE per detik, limit check → session_complete, mode
   ONLINE/OFFLINE via env, trial session di mode OFFLINE.
9. **Unit test + trial E2E** — `node --test` untuk commands/billing/sessionId/limit
   mapping; lalu jalankan MySQL (schema+delta), backend, simulator; skrip trial
   `tools/trial-e2e.mjs`: register → jadikan admin → topup+approve → motor profile →
   start sesi kwh & idr → verifikasi tick → tunggu complete → cek refund & log.

## Verifikasi keluar tahap 1

- Semua unit test hijau (`npm test` di spklu-backend).
- Trial E2E mencetak ringkasan sesi dengan saldo akhir = awal − biaya aktual.
- Simulator OFFLINE-mode menghasilkan baris sessions TRIAL (user NULL) di DB.
- Command invalid (ltype/lval salah, channel busy, saldo kurang) ditolak dengan
  error jelas dan saldo tidak berubah.
