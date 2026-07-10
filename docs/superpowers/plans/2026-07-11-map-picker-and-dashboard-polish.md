# Map Picker + Dashboard Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti input Latitude/Longitude manual di admin dengan peta
interaktif (Leaflet/OSM), tambah visualisasi peta di dashboard user, lalu
perkaya kedalaman visual 9 halaman admin panel — tanpa mengubah kontrak
API, palet warna, atau struktur navigasi yang sudah ada.

**Architecture:** Tiga komponen peta baru dan reusable
(`LocationMapPicker` interaktif untuk form admin, `LocationMiniMap` statis
ringan untuk kartu, `LocationsOverviewMap` interaktif multi-pin untuk
wizard user) dibangun di atas `react-leaflet` + tile OpenStreetMap. Polish
visual dikerjakan di titik sentral (`components/ui.tsx`,
`pages/admin/shared.tsx`) supaya perbaikan menyebar ke semua 9 halaman
admin tanpa duplikasi kode, plus penambahan slot ikon di `PageHeader` yang
diisi satu baris per halaman.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS, `react-leaflet` v5 +
`leaflet` (peta), Nominatim (geocoding gratis, tanpa API key).

## Global Constraints

- Peta: Leaflet + tile OpenStreetMap, TANPA API key/billing (dari spec).
- Search alamat pakai Nominatim (`nominatim.openstreetmap.org`), gratis.
- Palet warna (`ink`/`cmw`/`sky`/`energy`/`amber`/`danger`), font
  (`Sora`/`Plus Jakarta Sans`/`JetBrains Mono`), radius (`rounded-card`/
  `rounded-control`), dan struktur navigasi TIDAK BOLEH berubah — polish
  visual hanya memakai token yang sudah ada di `tailwind.config.js`.
- Kontrak data API (bentuk request/response `lat`/`lng` sebagai number)
  TIDAK BOLEH berubah — hanya cara input/tampil di UI yang berubah.
- Setiap task frontend WAJIB lolos `npm run build` (dari
  `spklu-frontend/`) sebelum commit — ini gate utama karena TypeScript
  strict + Vite build adalah satu-satunya "test" yang tersedia untuk
  proyek frontend ini (tidak ada test runner terpisah).
- Bagian A (map picker) dikerjakan tuntas dulu, baru lanjut Bagian B
  (polish visual admin) — sesuai urutan yang disetujui user.

---

## File Structure

- Create: `spklu-frontend/src/lib/leafletIcons.ts` — fix marker icon
  default Leaflet yang rusak oleh bundler.
- Create: `spklu-frontend/src/components/LocationMapPicker.tsx` — peta
  interaktif untuk form Tambah/Edit Lokasi admin.
- Create: `spklu-frontend/src/components/LocationMiniMap.tsx` — peta
  statis kecil untuk kartu lokasi di wizard user.
- Create: `spklu-frontend/src/components/LocationsOverviewMap.tsx` — peta
  besar multi-pin untuk wizard user langkah 1.
- Modify: `spklu-frontend/package.json` — tambah `leaflet`,
  `react-leaflet`, `@types/leaflet`.
- Modify: `spklu-frontend/src/index.css` — import `leaflet.css`.
- Modify: `spklu-frontend/src/pages/admin/Locations.tsx` — integrasi
  `LocationMapPicker` ke form modal.
- Modify: `spklu-frontend/src/pages/user/Wizard.tsx` — integrasi
  `LocationMiniMap` per kartu + `LocationsOverviewMap` di atas daftar.
- Modify: `spklu-frontend/src/components/ui.tsx` — polish `Card` (hover-
  lift) dan `Badge` (glow saat `pulse`).
- Modify: `spklu-frontend/src/pages/admin/shared.tsx` — polish `Table`
  (row hover-lift) dan `PageHeader` (slot ikon dengan aksen gradient).
- Modify (9 file, satu baris tiap file): `Overview.tsx`, `Locations.tsx`,
  `Machines.tsx`, `Channels.tsx`, `Motors.tsx`, `Topups.tsx`, `Users.tsx`,
  `Admins.tsx`, `Logs.tsx` — tambah prop `icon` ke pemanggilan
  `<PageHeader>`.
- Modify: `spklu-frontend/src/pages/admin/Overview.tsx` — aksen gradient
  di kartu statistik.

---

## Bagian A — Map Picker

### Task 1: Install Leaflet + fix marker icon default

**Files:**
- Modify: `spklu-frontend/package.json`
- Create: `spklu-frontend/src/lib/leafletIcons.ts`
- Modify: `spklu-frontend/src/index.css`

