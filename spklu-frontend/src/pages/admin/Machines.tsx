import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Info, Cpu } from 'lucide-react';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Button, Field, Badge } from '../../components/ui';
import { Modal, useToast } from '../../components/overlay';
import { PageHeader, SearchBox, Table, Pager, useDebounced } from './shared';
import type { Paged } from '../../lib/types';

interface MachineRow {
  id: number; name: string; station_id: number | null; station_name: string | null;
  mode: 'ONLINE' | 'OFFLINE'; online: number; last_seen_at: string | null;
  fw_info: string | null; channel_count: number;
}
interface StationOpt { id: number; name: string }

export default function Machines() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<MachineRow> | null>(null);
  const [stations, setStations] = useState<StationOpt[]>([]);
  const [editing, setEditing] = useState<MachineRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<Paged<MachineRow>>(`/admin/machines?search=${encodeURIComponent(q)}&page=${page}&limit=10`)
      .then(setResult).catch(() => {});

  useEffect(() => { load(); }, [q, page]);
  useEffect(() => { setPage(1); }, [q]); // reset halaman saat mencari (audit H3)
  useEffect(() => {
    api.get<Paged<StationOpt>>('/admin/locations?limit=100').then((r) => setStations(r.data)).catch(() => {});
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      if (editing === 'new') {
        await api.post('/admin/machines', {
          name: f.get('name'),
          deviceKey: f.get('deviceKey'),
          stationId: Number(f.get('stationId')) || null,
          channels: Number(f.get('channels')) || 3,
        });
        toast('ok', 'Mesin ditambahkan beserta channel-nya.');
      } else if (editing) {
        await api.patch(`/admin/machines/${editing.id}`, {
          name: f.get('name'),
          stationId: Number(f.get('stationId')) || null,
        });
        toast('ok', 'Mesin diperbarui.');
      }
      setEditing(null);
      await load();
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally { setBusy(false); }
  };

  const cur = editing !== 'new' && editing ? editing : null;

  return (
    <div>
      <PageHeader
        title="Manajemen Mesin"
        sub="Maks 3 channel & 7 kW per mesin (batas hardware) · mode diatur di firmware"
        icon={<Cpu size={20} />}
        action={<Button onClick={() => setEditing('new')}><Plus size={15} /> Tambah mesin</Button>}
      />
      <div className="mb-4"><SearchBox value={search} onChange={setSearch} placeholder="Cari nama mesin…" /></div>

      <Table head={['Mesin', 'Lokasi', 'Koneksi', 'Mode', 'Channel', 'Firmware', 'Terakhir aktif', '']}>
        {result?.data.map((m) => (
          <tr key={m.id} className="transition-colors hover:bg-surface-sunken/50">
            <td className="px-4 py-3 font-bold">{m.name}</td>
            <td className="px-4 py-3 text-ink-600">{m.station_name || <span className="text-ink-300">Belum ditempatkan</span>}</td>
            <td className="px-4 py-3">
              {m.online
                ? <Badge tone="energy" pulse>Online</Badge>
                : <Badge tone="neutral">Offline</Badge>}
            </td>
            <td className="px-4 py-3">
              {/* Read-only: mode dikendalikan firmware/hardware, bukan web */}
              <Badge tone={m.mode === 'ONLINE' ? 'blue' : 'amber'}>
                {m.mode === 'ONLINE' ? 'Payment' : 'Trial/Offline'}
              </Badge>
            </td>
            <td className="px-4 py-3 font-mono font-bold tabular">{m.channel_count}/3</td>
            <td className="px-4 py-3 font-mono text-[11.5px] text-ink-400">{m.fw_info || '—'}</td>
            <td className="px-4 py-3 text-[12px] text-ink-400">{m.last_seen_at ? dateTime(m.last_seen_at) : '—'}</td>
            <td className="px-4 py-3 text-right">
              <button
                onClick={() => setEditing(m)}
                aria-label={`Edit ${m.name}`}
                className="cursor-pointer rounded-lg p-2 text-ink-400 transition-colors hover:bg-cmw-50 hover:text-cmw-600"
              >
                <Pencil size={15} />
              </button>
            </td>
          </tr>
        ))}
      </Table>
      {result && <Pager page={result.page} totalPages={result.totalPages} onPage={setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Tambah mesin' : 'Edit mesin'}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Nama mesin" name="name" required defaultValue={cur?.name} placeholder="CMW Charger #02" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mch-station" className="text-[13px] font-bold text-ink-700">Lokasi penempatan</label>
            <select
              id="mch-station" name="stationId" defaultValue={cur?.station_id ?? ''}
              className="rounded-control border border-line bg-white px-4 py-3 text-sm font-medium outline-none focus:border-cmw-500"
            >
              <option value="">— Belum ditempatkan —</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {editing === 'new' ? (
            <>
              <Field
                label="Device key" name="deviceKey" required
                hint="Rahasia bersama untuk autentikasi gateway Pi — samakan dengan SPKLU_DEVICE_KEY di Pi."
              />
              <Field label="Jumlah channel" name="channels" type="number" min={1} max={3} defaultValue={3} hint="Maksimal 3 (batas hardware)." />
            </>
          ) : (
            <div className="flex items-start gap-2.5 rounded-2xl bg-sky-100/60 p-3.5 text-[12.5px] leading-relaxed text-ink-600">
              <Info size={15} className="mt-0.5 shrink-0 text-sky-500" />
              Mode operasi (Payment/Trial) dan status koneksi hanya-baca — diatur dari
              firmware mesin, bukan dari dashboard.
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Batal</Button>
            <Button type="submit" loading={busy}>{editing === 'new' ? 'Tambah' : 'Simpan'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
