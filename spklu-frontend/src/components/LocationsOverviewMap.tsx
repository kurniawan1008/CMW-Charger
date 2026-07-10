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