**Interfaces:**
- Produces: side-effect import `'../lib/leafletIcons'` — WAJIB di-import
  sekali oleh setiap komponen peta baru (Task 2 & 4) sebelum render
  `<MapContainer>`, supaya ikon marker default Leaflet tidak pecah (bug
  umum: bundler seperti Vite tidak resolve path relatif internal Leaflet
  untuk file gambar marker).

- [ ] **Step 1: Install dependency**

Run (dari `spklu-frontend/`):
```bash
npm install leaflet@^1.9.4 react-leaflet@^5.0.0
npm install -D @types/leaflet@^1.9.8
```
Expected: `package.json` `dependencies` dapat `leaflet`, `react-leaflet`;
`devDependencies` dapat `@types/leaflet`.

- [ ] **Step 2: Buat fix marker icon**

Buat file baru `spklu-frontend/src/lib/leafletIcons.ts`:

```typescript
// Fix bug umum Leaflet+bundler: path default marker icon Leaflet
// mengandalkan resolusi relatif yang tidak dipahami Vite, menghasilkan
// marker rusak (gambar hilang). Import module ini SEKALI (side-effect)
// di setiap komponen yang render <MapContainer>, sebelum render pertama.
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});
```

- [ ] **Step 3: Import CSS Leaflet**

Edit `spklu-frontend/src/index.css`, tambahkan baris import di paling atas
file (sebelum `@import url('https://fonts.googleapis.com/...')` yang
sudah ada):

```css
@import 'leaflet/dist/leaflet.css';
```

- [ ] **Step 4: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: build sukses tanpa error (belum ada komponen yang memakai
Leaflet, jadi ini hanya verifikasi dependency & CSS ter-resolve).

- [ ] **Step 5: Commit**

```bash
git add spklu-frontend/package.json spklu-frontend/package-lock.json spklu-frontend/src/lib/leafletIcons.ts spklu-frontend/src/index.css
git commit -m "Frontend: install Leaflet + fix marker icon default untuk map picker"
```

---

### Task 2: Komponen `LocationMapPicker` (peta interaktif untuk form admin)

**Files:**
- Create: `spklu-frontend/src/components/LocationMapPicker.tsx`

**Interfaces:**
- Consumes: `'../lib/leafletIcons'` (Task 1, side-effect import).
- Produces: `LocationMapPicker({ lat, lng, onChange }: { lat: number;
  lng: number; onChange: (lat: number, lng: number) => void }):
  JSX.Element` — dipakai Task 3 di `Locations.tsx`.

- [ ] **Step 1: Tulis komponen**

Buat file baru `spklu-frontend/src/components/LocationMapPicker.tsx`:

```tsx
// Peta interaktif untuk form Tambah/Edit Lokasi admin — klik atau geser
// marker mengisi lat/lng; search box (Nominatim) untuk lompat ke alamat.
import { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import { Search } from 'lucide-react';
import '../lib/leafletIcons';

interface LocationMapPickerProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}

function ClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Terpisah dari komponen utama supaya useMap() hanya dipanggil saat
// benar-benar perlu fly-to (setelah hasil search alamat), bukan tiap render.
function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  map.flyTo([lat, lng], 15, { duration: 0.6 });
  return null;
}

export function LocationMapPicker({ lat, lng, onChange }: LocationMapPickerProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      );
      const rows: { lat: string; lon: string }[] = await res.json();
      if (rows[0]) {
        const newLat = Number(rows[0].lat);
        const newLng = Number(rows[0].lon);
        onChange(newLat, newLng);
        setFlyTarget({ lat: newLat, lng: newLng });
      }
    } catch {
      // Search alamat murni kenyamanan — field lat/lng manual tetap ada
      // sebagai fallback kalau Nominatim gagal/timeout.
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="col-span-2 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          placeholder="Cari alamat / nama tempat…"
          className="min-w-0 flex-1 rounded-control border border-line bg-white px-4 py-2.5 text-[13px] font-medium outline-none transition-colors focus:border-cmw-500 focus:ring-2 focus:ring-cmw-100"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="flex items-center gap-1.5 rounded-control bg-cmw-50 px-3.5 py-2.5 text-[12.5px] font-bold text-cmw-700 transition-colors hover:bg-cmw-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Search size={14} /> {searching ? 'Mencari…' : 'Cari'}
        </button>
      </div>
      <div className="h-64 overflow-hidden rounded-2xl border border-line">
        <MapContainer center={[lat, lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={[lat, lng]}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const m = (e.target as L.Marker).getLatLng();
                onChange(m.lat, m.lng);
              },
            }}
          />
          <ClickHandler onChange={onChange} />
          {flyTarget && <FlyTo lat={flyTarget.lat} lng={flyTarget.lng} />}
        </MapContainer>
      </div>
      <p className="text-[11px] text-ink-400">Klik peta atau geser marker untuk pilih titik lokasi.</p>
    </div>
  );
}
```

