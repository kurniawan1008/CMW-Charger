import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical, PlugZap } from 'lucide-react';
import { api } from '../../lib/api';
import { useTopic } from '../../lib/ws';
import { rupiah, dateTime, duration } from '../../lib/format';
import { Badge, Card } from '../../components/ui';
import { Modal } from '../../components/overlay';
import { CountUp } from '../../components/energy';
import { PageHeader, Table, Pager } from './shared';
import type { Paged, SessionTick } from '../../lib/types';

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
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<LogRow> | null>(null);
  const [stations, setStations] = useState<StationOpt[]>([]);
  // Deep-link dari kartu "Sesi Aktif" Overview (?status=active) mengisi filter awal.
  const [f, setF] = useState({ location: '', status: searchParams.get('status') || '', billing: '', from: '', to: '' });
  const [live, setLive] = useState<LogRow | null>(null);
  const [tick, setTick] = useState<SessionTick | null>(null);

  useEffect(() => {
    api.get<Paged<StationOpt>>('/admin/locations?limit=100').then((r) => setStations(r.data)).catch(() => {});
  }, []);

  useTopic(live ? `session.${live.id}` : null, (data) => setTick(data as SessionTick));
  useEffect(() => { setTick(null); }, [live?.id]);

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
        icon={<FlaskConical size={20} />}
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
          const isLive = s.status === 'ACTIVE';
          return (
            <tr
              key={s.id}
              onClick={isLive ? () => setLive(s) : undefined}
              className={`transition-colors hover:bg-surface-sunken/50 ${trial ? 'bg-amber-100/20' : ''} ${isLive ? 'cursor-pointer' : ''}`}
            >
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

      {/* Live telemetry — subscribe session.{id} selama modal terbuka (audit revisi #5) */}
      <Modal open={live !== null} onClose={() => setLive(null)} title="Live Telemetry">
        {live && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-2xl border border-line p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
                <PlugZap size={18} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{live.full_name || 'Tanpa user'}</p>
                <p className="truncate text-[12px] text-ink-400">
                  {live.station_name || '—'}{live.device_ch ? ` · CH ${live.device_ch}` : ''}
                  {live.brand ? ` · ${live.brand} ${live.model}` : ''}
                </p>
              </div>
              <Badge tone="sky" pulse className="ml-auto shrink-0">Live</Badge>
            </div>

            {!tick ? (
              <p className="py-8 text-center text-[13px] text-ink-400">Menunggu data telemetry…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Energi', <CountUp key="e" value={tick.energy} decimals={3} suffix=" kWh" />],
                  ['Daya', <CountUp key="p" value={tick.power} decimals={2} suffix=" kW" />],
                  ['Tegangan', <CountUp key="v" value={tick.voltage} decimals={1} suffix=" V" />],
                  ['Arus', <CountUp key="c" value={tick.current} decimals={2} suffix=" A" />],
                  ['Biaya berjalan', <CountUp key="cost" value={tick.cost} prefix="Rp " />],
                  ['Durasi', duration(tick.elapsed)],
                ].map(([k, v]) => (
                  <Card key={k as string} className="!p-3.5">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-400">{k}</p>
                    <p className="mt-1 font-display text-[16px] font-extrabold tabular">{v}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
