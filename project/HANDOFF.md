# CMW Universal Fast Charging — Handoff untuk Claude Code

Dokumen ini merangkum titik-titik integrasi backend & mesin (SPKLU) untuk prototipe UI yang ada di `CMW Dashboard.dc.html`. Prototipe berjalan sepenuhnya di client-side dengan data dummy in-memory — semua "mutasi" (tambah/edit/hapus/approve/top-up) hanya disimpan di state React (`editOverrides`, `createdItems`, `deletedIds`).

Ganti setiap poin di bawah dengan panggilan API sungguhan.

## 1. Sisi Admin

### 1.1 Overview (`adminPage === 'overview'`)
- **Stat cards** (Pendapatan / Top-Up / Pengguna / Sesi Aktif) — `GET /admin/metrics/summary?period=daily|weekly|monthly`
- **Chart Pendapatan** — `GET /admin/metrics/revenue?period=daily|weekly|monthly&location=all|<lokasiId>`
- **Status Mesin (donut Online/Offline)** — `GET /admin/machines/status-summary`
- **Payment vs Offline Mode bar** — `GET /admin/machines/mode-summary`
- **Top-Up Menunggu Review (side panel)** — `GET /admin/topups?status=Pending&limit=5`
  - Approve → `POST /admin/topups/{id}/approve`
  - Reject → `POST /admin/topups/{id}/reject { reason }`

### 1.2 Lokasi SPKLU (`isPageLokasi`)
- List → `GET /admin/locations?search=<q>`
- Create → `POST /admin/locations { name, address, status }`
- Update → `PATCH /admin/locations/{id} { name, address, status }`
- Delete → `DELETE /admin/locations/{id}`

### 1.3 Manajemen Mesin (`isPageMesin`)
- List → `GET /admin/machines?search=<q>`
- Create → `POST /admin/machines { name, lokasi, mode, channels }`
- Update → `PATCH /admin/machines/{id} { name, lokasi, mode, channels }`
- Delete → `DELETE /admin/machines/{id}`
- Field `mode` ∈ `Payment | Offline` — jika `Offline`, channel di mesin ini tidak menagih user.
- Field `online` real-time bisa dari WebSocket heartbeat mesin (topic `machine.{id}.status`).

### 1.4 Manajemen Channel (`isPageChannel`)
- List → `GET /admin/channels?search=<q>&status=<filter>`
- Update → `PATCH /admin/channels/{id} { name, mesin, status }`
- Delete → `DELETE /admin/channels/{id}`
- Field `status` ∈ `Available | In-Use | Fault | Offline` — real-time dari MQTT/WebSocket `channel.{id}.state`.

### 1.5 Motor Profiles (`isPageMotor`)
- List → `GET /admin/motors?search=<q>`
- Create → `POST /admin/motors { brand, model, category, maxPower, battCap }`
- Update → `PATCH /admin/motors/{id} { ... }`
- Delete → `DELETE /admin/motors/{id}`

### 1.6 Top-Up Requests (`isPageTopup`)
- List → `GET /admin/topups?search=<q>&status=<filter>`
- Approve → `POST /admin/topups/{id}/approve` (juga menambah saldo user secara atomic)
- Reject → `POST /admin/topups/{id}/reject { reason }`

### 1.7 Log Transaksi (`isPageLog`)
- List → `GET /admin/transactions?search=<q>&mode=<filter>&from=<date>&to=<date>&page=<n>`
- Export CSV → `GET /admin/transactions/export?…`

### 1.8 Manajemen User (`isPageUser`)
- List → `GET /admin/users?search=<q>`
- Toggle status → `POST /admin/users/{id}/deactivate` / `/activate`
- View detail → `GET /admin/users/{id}` (belum ada halaman detail di UI, tinggal dibangun)

## 2. Sisi User

### 2.1 Login / Register
- `POST /auth/login { email, password }` → `{ token, user }`
- `POST /auth/register { name, email, phone, password }` → `{ token, user }`
- Token disimpan di `localStorage.cmw_token`. UI belum menyimpan token — tambahkan di `doLogin()`/`doRegister()`.

### 2.2 Beranda User (`userPage === 'home'`)
- Saldo & profile → `GET /user/me` → `{ name, email, balance, initials, lastTopupDate }`
- Lokasi favorit → `GET /user/favorites`
- Riwayat singkat (3 terakhir) → `GET /user/transactions?limit=3`