Catatan: `L` (namespace `leaflet`) dipakai di tipe `(e.target as
L.Marker)` — tambahkan `import type L from 'leaflet';` di baris import
kalau TypeScript menolak referensi `L.Marker` tanpa import eksplisit
(cek saat build di Step 2; `LeafletMouseEvent` sudah diimpor terpisah).

- [ ] **Step 2: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses. Kalau ada error TS soal referensi tipe `L.Marker`,
tambahkan `import type L from 'leaflet';` ke bagian atas file (lihat
catatan Step 1) lalu build ulang.

- [ ] **Step 3: Commit**

```bash
git add spklu-frontend/src/components/LocationMapPicker.tsx
git commit -m "Frontend: komponen LocationMapPicker (peta interaktif form admin)"
```

---

### Task 3: Integrasi `LocationMapPicker` ke form Tambah/Edit Lokasi

**Files:**
- Modify: `spklu-frontend/src/pages/admin/Locations.tsx`

**Interfaces:**
- Consumes: `LocationMapPicker` (Task 2).

- [ ] **Step 1: Tambah state lat/lng terkontrol**

Edit `spklu-frontend/src/pages/admin/Locations.tsx`. Tambahkan import di
baris 1-8 (setelah baris `import type { Paged } from '../../lib/types';`):

```typescript
import { LocationMapPicker } from '../../components/LocationMapPicker';
```

Cari baris:
```typescript
  const cur = editing !== 'new' && editing ? editing : null;
```

Ganti dengan (tambah state lat/lng terkontrol + reset saat modal
dibuka/lokasi berganti):

```typescript
  const cur = editing !== 'new' && editing ? editing : null;
  const [lat, setLat] = useState(cur?.lat ?? -6.2088); // default: Jakarta
  const [lng, setLng] = useState(cur?.lng ?? 106.8456);

  useEffect(() => {
    if (editing !== null) {
      setLat(cur?.lat ?? -6.2088);
      setLng(cur?.lng ?? 106.8456);
    }
  }, [editing]);
```

(`useState`/`useEffect` sudah diimpor di baris 1 file ini — tidak perlu
tambahan import untuk hook.)

- [ ] **Step 2: Ganti field lat/lng manual jadi terkontrol + tambah peta**

Cari baris di dalam form:
```tsx
          <Field label="Latitude" name="lat" type="number" step="any" required defaultValue={cur?.lat} hint="Contoh: -6.2249350" />
          <Field label="Longitude" name="lng" type="number" step="any" required defaultValue={cur?.lng} hint="Contoh: 106.8092040" />
```

Ganti dengan (field jadi terkontrol dua-arah dengan peta, plus peta itu
sendiri):

```tsx
          <LocationMapPicker lat={lat} lng={lng} onChange={(newLat, newLng) => { setLat(newLat); setLng(newLng); }} />
          <Field
            label="Latitude" name="lat" type="number" step="any" required
            value={lat} onChange={(e) => setLat(Number(e.target.value) || 0)}
            hint="Klik peta di atas, atau ketik manual"
          />
          <Field
            label="Longitude" name="lng" type="number" step="any" required
            value={lng} onChange={(e) => setLng(Number(e.target.value) || 0)}
            hint="Klik peta di atas, atau ketik manual"
          />
```

- [ ] **Step 3: Update submit supaya baca dari state, bukan FormData**

Cari baris di fungsi `submit`:
```typescript
    const body = {
      name: f.get('name'), address: f.get('address'), city: f.get('city'),
      lat: Number(f.get('lat')), lng: Number(f.get('lng')),
      power_kw: Number(f.get('power_kw')) || 7, hours: f.get('hours') || '24 Jam',
      ...(editing !== 'new' ? { status: f.get('status') } : {}),
    };
```

Ganti `lat: Number(f.get('lat')), lng: Number(f.get('lng')),` dengan
`lat, lng,` (pakai state langsung — field lat/lng sekarang terkontrol,
`f.get('lat')` masih ada di DOM tapi state adalah sumber kebenaran):

```typescript
    const body = {
      name: f.get('name'), address: f.get('address'), city: f.get('city'),
      lat, lng,
      power_kw: Number(f.get('power_kw')) || 7, hours: f.get('hours') || '24 Jam',
      ...(editing !== 'new' ? { status: f.get('status') } : {}),
    };
```

- [ ] **Step 4: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses tanpa error TypeScript.

- [ ] **Step 5: Verifikasi manual di browser**

Jalankan dev server (`npm run dev` dari `spklu-frontend/`, backend +
MySQL lokal harus jalan — lihat `DEPLOY.md`/riwayat setup lokal untuk
langkahnya). Login admin, buka `/admin/locations`, klik "Tambah lokasi":
1. Peta muncul ter-center default (Jakarta), field lat/lng terisi
   default.
