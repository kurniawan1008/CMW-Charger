# ADDENDUM: Koreksi & Klarifikasi — Handoff Claude Design → Claude Code

## Cara pakai file ini

Baca file ini **setelah** membaca `HANDOFF.md` dari bundle Claude Design, dan **sebelum** mulai menulis kode backend. File ini mengoreksi beberapa asumsi yang dibuat Claude Design saat membangun prototipe (karena ia tidak punya akses ke firmware), supaya tidak terbawa ke implementasi nyata.

Referensi terkait: `prompt-spklu-web-payment-system.md`, `schema.sql`, `SPKLU_Esp32_Rev8_2.ino`, `spklu_types.h`.

## Yang Sudah Benar dari Prototipe (pertahankan)

- Struktur halaman, alur wizard 9 langkah, dan seluruh mapping endpoint di `HANDOFF.md` section 1–2 sudah sesuai desain yang diminta.
- Sistem motion & visual (glow, particle flow, count-up, dll) sudah sesuai arahan — pertahankan seluruh CSS animation/keyframe yang ada, jangan disederhanakan saat porting ke React.
- Font, warna, dan design token di root `<style>` sudah konsisten — pertahankan sebagai design system.

## Koreksi Wajib Sebelum Implementasi Backend

### 1. Field `mode` pada Manajemen Mesin — harus READ-ONLY

Di prototipe, form edit mesin punya dropdown `mode` (Payment/Offline) yang bisa diubah admin. **Ini salah** — sesuai keputusan arsitektur, mode operasi mesin diatur di level firmware/hardware, bukan dari web.

**Tindakan**: saat wiring ke API nyata, ubah dropdown `mode` di form edit mesin menjadi **badge/label read-only** (tidak submittable). Jangan buat endpoint `PATCH /admin/machines/{id}` menerima field `mode`. Nilai `mode` hanya dibaca dari status heartbeat mesin.

### 2. Field `status` pada Manajemen Channel — perlu klarifikasi

Prototipe juga membuat `status` channel (Available/In-Use/Fault/Offline) sebagai dropdown yang bisa diedit manual. Status ini seharusnya berasal dari telemetry real-time firmware (`ChState`: IDLE/SELECT/CHARGING/DONE/FAULT/PAUSED), bukan input manual.

**Tindakan**: default-kan ini jadi read-only (real-time dari WebSocket/MQTT), sama seperti field `mode`. **Kecuali** Anda memang menginginkan admin bisa override manual untuk keperluan maintenance (misal set channel jadi "Offline" paksa) — kalau iya, beri tahu Claude Code secara eksplisit bahwa ini override manual yang terbatas (misal hanya bisa set ke status "Offline" untuk maintenance, tidak bisa set ke "Charging").

### 3. Motor Profiles kekurangan parameter teknis charging (PALING PENTING)

Prototipe menyimpan Motor Profile dengan field: `brand, model, category, maxPower, battCap`. Field ini bagus untuk tampilan di sisi user (memilih motor berdasarkan merk/model), **tapi firmware butuh parameter charging aktual** sesuai struct `MotorProfile` di `spklu_types.h`:

```
vset_V   (voltage set)
iset_A   (current set, resolusi 0.01A)
ocp_A    (over current protection, 0.01A)
otp_C    (over temperature protection, °C)
lvp_V    (low voltage protection threshold)
```

**Tindakan**: tambahkan kelima field ini ke data model Motor Profile di database (bukan mengganti field yang sudah ada, tapi menambahkan). Di form admin "Tambah/Edit Motor Profile", tambahkan section terpisah untuk parameter teknis ini (bisa dilabeli "Parameter Charging (Teknis)" agar jelas beda konteks dari info umum brand/model). Di sisi user, tetap tampilkan hanya brand/model/category saat memilih motor (tidak perlu user melihat angka teknis) — tapi saat `POST /sessions/start` dipanggil, backend harus mengambil vset/iset/ocp/otp/lvp dari Motor Profile terpilih dan menyertakannya saat membangun command `$AUTH` ke firmware.

### 4. Panjang `sessionId` dibatasi firmware — maksimal 23 karakter

`spklu_types.h` mendefinisikan `char sessionId[24]` — artinya maksimal 23 karakter + null terminator. UUID standar (v4) punya 36 karakter dan **akan terpotong/overflow** kalau dipakai langsung.

**Tindakan**: backend harus generate session ID yang ringkas (contoh: nanoid dengan panjang 12–16 karakter, atau short hash), bukan UUID v4 penuh. Pastikan ID tetap unik secara global (kombinasi timestamp + random cukup).

### 5. Asumsi protokol MQTT antara backend dan Raspberry Pi — belum final, jangan diimplementasi langsung

`HANDOFF.md` section 3 mengusulkan topic MQTT (`machine/{id}/heartbeat`, `machine/{id}/cmd`, dll) sebagai transport backend↔Pi. Ini murni asumsi dari Claude Design, bukan keputusan yang sudah diambil — firmware hanya berkomunikasi UART serial ke Pi (baud 115200, GPIO 4/5), dan protokol Pi↔backend cloud belum ditentukan.

**Tindakan**: perlakukan section 3 di `HANDOFF.md` sebagai **proposal**, bukan spesifikasi final. Sebelum implementasi, konfirmasi dulu ke saya: apakah Pi akan menjalankan MQTT client (butuh broker tambahan), atau cukup WebSocket/REST biasa ke backend (lebih sederhana untuk Pi Zero 2W yang resourcenya terbatas). Apapun transportnya, pastikan payload yang dikirim ke Pi pada akhirnya bisa dipetakan ke format command serial yang sudah ada di firmware (`$AUTH`, `START`, `STOP`, `STATUS`, `CLEAR` — lihat `PiParser` dan `handlePiCmd()` di `.ino`).

## Gap yang Memang Belum Dibangun di Prototipe

Sesuai catatan jujur di `HANDOFF.md` section 5 — ini bukan bug, tapi memang belum dikerjakan Claude Design:

- Halaman detail user (drill-in dari Manajemen User)
- Pagination untuk log/history (saat ini render semua data sekaligus — perlu diganti server-side pagination sebelum data banyak)
- Notifikasi real-time (approve top-up, fault mesin, dsb)
- Role management (admin biasa vs superadmin)
- Multi-tenant/operator lain
- Flow QR-scan (sesuai keputusan kita, QR di mesin hanya info statis, bukan bagian dari flow — jadi ini boleh tetap tidak dibangun)

**Tindakan**: konfirmasi ke saya mana dari daftar ini yang perlu masuk scope sekarang vs ditunda ke iterasi berikutnya, supaya Claude Code tidak menghabiskan waktu membangun semua sekaligus.

## Instruksi Eksekusi untuk Claude Code

1. Baca `HANDOFF.md` dari bundle Claude Design terlebih dahulu secara penuh
2. Baca addendum ini dan terapkan seluruh koreksi di atas — jangan mengikuti field `mode`/`status` yang editable dan field Motor Profile yang tidak lengkap dari prototipe apa adanya
3. Baca `schema.sql`, `prompt-spklu-web-payment-system.md`, dan file firmware sebagai konteks arsitektur penuh
4. Sebelum mulai coding backend, konfirmasi ke saya soal poin 5 (protokol Pi↔backend) dan poin "Gap" di atas
5. Struktur visual/HTML di bundle boleh dijadikan acuan pixel-perfect untuk React — itu bagian yang sudah solid dan tidak perlu didesain ulang