### 2.3 Wizard Charging (step 2–9)
Alur: Lokasi → Mesin → Channel → Motor → Jumlah → Konfirmasi → Sesi Live → Ringkasan.
- Step 2 `GET /locations` (semua, tidak difilter status)
- Step 3 `GET /locations/{lokasiId}/machines?online=true`
- Step 4 `GET /machines/{mesinId}/channels?status=Available` (max 3 per mesin)
- Step 5 `GET /user/motors` (motor yang user pernah pakai) + `GET /motors` (katalog)
- Step 6 (jumlah kWh/Rupiah) — pure client
- Step 7 (konfirmasi) → `POST /sessions/start { channelId, motorId, target, mode:'kwh'|'idr' }` → `{ sessionId }`
- Step 8 **LIVE TELEMETRY** — subscribe WebSocket `session.{sessionId}` events:
  ```
  { energy, voltage, current, power, cost, elapsed, status }
  ```
  Kirim ± tiap detik. Progress ring di UI membaca `energy / target`.
  Stop manual → `POST /sessions/{sessionId}/stop`
- Step 9 `GET /sessions/{sessionId}` (ringkasan final) atau tunggu event `session.completed`.

### 2.4 Riwayat User (`userPage === 'history'`)
- `GET /user/transactions?page=<n>`
- Totals di hero → `GET /user/transactions/summary`

### 2.5 Profil (`userPage === 'profile'`)
- Update profile → `PATCH /user/me { name, email, phone }`
- Ubah password → `POST /user/me/password { old, new }`

## 3. Mesin (SPKLU) — Protokol

Rekomendasi transport: MQTT (broker di sisi backend) atau WebSocket per-mesin.

### 3.1 Heartbeat mesin → backend
```
Topic: machine/{machineId}/heartbeat
Payload: { ts, firmware, uptime, channels: [{ id, status, current, voltage, power, kwh, sessionId? }] }
Frequency: setiap 3–5 detik
```

### 3.2 Perintah backend → mesin
```
Topic: machine/{machineId}/cmd
Payload: { cmd:'start'|'stop', channelId, sessionId, target:{ mode, value } }
```

### 3.3 Event sesi (mesin → backend, di-forward ke UI)
```
Topic: session/{sessionId}/tick
Payload: { energy, voltage, current, power, cost, elapsed }
```
```
Topic: session/{sessionId}/completed
Payload: { finalEnergy, finalCost, finalDuration, reason:'target_reached'|'user_stop'|'fault' }
```

## 4. Catatan UI

- **State mutations client-side** (`editOverrides`, `createdItems`, `deletedIds`, `topupDecisions`) — akan menjadi write-through cache setelah API terpasang. Hapus atau ganti dengan optimistic-update pattern.
- **Fungsi in-file yang perlu di-wire ke API**: `saveEdit()`, `confirmDelete()`, `openCreateModal()`, `approveTopup()`, `rejectTopup()`, `doLogin()`, `doRegister()`, `startCharging()`, `stopCharging()`, `tickTelemetry()`.
- **Search & filter**: saat ini pure client-side lewat `_searchFilter` + `_statusFilter`. Untuk data > 100 baris, ganti ke server-side query params.
- **Fonts**: Baloo 2 (display/angka), Quicksand (body), Orbitron (logo CMW). Semua dari Google Fonts.
- **Design system tokens** ada di `<style>` root: `--blue`, `--green`, `--sky`, `--amber`, `--red`, `--grad-premium`, radii, animasi (`bounceIn`, `wiggle`, `floaty`, `gaugePop`, dst). Konsisten di semua screen.
- **Auto-generated screen labels** — setiap halaman admin & user memiliki `data-screen-label="…"` untuk memudahkan review/komentar tim.

## 5. Tidak dibuat di prototipe (silakan diimplementasi backend + UI)

- Detail user (drill-in dari Manajemen User)
- Pagination untuk log/history (saat ini render semua sekaligus)
- Notifikasi realtime (approve top-up, fault mesin, dsb)
- Role management (admin biasa vs superadmin)
- Multi-tenant / operator lain
- QR-scan flow (jika ada di roadmap fisik)