2. Klik titik lain di peta → marker pindah, field lat/lng ikut berubah.
3. Ketik nama tempat di search box (mis. "Monas Jakarta"), tekan Enter
   atau klik "Cari" → peta fly-to ke lokasi tersebut, marker &amp; field
   ikut update.
4. Ketik angka manual di field lat/lng → tidak error (peta tidak wajib
   ikut geser real-time untuk edit manual, itu boleh — field tetap
   tersimpan saat submit).
5. Isi nama/alamat/kota, submit → toast sukses, lokasi baru muncul di
   tabel dengan koordinat yang benar (cek kolom "Maps" link mengarah ke
   titik yang benar).
6. Klik "Edit" di lokasi yang sudah ada → peta buka ter-center di
   koordinat tersimpan lokasi itu (bukan default Jakarta).

Laporkan hasil checklist ke user/controller sebelum lanjut Task 4.

- [ ] **Step 6: Commit**

```bash
git add spklu-frontend/src/pages/admin/Locations.tsx
git commit -m "Frontend: integrasikan LocationMapPicker ke form Tambah/Edit Lokasi"
```

---

### Task 4: Komponen `LocationMiniMap` + `LocationsOverviewMap` (dashboard user)

**Files:**
- Create: `spklu-frontend/src/components/LocationMiniMap.tsx`
- Create: `spklu-frontend/src/components/LocationsOverviewMap.tsx`

**Interfaces:**
- Consumes: `'../lib/leafletIcons'` (Task 1); `Location` type dari
  `../lib/types` (field `id: number; name: string; lat: number; lng:
  number`, sudah ada).
- Produces: `LocationMiniMap({ lat, lng }: { lat: number; lng: number }):
  JSX.Element`; `LocationsOverviewMap({ locations, onSelectPin }: {
  locations: Location[]; onSelectPin: (id: number) => void }):
  JSX.Element | null` — keduanya dipakai Task 5 di `Wizard.tsx`.

- [ ] **Step 1: Tulis `LocationMiniMap`**

Buat file baru `spklu-frontend/src/components/LocationMiniMap.tsx`:

```tsx
// Peta statis kecil untuk kartu lokasi di wizard user — non-interaktif
// (zoom/drag/scroll dimatikan) supaya ringan & tidak mengganggu scroll
// halaman, murni untuk konteks visual posisi.
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import '../lib/leafletIcons';

export function LocationMiniMap({ lat, lng }: { lat: number; lng: number }) {
  return (
    <div className="h-24 w-full overflow-hidden rounded-xl border border-line">
      <MapContainer
        center={[lat, lng]}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={[lat, lng]} />
      </MapContainer>
    </div>
  );
}
```

- [ ] **Step 2: Tulis `LocationsOverviewMap`**

Buat file baru `spklu-frontend/src/components/LocationsOverviewMap.tsx`:

```tsx
// Peta besar interaktif menampilkan semua lokasi charging sebagai pin —
// dipakai di atas daftar kartu wizard user langkah "Pilih Lokasi". Klik
// pin memanggil onSelectPin supaya halaman bisa scroll ke kartu terkait.
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import '../lib/leafletIcons';
import type { Location } from '../lib/types';

export function LocationsOverviewMap({
  locations, onSelectPin,
}: { locations: Location[]; onSelectPin: (id: number) => void }) {
  const valid = locations.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
  if (!valid.length) return null;
  const center: [number, number] = [valid[0].lat, valid[0].lng];

  return (
    <div className="mb-3 h-48 w-full overflow-hidden rounded-2xl border border-line">
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {valid.map((loc) => (
          <Marker
            key={loc.id}
            position={[loc.lat, loc.lng]}
            eventHandlers={{ click: () => onSelectPin(loc.id) }}
          >
            <Popup>{loc.name}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
```

- [ ] **Step 3: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses.

- [ ] **Step 4: Commit**

```bash
git add spklu-frontend/src/components/LocationMiniMap.tsx spklu-frontend/src/components/LocationsOverviewMap.tsx
git commit -m "Frontend: komponen LocationMiniMap + LocationsOverviewMap untuk wizard user"
```

---

### Task 5: Integrasi peta ke wizard user (langkah 1: Pilih Lokasi)

**Files:**
- Modify: `spklu-frontend/src/pages/user/Wizard.tsx`

**Interfaces:**
- Consumes: `LocationMiniMap`, `LocationsOverviewMap` (Task 4).

- [ ] **Step 1: Tambah import + ref per kartu untuk scroll-to**

Edit `spklu-frontend/src/pages/user/Wizard.tsx`. Tambahkan import setelah
baris `import type { Charger, Location, MotorProfile, SessionFinal,
SessionTick } from '../../lib/types';`:

