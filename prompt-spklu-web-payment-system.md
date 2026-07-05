# PROMPT: Bangun Web Payment System SPKLU (Admin + User Dashboard)

## KONTEKS PROJECT

Saya sedang membangun sistem SPKLU (stasiun pengisian kendaraan listrik umum) berbasis IoT multi-layer:
- **ESP32** (firmware sudah ada, `.ino` + `spklu_types.h`) mengontrol modul catu daya (XY12550S) per channel
- **Raspberry Pi Zero 2W** sebagai edge device, komunikasi ke ESP32 via UART (GPIO 4/5, 115200 baud)
- **Web app (yang akan kamu bangun sekarang)**: backend cloud + frontend, terhubung ke Raspberry Pi

Firmware sudah punya mekanisme otorisasi sesi via command `$AUTH` dari backend, dengan field `sessionId`, `limitType` (0=none, 1=kWh, 2=Rupiah, 3=detik), `limitKwh`, `limitRp`, `limitSec`. Saat limit tercapai, firmware otomatis STOP dan mengirim event `session_complete`. Firmware juga punya `MotorProfile` (vset, iset, ocp, otp, lvp per motor) yang akan dikirim sebagai parameter charging.

Tugasmu: bangun **web payment system**-nya (backend + frontend, 2 repo terpisah) yang akan menjadi command center dari seluruh jaringan SPKLU ini.

## ATURAN WAJIB — DATABASE SCHEMA

Database MySQL sudah dirancang dan divalidasi (8 tabel), akan saya lampirkan sebagai `schema.sql` terpisah. **Ini adalah source of truth.** Jangan mengubah struktur tabel yang sudah ada tanpa konfirmasi eksplisit ke saya terlebih dahulu. Kamu boleh mengusulkan tabel/kolom tambahan bila memang dibutuhkan oleh fitur di bawah (misal untuk motor profiles, top-up requests, session logs), tapi tetap konfirmasi dulu sebelum eksekusi, dan jelaskan alasannya.

Jika saya belum melampirkan `schema.sql` di pesan ini, **tanyakan ke saya dulu sebelum mulai coding** — jangan berasumsi atau membuat schema sendiri dari nol.

## TECH STACK

- **Backend** (repo terpisah, misal `spklu-backend`): Node.js + Express, WebSocket (untuk real-time telemetry & status mesin), JWT untuk autentikasi/session, MySQL sebagai database.
- **Frontend** (repo terpisah, misal `spklu-frontend`): React + TypeScript + Tailwind CSS + shadcn/ui.
- **Deployment target**: Ubuntu VPS, Nginx sebagai reverse proxy, PM2 untuk process management Node.js. Siapkan struktur project dan konfigurasi (env vars, script start/build) yang siap untuk deployment semacam ini — tidak perlu mengeksekusi deployment sekarang, cukup pastikan project-nya deployment-ready.

## ARSITEKTUR & HIERARKI DATA

Hierarki: **Lokasi SPKLU → Mesin (unit ESP32+Pi) → Channel (maksimal 3 channel per mesin)**.

Poin penting:
- Dari sisi **admin**, hierarki ini terlihat penuh (lokasi, mesin, channel semua dikelola eksplisit).
- Dari sisi **user**, mesin disembunyikan — user hanya melihat **Lokasi → Channel** secara flat. Setiap channel punya label user-facing yang **auto-generate unik per lokasi**, lintas mesin (contoh: sebuah lokasi dengan 2 mesin x 3 channel akan menampilkan "Charger 1" sampai "Charger 6" sebagai daftar flat, tanpa user tahu itu berasal dari mesin mana).
- Setiap mesin punya **mode operasi**: `offline` (mesin bisa dipakai charging trial tanpa otorisasi web/tanpa billing — dipakai saat infrastruktur payment belum siap) atau `payment` (butuh otorisasi `$AUTH` dari backend). **Mode ini diatur di level firmware/hardware, bukan dari web.** Dashboard admin hanya menampilkan mode saat ini secara **read-only** (tidak ada tombol toggle mode dari web).
- Sesi charging dari mesin mode `offline` **tetap harus tercatat di log admin** untuk keperluan monitoring teknis, tapi tanpa data user/billing (field user harus nullable, dan log harus jelas menandai entri ini sebagai sesi non-billing/trial, berbeda visual dari sesi payment).

## FITUR — MOTOR PROFILES (Database Merk Motor)

