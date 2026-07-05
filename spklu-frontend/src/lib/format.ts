export const rupiah = (n: number) =>
  `Rp ${Math.round(n).toLocaleString('id-ID')}`;

export const kwh = (n: number) => `${n.toFixed(3)} kWh`;

export const duration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

// Tautan Google Maps ke titik koordinat SPKLU.
export const gmapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