```typescript
import { LocationMiniMap } from '../../components/LocationMiniMap';
import { LocationsOverviewMap } from '../../components/LocationsOverviewMap';
```

Cari deklarasi state di dekat awal komponen (area `useState` untuk
`locations`/`selLocation` — nama variabel state locations sudah ada di
file, cari `locations.map((loc, i) =>` untuk menemukan scope komponen
yang tepat). Tambahkan di scope yang sama (dalam function component,
sebelum `return`):

```typescript
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const scrollToLocation = (id: number) => {
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
```

(`useRef` sudah diimpor di baris 3 file ini: `import { useEffect,
useMemo, useRef, useState } from 'react';` — tidak perlu tambahan.)

- [ ] **Step 2: Sisipkan `LocationsOverviewMap` + ref di tiap kartu + `LocationMiniMap`**

Cari blok `{/* ===== 1. Lokasi ===== */}`:
```tsx
          {step === 1 && (
            <div className="flex flex-col gap-2.5">
              {locations.map((loc, i) => (
```

Ganti jadi (tambah `LocationsOverviewMap` sebelum daftar kartu):

```tsx
          {step === 1 && (
            <div className="flex flex-col gap-2.5">
              <LocationsOverviewMap locations={locations} onSelectPin={scrollToLocation} />
              {locations.map((loc, i) => (
```

Cari baris pembuka kartu (elemen `div role="button"`):
```tsx
                <div
                  key={loc.id}
                  role="button"
                  tabIndex={loc.status === 'OFFLINE' ? -1 : 0}
```

Tambahkan `ref` (React memerlukan callback ref, bukan objek biasa, karena
menyimpan banyak elemen dalam satu map):

```tsx
                <div
                  key={loc.id}
                  ref={(el) => { cardRefs.current[loc.id] = el; }}
                  role="button"
                  tabIndex={loc.status === 'OFFLINE' ? -1 : 0}
```

Cari baris dalam kartu (setelah link "Lihat di Maps", sebelum penutup
`</div>` dari `<div className="min-w-0 flex-1">`):
```tsx
                      <a
                        href={gmapsUrl(loc.lat, loc.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1.5 inline-flex min-h-[32px] items-center gap-1 rounded-full bg-cmw-50 px-3 py-1.5 text-[11px] font-bold text-cmw-600 transition-colors hover:bg-cmw-100"
                      >
                        <ExternalLink size={11} /> Lihat di Maps
                      </a>
                    </div>
```

Ganti jadi (tambah `LocationMiniMap` di bawah link Maps, di dalam kartu):

```tsx
                      <a
                        href={gmapsUrl(loc.lat, loc.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1.5 inline-flex min-h-[32px] items-center gap-1 rounded-full bg-cmw-50 px-3 py-1.5 text-[11px] font-bold text-cmw-600 transition-colors hover:bg-cmw-100"
                      >
                        <ExternalLink size={11} /> Lihat di Maps
                      </a>
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <LocationMiniMap lat={loc.lat} lng={loc.lng} />
                      </div>
                    </div>
```

(`onClick={(e) => e.stopPropagation()}` mencegah klik di mini-map ikut
memicu navigasi kartu ke langkah berikutnya, sama seperti perlakuan link
Maps di atasnya.)

- [ ] **Step 3: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses tanpa error TypeScript.

- [ ] **Step 4: Verifikasi manual di browser**

Login user, buka wizard charging (langkah "Pilih Lokasi"):
1. Peta besar muncul di atas daftar kartu, menampilkan pin semua lokasi.
2. Tiap kartu lokasi punya mini-map kecil menunjukkan posisinya
   (non-interaktif, tidak bisa di-drag/zoom).
3. Klik pin di peta besar → halaman scroll halus ke kartu lokasi yang
   sesuai.
4. Klik mini-map di dalam kartu → TIDAK memicu navigasi ke langkah
   berikutnya (klik di-serap oleh mini-map, bukan diteruskan ke kartu).
5. Klik area lain di kartu (bukan mini-map/link Maps) → tetap lanjut ke
   langkah 2 seperti sebelumnya (perilaku lama tidak rusak).
6. Tombol "Lihat di Maps" tetap membuka Google Maps eksternal seperti
   sebelumnya.

Laporkan hasil checklist ke user/controller.

- [ ] **Step 5: Commit**

```bash
git add spklu-frontend/src/pages/user/Wizard.tsx
git commit -m "Frontend: tampilkan peta visual (mini-map + overview) di wizard user"
```

---

## Bagian B — Polish Visual Admin Panel

### Task 6: Polish primitif `Card` + `Badge` (components/ui.tsx)

