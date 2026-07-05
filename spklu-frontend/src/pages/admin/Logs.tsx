import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { api } from '../../lib/api';
import { rupiah, dateTime } from '../../lib/format';
import { Badge } from '../../components/ui';
import { PageHeader, Table, Pager } from './shared';
import type { Paged } from '../../lib/types';

interface LogRow {
  id: string; status: string; end_reason: string | null; billing_type: 'PAYMENT' | 'TRIAL';
  consumed_kwh: number; total_cost: number | null; start_time: string;
  full_name: string | null; station_name: string | null; machine_name: string | null;
  device_ch: number | null; brand: string | null; model: string | null;
}
interface StationOpt { id: number; name: string }

const statusMeta: Record<string, { tone: 'energy' | 'sky' | 'danger' | 'neutral'; label: string }> = {
  COMPLETED: { tone: 'energy', label: 'Selesai' },
  ACTIVE: { tone: 'sky', label: 'Berjalan' },
  STOPPED: { tone: 'neutral', label: 'Dihentikan' },
  FAULT: { tone: 'danger', label: 'Gangguan' },
};

export default function Logs() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<LogRow> | null>(null);
  const [stations, setStations] = useState<StationOpt[]>([]);
  const [f, setF] = useState({ location: '', status: '', billing: '', from: '', to: '' });

  useEffect(() => {
    api.get<Paged<StationOpt>>('/admin/locations?limit=100').then((r) => setStations(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: '15' });
    for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
    api.get<Paged<LogRow>>(`/admin/transactions?${params}`).then(setResult).catch(() => {});
  }, [page, f]);

  useEffect(() => { setPage(1); }, [f]);

  const sel = 'rounded-control border border-line bg-white px-3 py-2.5 text-[12.5px] font-semibold outline-none focus:border-cmw-500';

  return (
    <div>
      <PageHeader
        title="Log Transaksi"
        sub="Seluruh sesi charging — sesi TRIAL (mesin mode offline) ditandai jelas, tanpa billing"
      />

      <div className="mb-4 flex flex-wrap gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="sr-only">Filter lokasi</span>
          <select className={sel} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
            <option value="">Semua lokasi</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <select aria-label="Filter status" className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Semua status</option>
          <option value="completed">Selesai</option>
          <option value="active">Berjalan</option>
          <option value="stopped">Dihentikan</option>
          <option value="fault">Gangguan</option>
        </select>
        <select aria-label="Filter billing" className={sel} value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value })}>
          <option value="">Payment + Trial</option>
          <option value="payment">Payment saja</option>
          <option value="trial">Trial saja</option>
        </select>
        <input aria-label="Dari tanggal" type="date" className={sel} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <input aria-label="Sampai tanggal" type="date" className={sel} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </div>

      <Table head={['Sesi', 'Pengguna', 'Lokasi / Mesin', 'Motor', 'Energi', 'Biaya', 'Status', 'Waktu']}>
        {result?.data.map((s) => {
          const meta = statusMeta[s.status] ?? statusMeta.STOPPED;
          const trial = s.billing_type === 'TRIAL';
          return (
            <tr key={s.id} className={`transition-colors hover:bg-surface-sunken/50 ${trial ? 'bg-amber-100/20' : ''}`}>
              <td className="px-4 py-3">
                <p className="font-mono text-[11.5px] font-bold">{s.id}</p>
                {trial && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-700">
                    <FlaskConical size={10} /> Trial
                  </span>
                )}
              </td>
              <td className="px-4 py-3 font-semibold">
                {s.full_name || <span className="italic text-ink-300">Tanpa user</span>}
              </td>
              <td className="px-4 py-3">
                <p className="text-ink-600">{s.station_name || '—'}</p>
                <p className="text-[11px] text-ink-400">{s.machine_name || ''}{s.device_ch ? ` · CH ${s.device_ch}` : ''}</p>
              </td>
              <td className="px-4 py-3 text-ink-600">{s.brand ? `${s.brand} ${s.model}` : '—'}</td>
              <td className="px-4 py-3 font-mono tabular">{Number(s.consumed_kwh).toFixed(3)} kWh</td>
              <td className="px-4 py-3 font-mono font-bold tabular">
                {trial ? <span className="font-sans text-[11px] font-semibold text-ink-300">non-billing</span> : rupiah(Number(s.total_cost ?? 0))}
              </td>
              <td className="px-4 py-3"><Badge tone={meta.tone} pulse={s.status === 'ACTIVE'}>{meta.label}</Badge></td>
              <td className="px-4 py-3 text-[12px] text-ink-400">{dateTime(s.start_time)}</td>
            </tr>
          );
        })}
      </Table>
      {result && <Pager page={result.page} totalPages={result.totalPages} onPage={setPage} />}
    </div>
  );
}
