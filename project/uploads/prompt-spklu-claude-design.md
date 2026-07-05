# PROMPT: Desain Dashboard Admin & User — Web Payment System SPKLU

## KONTEKS

Ini adalah desain visual/prototipe untuk web payment system SPKLU (stasiun pengisian kendaraan listrik umum). Sistem punya dua dashboard: **Admin** dan **User**, yang harus terasa senada satu sama lain (satu design system, satu bahasa visual) meski peruntukannya berbeda.

Fokus sesi ini murni pada desain visual, layout, komponen UI, dan interaksi/motion — bukan logika backend.

## HIERARKI DATA (konteks untuk struktur UI)

- **Lokasi SPKLU → Mesin → Channel** (maksimal 3 channel per mesin)
- Dari sisi **admin**: hierarki ini terlihat penuh (lokasi, mesin, channel semua eksplisit)
- Dari sisi **user**: mesin disembunyikan. User hanya melihat **Lokasi → Channel** secara flat. Channel punya label unik per lokasi, auto-generate lintas mesin (contoh: "Charger 1" sampai "Charger 6" ditampilkan sebagai daftar flat, tanpa user tahu itu berasal dari mesin mana)
- Setiap channel punya status yang perlu direpresentasikan visual jelas: **available / in-use / fault / offline**

## DASHBOARD ADMIN — Halaman & Fitur

### Overview / Home
- Total pendapatan (dengan grafik: filter harian/mingguan/bulanan, filter rentang tanggal, filter per lokasi)
- Total top-up (nilai top-up yang sudah diapprove)
- Total pengguna terdaftar
- Sesi aktif saat ini (real-time)
- Quick stats tambahan yang relevan (mesin online/offline, top-up pending yang butuh review, dsb)

### Monitor per Lokasi SPKLU
- Daftar/CRUD lokasi (tambah, edit, nonaktifkan)
- Detail per lokasi: daftar mesin di lokasi tsb, status masing-masing, statistik pendapatan/sesi per lokasi

### Manajemen Mesin
- Tambah/edit mesin (info general: nama, lokasi, identifier — bukan parameter teknis)
- Info per mesin: status online/offline, **mode operasi (offline/payment) — read-only badge**, jumlah channel, kondisi tiap channel (idle/charging/fault/done/paused)
- Ringkasan: total lokasi, total mesin, mesin online, breakdown mode payment vs offline

### Manajemen Channel
- Detail tiap channel (maks 3 per mesin): status, sesi berjalan (jika ada), riwayat sesi

### Motor Profiles
- CRUD merk/model motor kendaraan listrik beserta parameter charging (admin input spek, ini hanya untuk keperluan tampilan form — tidak perlu render angka teknisnya di desain, cukup struktur form)

### Top-Up Requests
- Daftar request top-up dari user (status: pending/approved/rejected)
- Detail request: bukti transfer (upload), nominal, user terkait
- Aksi approve/reject dengan alasan

### Log Transaksi (Admin)
- Riwayat sesi charging (payment maupun offline/trial)
- Filter: lokasi, mesin, channel, user, rentang tanggal, status
- Sesi offline/trial ditandai visual berbeda dari sesi payment (badge/warna berbeda, karena tanpa data billing)

### Manajemen User
- Daftar user terdaftar, saldo, riwayat aktivitas

## DASHBOARD USER — Halaman & Alur

### Alur Charging (wizard, urutan tetap — ini bagian paling penting untuk didesain sebagai flow interaktif)
1. Login
2. Pilih lokasi SPKLU (daftar lokasi aktif, info alamat)
3. Pilih channel yang tersedia di lokasi tsb (daftar flat "Charger 1, 2, 3...", status available/in-use terlihat jelas dari warna/badge)
4. Pilih merk/model motor dari daftar Motor Profiles aktif
5. Set jumlah pengisian — user pilih target **kWh** atau **Rupiah**, input nominal
6. Konfirmasi — tampilkan ringkasan sebelum mulai (cek saldo cukup)
7. **Live telemetry** selama charging: tegangan, arus, daya, energi terpakai (kWh berjalan), estimasi biaya berjalan, durasi, progress terhadap limit — ini titik paling penting untuk motion (angka count-up smooth, progress indicator visual hidup)
8. Ringkasan setelah sesi selesai: total kWh, total biaya, durasi, status akhir

### Fitur Lain
- **Saldo & Top-Up**: lihat saldo, request top-up manual (upload bukti transfer, input nominal), riwayat status top-up
- **Log Transaksi (User)**: riwayat sesi charging milik sendiri, detail per sesi
- **Profil**: edit data akun, ubah password
- Fitur relevan lain yang wajar (lokasi favorit, riwayat merk motor yang sering dipakai, dll)

## ARAHAN DESAIN UI/UX

Bangun ini sebagai pengalaman premium yang terasa hidup dan terpadu, bukan sekadar dashboard fungsional biasa.

**Cinematic Website OS** — seluruh dashboard (admin maupun user) harus terasa seperti satu sistem operasi yang utuh dan imersif, bukan kumpulan halaman terpisah yang di-reload. Transisi antar halaman/section mulus.

**Motion & Interaction** — ini pilar utama, bukan tambahan kosmetik:
- Micro-interactions di setiap elemen interaktif (hover states, klik, loading states)
- Animasi angka pada live telemetry (count-up smooth, bukan angka yang tiba-tiba berubah)
- Animasi visual untuk status charging (progress ring, wave/pulse animation saat proses berjalan)
- Transisi halaman yang halus, terasa seperti navigasi di dalam satu aplikasi

**Luxury Landing Page / Premium Design System** — tipografi kelas atas, whitespace lega, konsistensi visual antar semua halaman. Dashboard admin dan user harus terasa "senada" (satu design system) meski peruntukannya berbeda.

**Tema warna**: Light mode sebagai basis (putih/off-white cerah), dengan aksen warna **biru dan biru langit**, dikombinasikan dengan **sentuhan hijau** — mengesankan clean-energy/tech tanpa terasa flat atau generik. Gunakan gradient dan kontras yang cukup untuk kesan premium.

**Complete Website Builder** — hasil akhir harus terasa seperti produk jadi/production-ready, bukan prototipe atau MVP kasar.

## OUTPUT YANG DIHARAPKAN

Mulai dengan prototipe untuk:
1. Dashboard Admin — halaman Overview/Home
2. Dashboard User — alur wizard charging (langkah 3, 5, dan 7 terutama, karena paling representatif untuk motion & interaction)

Setelah pola visual dan motion-nya solid di dua titik ini, lanjutkan ke halaman-halaman lain mengikuti design system yang sama.