**Files:**
- Modify: `spklu-frontend/src/components/ui.tsx`

**Interfaces:**
- Produces: `Card` dengan hover-lift (className tambahan, prop tidak
  berubah); `Badge` dengan glow tipis saat `pulse={true}` (prop tidak
  berubah) — dipakai otomatis oleh SEMUA halaman yang sudah memakai kedua
  komponen ini (tidak perlu ubah call-site).

- [ ] **Step 1: Baca `Card` saat ini untuk tahu className persis**

Baca `spklu-frontend/src/components/ui.tsx`, cari `export function Card`.

- [ ] **Step 2: Tambah hover-lift ke `Card`**

Cari baris (kira-kira):
```tsx
export function Card({ className = '', children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-card bg-white p-5 shadow-card ${className}`} {...props}>
      {children}
    </div>
  );
}
```

Ganti baris `className` di dalam `<div>` (bagian dalam template literal
saja, bukan signature fungsi) jadi:
```tsx
    <div className={`rounded-card bg-white p-5 shadow-card transition-all duration-200 hover:shadow-raise hover:-translate-y-0.5 ${className}`} {...props}>
```

(Kalau struktur/nama variabel sedikit beda dari kutipan di atas saat kamu
baca file sebenarnya, terapkan perubahan yang SAMA — tambah
`transition-all duration-200 hover:shadow-raise hover:-translate-y-0.5`
ke className dasar `Card`, pertahankan urutan class Tailwind lain yang
sudah ada.)

- [ ] **Step 3: Tambah glow ke `Badge` saat `pulse`**

Cari `export function Badge`. Cari bagian yang merender `<span>` dengan
class `animate-pulse` atau sejenis (dipicu prop `pulse`). Tambahkan
`shadow-[0_0_0_4px_rgba(16,185,129,0.12)]` ke className kondisional saat
`pulse` true (efek glow tipis warna energy/hijau, konsisten dengan makna
"live" yang sudah dipakai `pulse` di codebase ini — misal status
CHARGING/ONLINE). Contoh pola (sesuaikan dengan struktur asli yang kamu
baca):

```tsx
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${tones[tone]} ${pulse ? 'animate-pulse shadow-[0_0_0_4px_rgba(16,185,129,0.12)]' : ''}`}
```

- [ ] **Step 4: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses.

- [ ] **Step 5: Verifikasi manual di browser**

Buka halaman admin manapun yang pakai `Card` (mis. `/admin` Overview) —
hover kartu statistik harus terangkat halus dengan shadow lebih tebal.
Buka halaman dengan `Badge pulse` (mis. Overview "Sesi Aktif", atau
Channels status CHARGING) — badge harus punya glow tipis di sekelilingnya
saat pulsing.

- [ ] **Step 6: Commit**

```bash
git add spklu-frontend/src/components/ui.tsx
git commit -m "Frontend: hover-lift Card + glow Badge pulse (polish visual lintas halaman)"
```

---

### Task 7: Polish primitif `Table` + `PageHeader` (pages/admin/shared.tsx)

**Files:**
- Modify: `spklu-frontend/src/pages/admin/shared.tsx`

**Interfaces:**
- Consumes: tidak ada baru.
- Produces: `Table` dengan row hover-lift (tidak ada perubahan API);
  `PageHeader` dapat prop BARU opsional `icon?: ReactNode` — kalau
  disediakan, dirender sebagai badge ikon dengan aksen gradient di
  samping judul. Dipakai Task 8 (9 halaman admin).

- [ ] **Step 1: Tambah hover-lift ke baris `Table`**

Edit `spklu-frontend/src/pages/admin/shared.tsx`. Baris tabel individual
DIRENDER OLEH TIAP HALAMAN (bukan di dalam komponen `Table` shared ini —
`Table` cuma bungkus `<table>`/`<thead>`, baris `<tr>` datang dari
`children` yang di-pass tiap halaman). Jadi hover-lift baris sudah ada
secara konsisten via class `transition-colors hover:bg-surface-sunken/50`
yang SUDAH dipakai tiap halaman (lihat pola di `Channels.tsx`,
`Locations.tsx`, dll — TIDAK PERLU diubah, sudah konsisten). Task ini
fokus HANYA ke penambahan slot ikon `PageHeader` (Step 2) — lewati
perubahan pada fungsi `Table` itu sendiri.

- [ ] **Step 2: Tambah prop `icon` ke `PageHeader`**

Cari:
```tsx
export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-ink-400">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
```

Ganti seluruhnya dengan:

```tsx
export function PageHeader({ title, sub, action, icon }: {
  title: string; sub?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-grad-deep text-white shadow-glow">
            {icon}
          </span>
        )}
        <div>
          <h1 className="font-display text-[22px] font-extrabold tracking-tight">{title}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-ink-400">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
```

