# Map Picker + Dashboard Visual Polish — Design Spec

## Context

Dua permintaan independen dari user:

1. Form "Edit Lokasi" / "Tambah Lokasi" di admin panel mewajibkan input
   Latitude/Longitude manual (contoh: `-6,224935` / `106,809204`) — dinilai
   terlalu ribet dan rawan salah ketik.
2. Tampilan visual dashboard admin (9 halaman) dan dashboard user (wizard
   charging) dinilai "terlalu sederhana" — perlu dipercantik tanpa mengubah
   identitas visual (biru/sky/hijau, sistem desain "Arus" yang sudah ada di
   `tailwind.config.js`).

Selama diskusi, scope map picker diperluas: peta juga harus tampil visual
di dashboard user (bukan cuma tombol "Lihat di Maps" yang buka Google Maps
eksternal seperti sekarang).

## Bagian A — Map Picker (Leaflet + OpenStreetMap)

**Provider:** Leaflet + tile OpenStreetMap. Tanpa API key, tanpa billing.
Search alamat pakai Nominatim (OSM geocoding, gratis, rate-limit wajar
untuk penggunaan admin-only).

**Admin — form Tambah/Edit Lokasi** (`spklu-frontend/src/pages/admin/Locations.tsx`
atau file setara — dikonfirmasi saat implementasi):
- Peta interaktif menggantikan/mendampingi field Latitude/Longitude manual.
- Klik di peta → marker muncul/pindah → field lat/long terisi otomatis.
- Search box alamat di atas peta (Nominatim) — submit → peta pan+zoom ke
  hasil pertama, marker pindah ke situ.
- Field lat/long tetap ada di form (read-only atau tetap editable sebagai
  fallback presisi manual), disinkronkan dua arah dengan posisi marker.
- Mode edit (lokasi sudah ada koordinatnya): peta buka ter-center di
  marker posisi tersimpan.

**User — wizard charging, Langkah 1 (Pilih Lokasi)**
(`spklu-frontend/src/pages/user/Wizard.tsx` step lokasi):
- **Mini-map thumbnail** di tiap kartu lokasi — peta statis kecil (non-
  interaktif atau interaksi minimal) menampilkan posisi lokasi tersebut.
  Tetap ringan, tidak mengubah struktur list yang sudah ada.
- **Peta besar interaktif** di atas daftar kartu — menampilkan semua
  lokasi charging sebagai pin sekaligus. Klik pin → scroll/highlight ke
  kartu lokasi terkait di bawahnya.
- Tombol "Lihat di Maps" (buka Google Maps eksternal untuk navigasi) tetap
  dipertahankan — peta di dalam app untuk **visualisasi**, bukan pengganti
  navigasi turn-by-turn.

**Dependency baru:** `leaflet` + `react-leaflet` (frontend only, tidak ada
perubahan backend — data lat/long yang dikirim/diterima API tidak berubah
bentuk, cuma cara input/tampilnya yang berubah).

## Bagian B — Polish Visual Dashboard (Admin lalu User)

Prinsip: **perkaya, jangan ganti total.** Palet warna (`ink`/`cmw`/`sky`/
`energy`/`amber`/`danger`), font (`Sora`/`Plus Jakarta Sans`/`JetBrains
Mono`), radius, dan struktur navigasi TETAP — fokus menambah kedalaman
visual pakai token yang sudah didefinisikan tapi under-used di halaman
aktual.

**Perubahan per elemen (berlaku lintas halaman):**
- Kartu & baris tabel: shadow `card`/`raise` lebih terasa (saat ini
  banyak elemen flat tanpa shadow), radius konsisten `rounded-card`,
  hover-lift halus (`transition + translate-y kecil + shadow naik`).
- Header halaman: aksen gradient tipis (`bg-grad-deep`/`bg-grad-energy`)
  di elemen kunci (background icon container, garis aksen atas kartu
  metrik) — bukan full-page background, tetap clean.
- Badge status: tone system (`energy`/`sky`/`danger`/`amber`) yang sudah
  ada diperkuat dengan efek `pulse`/glow tipis khusus status "live"
  (CHARGING, ONLINE) — komponen `Badge` sudah punya prop `pulse`, perluas
  pemakaiannya secara konsisten di semua halaman yang menampilkan status.
- Angka metrik (Overview & kartu ringkasan lain): pakai komponen
  `CountUp` yang sudah ada secara konsisten; grafik pakai gradient fill
  (bukan garis polos) mengikuti `grad-energy`.
- Spacing: padding kartu/tabel yang terasa sempit dilonggarkan mengikuti
  skala spacing Tailwind yang konsisten.
- Empty & loading state: audit semua halaman, pastikan pakai skeleton/
  shimmer konsisten (bukan blank/spinner generik) di mana belum ada.

**Urutan:**
1. Map picker (Bagian A) — dikerjakan sampai selesai dulu.
2. Langsung lanjut tanpa jeda: polish visual admin panel (9 halaman).
3. Setelah admin selesai & di-review user: polish visual dashboard user
   (wizard + shell) sebagai batch terpisah (fase berikutnya, di luar scope
   plan implementasi pertama).

**Di luar scope (fase ini):** rebrand warna/font baru, dark mode, redesain
struktur navigasi/IA, perubahan bentuk data API.

## Testing

- Map picker: verifikasi manual di preview browser — klik peta mengisi
  lat/long, search alamat pan+zoom benar, submit form menyimpan koordinat
  yang sama seperti sebelumnya (tidak mengubah kontrak API).
- Polish visual: verifikasi manual screenshot per halaman admin sebelum/
  sesudah, pastikan tidak ada regresi kontras (WCAG AA, mengacu ke catatan
  audit H2/H3 yang sudah ada di `tailwind.config.js`) dan tidak ada
  breaking layout di lebar mobile.