Ini modul baru yang perlu dibangun penuh:
- **Admin**: CRUD untuk "Motor Profiles" — nama merk/model motor kendaraan listrik, beserta parameter charging: `vset` (voltage set), `iset` (current set, resolusi 0.01A), `ocp` (over current protection, 0.01A), `otp` (over temperature protection, °C), `lvp` (low voltage protection threshold).
- **User**: saat memulai sesi charging (setelah pilih channel), user memilih merk/model motor kendaraannya dari daftar Motor Profiles yang aktif. Parameter dari profile terpilih inilah yang nantinya dikirim ke firmware sebagai bagian dari command `$AUTH` (mapping ke struct `MotorProfile` di firmware — vset_V, iset_A, ocp_A, otp_C, lvp_V).

## AUTENTIKASI

- Registrasi & login menggunakan **phone atau email + password, tanpa OTP** (sesuai keputusan arsitektur project).
- Backend menggunakan **JWT** untuk session management.
- Role dibedakan di database: `admin` dan `user`. Route/API harus di-guard sesuai role (admin tidak bisa diakses oleh user biasa dan sebaliknya).

## DASHBOARD ADMIN

### Halaman Overview / Home
- Total pendapatan (dengan grafik pendapatan: filter harian/mingguan/bulanan, filter rentang tanggal custom, filter per lokasi)
- Total top-up (nilai top-up yang sudah diapprove)
- Total pengguna terdaftar
- Sesi aktif saat ini (real-time, via WebSocket)
- Fitur lain yang relevan untuk overview operasional (contoh: quick stats mesin online/offline, top-up pending yang butuh review, dsb — silakan usulkan yang masuk akal untuk operator SPKLU)

### Monitor per Lokasi SPKLU
- CRUD lokasi (tambah, edit, nonaktifkan lokasi)
- Detail per lokasi: daftar mesin di lokasi tsb, status masing-masing, statistik pendapatan/sesi per lokasi

### Manajemen Mesin
- Tambah/edit mesin (info general: nama, lokasi, identifier unik, dll — **bukan** parameter teknis vset/iset dsb, itu sudah dipindah ke Motor Profiles)
- Info per mesin: status online/offline, mode operasi saat ini (offline/payment, read-only), jumlah channel, kondisi tiap channel (idle/charging/fault/dll — mapping dari `ChState` di firmware: IDLE, SELECT, CHARGING, DONE, FAULT, PAUSED)
- Menu ringkasan: total lokasi, total mesin, mesin online, breakdown mode payment vs offline, dan metrik relevan lain yang wajar untuk monitoring fleet SPKLU

### Manajemen Channel
- Lihat detail tiap channel (maks 3 per mesin): status, sesi berjalan (jika ada), riwayat sesi
- Channel terhubung ke label user-facing yang auto-generate (Charger N)

### Motor Profiles
- CRUD merk/model motor beserta parameter charging (lihat bagian Motor Profiles di atas)

### Top-Up Requests
- Daftar request top-up dari user (status: pending/approved/rejected)
- Detail request: bukti transfer (jika ada upload), nominal, user terkait
- Aksi approve/reject dengan alasan (untuk reject)
- Setelah approve, saldo user otomatis bertambah

### Log Transaksi (Admin)
- Seluruh riwayat sesi charging (payment maupun offline/trial)
- Filter: per lokasi, per mesin, per channel, per user, per rentang tanggal, per status (completed/fault/dll)
- Sesi offline/trial ditandai jelas berbeda dari sesi payment (tanpa data billing)

### Manajemen User (fitur relevan lain)
- Daftar user terdaftar, detail saldo, riwayat aktivitas
- Silakan tambahkan fitur admin relevan lain yang wajar untuk sistem SPKLU multi-lokasi (contoh: audit log aktivitas admin, notifikasi fault mesin, dll) — gunakan penilaianmu untuk melengkapi apa yang masuk akal, tapi tetap dalam scope yang sudah dijelaskan di sini.

## DASHBOARD USER

### Alur Charging (wizard, urutan tetap)
1. Login
2. Pilih lokasi SPKLU (dengan info jarak/alamat jika relevan, daftar lokasi aktif)
3. Pilih channel yang tersedia di lokasi tsb (ditampilkan sebagai daftar flat "Charger 1, 2, 3..." — status available/in-use terlihat jelas)
4. Pilih merk/model motor dari Motor Profiles yang aktif
5. Set jumlah pengisian — user pilih mode target: **kWh** atau **Rupiah** (sesuai `limitType` di firmware), input nominal/jumlah
6. Konfirmasi — sistem cek saldo user cukup untuk jumlah yang diminta, tampilkan ringkasan sebelum mulai
7. **Live telemetry** selama charging (real-time via WebSocket): tegangan, arus, daya, energi terpakai (kWh berjalan), estimasi biaya berjalan, durasi, progress terhadap limit yang di-set — tampilkan dengan animasi yang hidup (angka count-up smooth, progress indicator visual)
8. Ringkasan setelah sesi selesai: total kWh terpakai, total biaya, durasi, status akhir (completed/fault/dll)

