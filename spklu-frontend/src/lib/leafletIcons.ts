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
