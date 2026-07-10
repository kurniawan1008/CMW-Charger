// Peta interaktif untuk form Tambah/Edit Lokasi admin — klik atau geser
// marker mengisi lat/lng; search box (Nominatim) untuk lompat ke alamat.
import { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import type L from 'leaflet';
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