### Fitur Lain
- **Saldo & Top-Up**: lihat saldo saat ini, request top-up manual (upload bukti transfer, input nominal), riwayat status top-up (pending/approved/rejected)
- **Log Transaksi (User)**: riwayat sesi charging milik user sendiri, dengan detail per sesi (lokasi, channel, waktu, kWh, biaya, status)
- **Profil**: edit data akun, ubah password
- Fitur relevan lain yang wajar untuk pengalaman user SPKLU (contoh: lokasi favorit, riwayat merk motor yang sering dipakai untuk mempercepat alur berikutnya) — gunakan penilaianmu.

## ARAHAN DESAIN UI/UX

Bangun ini bukan sekadar dashboard fungsional, tapi sebagai pengalaman premium yang terasa hidup dan terpadu. Arahan yang harus dipegang:

**Cinematic Website OS** — seluruh dashboard (admin maupun user) harus terasa seperti satu sistem operasi yang utuh dan imersif, bukan kumpulan halaman terpisah yang di-reload. Transisi antar halaman/section harus mulus.

**AI Website Architect / AI Development Sprint** — struktur kode bersih, modern, production-ready. Komponen React terorganisir dengan baik, reusable, dan mengikuti best practice terkini.

**Motion & Interaction** — ini pilar utama, jangan diperlakukan sebagai tambahan kosmetik:
- Micro-interactions di setiap elemen interaktif (hover states, klik, loading states)
- Animasi angka pada live telemetry (count-up smooth, bukan angka yang tiba-tiba berubah)
- Animasi visual untuk status charging (progress ring, wave/pulse animation saat proses berjalan)
- Transisi halaman yang halus, terasa seperti navigasi di dalam satu aplikasi

**Luxury Landing Page / Premium Design System** — tipografi kelas atas, whitespace yang lega, konsistensi visual antar semua halaman. Dashboard admin dan user harus terasa "senada" (satu design system, satu bahasa visual) meski peruntukannya berbeda.

**Tema warna**: Light mode sebagai basis (putih/off-white cerah), dengan aksen warna **biru dan biru langit**, dikombinasikan dengan **sentuhan hijau** — mengesankan clean-energy/tech tanpa terasa flat atau generik. Gunakan gradient dan kontras yang cukup untuk kesan premium.

**Website Performance & SEO** — meski animatif, performa tetap prioritas: lazy loading komponen berat, optimasi asset, tidak ada animasi yang mengorbankan responsivitas. Landing page publik (jika ada) perlu SEO dasar yang baik.

**Complete Website Builder** — hasil akhir harus terasa seperti produk jadi/production-ready, bukan prototipe atau MVP kasar.

## LOG TRANSAKSI

Baik dashboard admin maupun user **masing-masing** punya halaman log transaksi sendiri (lihat detail di section masing-masing di atas). Pastikan konsisten dalam struktur data yang ditampilkan meski scope datanya berbeda (admin lihat semua, user lihat miliknya sendiri).

## CATATAN INTEGRASI FIRMWARE (untuk referensi backend)

- Command `$AUTH` dikirim dari backend web ke Pi (yang meneruskan ke ESP32) untuk mengotorisasi sesi charging, membawa: `sessionId`, `limitType`, `limitKwh`/`limitRp`/`limitSec`, dan parameter motor (vset, iset, ocp, otp, lvp dari Motor Profile terpilih).
- Firmware akan mengirim event balik (`session_complete`, status update per channel: IDLE/SELECT/CHARGING/DONE/FAULT/PAUSED) yang perlu diterima backend dan diteruskan ke frontend via WebSocket untuk live telemetry.
- Bila detail exact command/event format belum jelas dari kode yang ada, tanyakan ke saya sebelum mengasumsikan format komunikasi Pi↔backend — jangan menebak protokol yang belum didefinisikan.

## HAL YANG PERLU DIKONFIRMASI SEBELUM MULAI CODING

Sebelum mulai implementasi, mohon konfirmasi ke saya:
1. Apakah `schema.sql` sudah saya lampirkan? Jika belum, tunggu saya kirim dulu.
2. Format komunikasi API antara backend web dan Raspberry Pi (REST? MQTT? Serial gateway?) — jika belum saya jelaskan, tanyakan.
3. Ringkasan rencana struktur folder/repo sebelum mulai generate banyak file, supaya saya bisa validasi arahnya dulu.

Kerjakan secara bertahap (incremental) dan validasi tiap tahap dengan saya — jangan generate seluruh sistem sekaligus tanpa checkpoint.