(`bg-grad-deep` dan `shadow-glow` sudah didefinisikan di
`tailwind.config.js` — tidak perlu tambahan token baru.)

- [ ] **Step 3: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses. Prop `icon` opsional — halaman yang belum diupdate
(Task 8 belum jalan) tetap render normal tanpa badge ikon.

- [ ] **Step 4: Commit**

```bash
git add spklu-frontend/src/pages/admin/shared.tsx
git commit -m "Frontend: tambah slot ikon gradient di PageHeader"
```

---

### Task 8: Terapkan ikon `PageHeader` di 9 halaman admin

**Files:**
- Modify: `spklu-frontend/src/pages/admin/Overview.tsx`
- Modify: `spklu-frontend/src/pages/admin/Locations.tsx`
- Modify: `spklu-frontend/src/pages/admin/Machines.tsx`
- Modify: `spklu-frontend/src/pages/admin/Channels.tsx`
- Modify: `spklu-frontend/src/pages/admin/Motors.tsx`
- Modify: `spklu-frontend/src/pages/admin/Topups.tsx`
- Modify: `spklu-frontend/src/pages/admin/Users.tsx`
- Modify: `spklu-frontend/src/pages/admin/Admins.tsx`
- Modify: `spklu-frontend/src/pages/admin/Logs.tsx`

**Interfaces:**
- Consumes: `PageHeader` prop `icon` (Task 7).

- [ ] **Step 1: Overview.tsx**

Import `Activity` sudah ada di baris `import { Banknote, WalletCards,
Users as UsersIcon, Activity, ChevronRight } from 'lucide-react';` — tidak
perlu tambahan import. Cari:
```tsx
      <PageHeader title="Overview" sub="Denyut jaringan SPKLU Anda hari ini" />
```
Ganti:
```tsx
      <PageHeader title="Overview" sub="Denyut jaringan SPKLU Anda hari ini" icon={<Activity size={20} />} />
```

- [ ] **Step 2: Locations.tsx**

Edit import baris 2, dari:
```typescript
import { Plus, Pencil, ExternalLink } from 'lucide-react';
```
jadi:
```typescript
import { Plus, Pencil, ExternalLink, MapPin } from 'lucide-react';
```
Cari `<PageHeader` (sekitar baris 59), tambahkan prop `icon`:
```tsx
      <PageHeader
        title="Lokasi SPKLU"
        sub="Kelola titik stasiun — koordinat dipakai untuk tautan Maps di aplikasi user"
        icon={<MapPin size={20} />}
        action={
```

- [ ] **Step 3: Machines.tsx**

Baca file untuk konfirmasi nama import lucide existing (`Plus, Pencil,
Info`). Tambahkan `Cpu` ke daftar import lucide-react. Cari `<PageHeader`
di file, tambahkan prop `icon={<Cpu size={20} />}` di objek prop-nya
(pola sama seperti Step 2 — sisipkan sebagai prop baru, jangan hapus prop
lain yang sudah ada).

- [ ] **Step 4: Channels.tsx**

Import `Wrench` sudah ada. Cari `<PageHeader` (sekitar baris 52), tambah
`icon={<Wrench size={20} />}`.

- [ ] **Step 5: Motors.tsx**

Import `Zap` sudah ada. Cari `<PageHeader` (sekitar baris 58), tambah
`icon={<Zap size={20} />}`.

- [ ] **Step 6: Topups.tsx**

Baca file, tambahkan import `WalletCards` dari `lucide-react` (baris
import saat ini tidak punya import lucide-react sama sekali — tambahkan
baris baru `import { WalletCards } from 'lucide-react';` setelah baris
`import { api } from '../../lib/api';`). Cari:
```tsx
      <PageHeader
        title="Top-Up Requests"
        sub="Verifikasi manual: cocokkan nominal dengan mutasi rekening sebelum menyetujui"
      />
```
Ganti:
```tsx
      <PageHeader
        title="Top-Up Requests"
        sub="Verifikasi manual: cocokkan nominal dengan mutasi rekening sebelum menyetujui"
        icon={<WalletCards size={20} />}
      />
```

- [ ] **Step 7: Users.tsx**

Tambahkan import `Users as UsersIcon` dari `lucide-react` (baris import
saat ini tidak punya import lucide-react — tambahkan baris baru `import
{ Users as UsersIcon } from 'lucide-react';` setelah baris `import { api
} from '../../lib/api';`). Cari:
```tsx
      <PageHeader title="Pengguna" sub="Daftar akun user, saldo, dan aktivitasnya" />
```
Ganti:
```tsx
      <PageHeader title="Pengguna" sub="Daftar akun user, saldo, dan aktivitasnya" icon={<UsersIcon size={20} />} />
```

