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
