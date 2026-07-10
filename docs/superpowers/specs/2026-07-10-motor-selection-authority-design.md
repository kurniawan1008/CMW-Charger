# Pemisahan Otoritas Pilih Motor (Web vs HMI) + Remote V/I Parameter Write

Status: disetujui, siap masuk tahap plan.

## Konteks

Sistem SPKLU punya dua UI yang sama-sama bisa memilih profil motor untuk sesi
charging: wizard di web (`motor_profiles` table, dipilih user lewat app) dan
tombol grid `b_m0..b_m9` di layar Nextion mesin (customer-facing, di halaman
monitor channel yang sama dengan tombol START/STOP).

Investigasi kode menemukan:

1. Tombol Nextion `b_mX` mengirim `print "SEL,1,0"` langsung ke ESP32 di
   **Touch Release Event** — ini bukan halaman teknisi, tapi halaman utama
   yang dilihat customer.
2. Command lokal ini dan `$SELECT` dari backend **berbagi fungsi
   `handleCmd()`** yang sama di firmware — satu source of truth
   (`ch[c].motorIdx`), tanpa isolasi antar sumber.
3. `SEL,` **tidak punya guard `requireAuth`** (beda dari `START,` yang sudah
   diblokir kalau belum ada `$AUTH`) — HMI bisa ubah profil motor kapan saja
   sebelum channel `CHARGING`, termasuk saat web sedang proses setup sesi.
   Ini membuka race condition: profil yang dibilling di web bisa berbeda dari
   yang benar-benar dipakai mesin.
4. Parameter elektrik (V-SET, I-SET, OCP, OTP, LVP) untuk tiap slot M0-M9
   **hanya ada di NVS lokal mesin** — kolom serupa di tabel `motor_profiles`
   web murni referensi/dokumentasi (lihat komentar di
   `spklu-backend/db/schema-delta.sql`). Tidak ada jalur protokol yang
   mengirim nilai ini dari web ke mesin. Kalau admin tambah motor baru di web
   dengan `fw_slot` tertentu tapi NVS slot itu belum disesuaikan manual di
   HMI, mesin tetap charge pakai parameter LAMA — potensi risiko keselamatan
   (voltage/current tidak sesuai motor sebenarnya).

## Bagian A — Blokir picker fisik saat mode ONLINE + sinkron nama tampilan

### A1. Blokir command lokal `SEL,` saat `requireAuth=true`

Tambah flag global `bool selectFromBackend = false;` di firmware. Di-set
`true` tepat sebelum, dan `false` tepat sesudah, pemanggilan
`handleCmd("SEL,"+...)` dari `backendHandleLine()` (baris ~1994). Di dalam
blok `SEL,` pada `handleCmd()`, tambah guard setelah channel `c` diketahui:

```cpp
if (requireAuth && !selectFromBackend) {
  setChanMsg(c, "Pilih motor via aplikasi", 0xFCA0);
  return;
}
```

Tombol tetap tampil normal (tidak diubah warna/disable secara visual) —
tap ditolak dengan pesan singkat di area pesan channel (`setChanMsg`,
konsisten dengan interlock `CHARGING`/`FAULT` yang sudah ada di blok yang
sama). Saat `requireAuth=false` (mode OFFLINE/trial), picker fisik tetap
berfungsi normal seperti sekarang.

### A2. Protokol `$SELECT` bawa nama motor (opsional, backward-compatible)

`$SELECT,<ch>,<m>` menjadi `$SELECT,<ch>,<m>,<name>`. Firmware parse field
ke-3 secara opsional (kalau tidak ada, perilaku sama seperti sekarang).

Backend (`spklu-backend/src/services/commands.js`, fungsi `buildSelect`):
tambah parameter `name` (string dari `profile.brand + ' ' + profile.model`),
sanitasi sebelum dikirim — strip karakter koma dan kutip (delimiter/escape
protokol), truncate ke ~24 karakter (muat di lebar tombol Nextion).
`sessionService.js` diupdate untuk pass nama ini di pemanggilan
`buildSelect(ch, profile.fw_slot, motorName)`.

