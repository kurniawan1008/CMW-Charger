import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, ExternalLink, MapPin } from 'lucide-react';
import { api } from '../../lib/api';
import { gmapsUrl } from '../../lib/format';
import { Button, Field, Badge } from '../../components/ui';
import { Modal, useToast } from '../../components/overlay';
import { PageHeader, SearchBox, Table, Pager, useDebounced } from './shared';
import type { Paged } from '../../lib/types';
import { LocationMapPicker } from '../../components/LocationMapPicker';

interface StationRow {
  id: number; name: string; address: string; city: string;
  lat: number; lng: number; status: 'ONLINE' | 'BUSY' | 'OFFLINE';
  power_kw: number; type: string; hours: string; machine_count: number;
}

const statusTone = { ONLINE: 'energy', BUSY: 'amber', OFFLINE: 'neutral' } as const;

export default function Locations() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<StationRow> | null>(null);
  const [editing, setEditing] = useState<StationRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<Paged<StationRow>>(`/admin/locations?search=${encodeURIComponent(q)}&page=${page}&limit=10`)
      .then(setResult).catch(() => {});

  useEffect(() => { load(); }, [q, page]);
  useEffect(() => { setPage(1); }, [q]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get('name'), address: f.get('address'), city: f.get('city'),
      lat, lng,
      power_kw: Number(f.get('power_kw')) || 7, hours: f.get('hours') || '24 Jam',
      ...(editing !== 'new' ? { status: f.get('status') } : {}),
    };
    try {
      if (editing === 'new') await api.post('/admin/locations', body);
      else if (editing) await api.patch(`/admin/locations/${editing.id}`, body);
      toast('ok', editing === 'new' ? 'Lokasi ditambahkan.' : 'Lokasi diperbarui.');
      setEditing(null);
      await load();
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally { setBusy(false); }
  };

  const cur = editing !== 'new' && editing ? editing : null;
  const [lat, setLat] = useState(cur?.lat ?? -6.2088); // default: Jakarta
  const [lng, setLng] = useState(cur?.lng ?? 106.8456);

  useEffect(() => {
    if (editing !== null) {
      setLat(cur?.lat ?? -6.2088);
      setLng(cur?.lng ?? 106.8456);
    }
  }, [editing]);

  return (
    <div>
      <PageHeader
        title="Lokasi SPKLU"
        sub="Kelola titik stasiun — koordinat dipakai untuk tautan Maps di aplikasi user"
        icon={<MapPin size={20} />}
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus size={15} /> Tambah lokasi
          </Button>
        }
      />
      <div className="mb-4"><SearchBox value={search} onChange={setSearch} placeholder="Cari nama / kota…" /></div>

      <Table head={['Nama', 'Kota', 'Status', 'Mesin', 'Daya', 'Jam', 'Titik', '']}>
        {result?.data.map((s) => (
          <tr key={s.id} className="transition-colors hover:bg-surface-sunken/50">
            <td className="px-4 py-3">
              <p className="font-bold">{s.name}</p>
              <p className="text-[11.5px] text-ink-400">{s.address}</p>
            </td>
            <td className="px-4 py-3 font-semibold">{s.city}</td>
            <td className="px-4 py-3"><Badge tone={statusTone[s.status]}>{s.status}</Badge></td>
            <td className="px-4 py-3 font-mono font-bold tabular">{s.machine_count}</td>
            <td className="px-4 py-3 font-mono tabular">{s.power_kw} kW</td>
            <td className="px-4 py-3 text-ink-600">{s.hours}</td>
            <td className="px-4 py-3">
              <a
                href={gmapsUrl(s.lat, s.lng)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-bold text-cmw-600 hover:underline"
              >
                <ExternalLink size={12} /> Maps
              </a>
            </td>
            <td className="px-4 py-3 text-right">
              <button
                onClick={() => setEditing(s)}
                aria-label={`Edit ${s.name}`}
                className="cursor-pointer rounded-lg p-2 text-ink-400 transition-colors hover:bg-cmw-50 hover:text-cmw-600"
              >
                <Pencil size={15} />
              </button>
            </td>
          </tr>
        ))}
      </Table>
      {result && <Pager page={result.page} totalPages={result.totalPages} onPage={setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Tambah lokasi' : 'Edit lokasi'} wide>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Nama lokasi" name="name" required defaultValue={cur?.name} placeholder="CMW SPKLU …" /></div>
          <div className="col-span-2"><Field label="Alamat" name="address" required defaultValue={cur?.address} /></div>
          <Field label="Kota" name="city" required defaultValue={cur?.city} />
          {cur && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="loc-status" className="text-[13px] font-bold text-ink-700">Status</label>
              <select
                id="loc-status" name="status" defaultValue={cur.status}
                className="rounded-control border border-line bg-white px-4 py-3 text-sm font-medium outline-none focus:border-cmw-500"
              >
                <option value="ONLINE">ONLINE</option>
                <option value="BUSY">BUSY</option>
                <option value="OFFLINE">OFFLINE (nonaktif)</option>
              </select>
            </div>
          )}
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
          <Field label="Daya (kW)" name="power_kw" type="number" defaultValue={cur?.power_kw ?? 7} />
          <Field label="Jam operasional" name="hours" defaultValue={cur?.hours ?? '24 Jam'} />
          <div className="col-span-2 mt-1 flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Batal</Button>
            <Button type="submit" loading={busy}>{editing === 'new' ? 'Tambah' : 'Simpan'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