- [ ] **Step 8: Admins.tsx**

Import `ShieldCheck` sudah ada. Cari `<PageHeader` (sekitar baris 44),
tambah `icon={<ShieldCheck size={20} />}`.

- [ ] **Step 9: Logs.tsx**

Import `FlaskConical` sudah ada. Cari `<PageHeader` (sekitar baris 46),
tambah `icon={<FlaskConical size={20} />}`.

- [ ] **Step 10: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses tanpa error TypeScript (semua import lucide-react baru
harus benar-benar dipakai — kalau ada warning unused import dari linter,
pastikan prop `icon` benar-benar disisipkan di JSX, bukan cuma
diimpor).

- [ ] **Step 11: Verifikasi manual di browser**

Buka tiap satu dari 9 halaman admin — pastikan badge ikon gradient
(`bg-grad-deep`, biru-ke-sky-ke-hijau) muncul di kiri judul halaman,
konsisten posisinya di semua halaman.

- [ ] **Step 12: Commit**

```bash
git add spklu-frontend/src/pages/admin/Overview.tsx spklu-frontend/src/pages/admin/Locations.tsx spklu-frontend/src/pages/admin/Machines.tsx spklu-frontend/src/pages/admin/Channels.tsx spklu-frontend/src/pages/admin/Motors.tsx spklu-frontend/src/pages/admin/Topups.tsx spklu-frontend/src/pages/admin/Users.tsx spklu-frontend/src/pages/admin/Admins.tsx spklu-frontend/src/pages/admin/Logs.tsx
git commit -m "Frontend: terapkan ikon gradient PageHeader di 9 halaman admin"
```

---

### Task 9: Aksen gradient di kartu statistik Overview

**Files:**
- Modify: `spklu-frontend/src/pages/admin/Overview.tsx`

**Interfaces:**
- Consumes: token `grad-energy`/`grad-deep` (sudah ada di
  `tailwind.config.js`, tidak ada perubahan token).

- [ ] **Step 1: Tambah garis aksen gradient di atas tiap kartu statistik**

Cari blok (di dalam `.map((s, i) => (...))` kartu statistik):
```tsx
          <Card key={s.label} className="rise-in" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="mb-3 flex items-center justify-between">
```

Ganti jadi (tambah `relative overflow-hidden` ke `Card` supaya garis
aksen absolut di dalamnya tidak keluar dari radius kartu, dan sisipkan
elemen garis aksen sebagai child pertama):

```tsx
          <Card key={s.label} className="rise-in relative overflow-hidden" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="absolute inset-x-0 top-0 h-1 bg-grad-energy" />
            <div className="mb-3 flex items-center justify-between">
```

- [ ] **Step 2: Verifikasi build**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses.

- [ ] **Step 3: Verifikasi manual di browser**

Buka `/admin` (Overview) — tiap kartu statistik (4 kartu di baris atas)
punya garis tipis gradient biru-ke-hijau di tepi atasnya.

- [ ] **Step 4: Commit**

```bash
git add spklu-frontend/src/pages/admin/Overview.tsx
git commit -m "Frontend: aksen garis gradient di kartu statistik Overview"
```

---

### Task 10: Verifikasi akhir lintas 9 halaman admin

**Files:** tidak ada file baru — verifikasi visual menyeluruh.

- [ ] **Step 1: `npm run build` final**

Run (dari `spklu-frontend/`): `npm run build`
Expected: sukses tanpa error/warning TypeScript baru.

- [ ] **Step 2: Screenshot tiap halaman admin (9 halaman)**

Jalankan `npm run dev`, buka satu per satu: Overview, Locations,
Machines, Channels, Motors, Topups, Users, Admins, Logs. Untuk tiap
halaman, konfirmasi:
- Badge ikon gradient muncul di `PageHeader`, konsisten posisinya.
- Hover di kartu (`Card`) manapun (Overview stat cards, dll) terasa
  terangkat halus.
- Badge status dengan `pulse` (CHARGING/ONLINE/Live) punya glow tipis.
- Tidak ada regresi kontras teks (baca judul/label di semua halaman
  masih jelas terbaca di atas background masing-masing).
- Tidak ada breaking layout di lebar mobile (resize browser ke ~375px,
  cek tabel/kartu tidak overflow horizontal aneh — kalau sudah ada
  masalah scroll horizontal SEBELUM task ini, itu bukan regresi baru,
  cukup pastikan tidak lebih buruk).

Laporkan hasil ke user/controller — sertakan halaman mana saja yang
sudah dicek dan hasilnya.

- [ ] **Step 3: Tidak ada commit di step ini** — task ini murni
  verifikasi; semua perubahan kode sudah di-commit di task-task
  sebelumnya.