### A3. Override label kosmetik, bertahan walau layar reload

Firmware simpan `String webMotorName[3] = {"", "", ""};` di RAM (bukan NVS).
Di-set saat `$SELECT` datang dengan nama dari backend. Dipakai (bukan
`profiles[c][m].label`) di dua tempat:
- `uiSetMotorLabels(c)` — redraw teks tombol `b_mX` untuk slot yang sedang
  aktif (`motorIdx`), kalau override tidak kosong.
- `uiUpdateMonitor()` — field ringkasan motor aktif (`t{1,2,3}_mot.txt`).

**Tidak menyentuh** `profiles[c][m].label` — field itu tetap dipakai apa
adanya oleh halaman Settings teknisi (SAVE di sana tidak boleh ke-corrupt
oleh nama motor dari web).

Override dibersihkan (`webMotorName[c] = "";`) di titik yang sama dengan
`ch[c].authorized = false` di-set: blok `CLEAR,`, `DEAUTH`, dan
session-complete/kuota-habis.

## Bagian B — Remote write parameter V/I (dengan mitigasi penuh)

Fitur baru: superadmin bisa update V-SET/I-SET/OCP/OTP/LVP untuk slot M0-M9
mesin tertentu langsung dari web admin panel, tanpa perlu ke lokasi fisik.

### B1. Role SUPERADMIN

`ALTER TABLE users MODIFY role ENUM('USER','ADMIN','SUPERADMIN') NOT NULL
DEFAULT 'USER';` — migration naikkan akun existing (`rd@cmw.co.id`) ke
`SUPERADMIN`. Endpoint baru di-guard `requireRole('SUPERADMIN')` saja
(admin biasa tidak punya akses).

### B2. Protokol firmware baru: `$SETPARAM`

```
$SETPARAM,<ch>,<slot>,<vset>,<iset>,<ocp>,<otp>,<lvp>
```

Firmware:
- Tolak kalau `ch[c].state == CHARGING` (interlock, sama pola dengan `SEL,`
  dan blok save-settings yang sudah ada).
- Validasi batas nilai wajar sebelum tulis (reject `#ERR param_range` kalau
  di luar rentang — batas persis mengikuti constraint yang sudah dipakai
  halaman Settings, mis. `OCP >= ISET` dipaksa seperti kode existing).
- Reuse `xyWriteGroup15()` + `xyVerifyGroup()` yang sudah ada (dipakai jalur
  Settings-teknisi) untuk tulis+verifikasi ke modul via Modbus.
- Simpan ke NVS via `saveProfileToNVS()` (sama seperti SAVE manual).
- Balas `#OK setparam` / `#ERR setparam_failed` sesuai hasil verify.

### B3. Endpoint admin + audit log

Tabel baru `motor_param_audit_log`: `id, admin_user_id, device_id, channel,
fw_slot, old_values JSON, new_values JSON, result ENUM('OK','FAILED'),
created_at`. Endpoint `POST /api/admin/devices/:id/channels/:ch/params`
(role SUPERADMIN) — baca state lama dulu (`$STATUS`) sebelum kirim
`$SETPARAM`, catat old/new values ke audit log terlepas dari hasilnya.

### B4. Konfirmasi dua langkah di UI

Form input V/I di admin panel: submit pertama menampilkan ringkasan
perubahan (nilai lama → baru) dalam modal konfirmasi, admin harus klik
"Ya, saya yakin" eksplisit sebelum request dikirim ke backend.

## Testing

- Unit: `buildSelect` dengan nama motor tersanitasi (koma/kutip di-strip,
  truncate).
- Simulator: tambah dukungan `$SETPARAM` respon `#OK`/`#ERR` supaya bisa
  ditest end-to-end di localhost tanpa hardware asli.
- Manual di firmware asli: verifikasi `SEL,` lokal ditolak dengan pesan yang
  benar saat `requireAuth=true`, dan `$SELECT` dari backend tetap lolos.
- Manual: `$SETPARAM` ditolak saat channel `CHARGING`, diterima saat
  `READY`/`IDLE`, nilai baru terverifikasi via `$STATUS` setelahnya.
