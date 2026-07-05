import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, WalletCards, Users as UsersIcon, Activity, ChevronRight,
} from 'lucide-react';
import { api } from '../../lib/api';
import { rupiah, dateTime } from '../../lib/format';
import { Card, Badge, Button } from '../../components/ui';
import { CountUp } from '../../components/energy';
import { RevenueBars, Donut } from '../../components/charts';
import { useToast } from '../../components/overlay';
import { useTopic } from '../../lib/ws';
import { PageHeader } from './shared';
import type { Paged } from '../../lib/types';

interface Summary {
  revenue: number; approvedTopup: number; registeredUsers: number;
  activeSessions: number; pendingTopups: number;
  machines: { total: number; online: number };
}
interface TopupRow { id: number; amount: number; full_name: string; email: string; created_at: string }

const PERIODS = [
  { key: 'daily', label: 'Harian' },
  { key: 'weekly', label: 'Mingguan' },
  { key: 'monthly', label: 'Bulanan' },
] as const;

export default function Overview() {
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('daily');
  const [revenue, setRevenue] = useState<{ bucket: string; revenue: number }[]>([]);
  const [pending, setPending] = useState<TopupRow[]>([]);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const loadSummary = () => api.get<Summary>('/admin/metrics/summary').then(setSummary).catch(() => {});
  const loadPending = () =>
    api.get<Paged<TopupRow>>('/admin/topups?status=pending&limit=5').then((r) => setPending(r.data)).catch(() => {});

  useEffect(() => { loadSummary(); loadPending(); }, []);
  useEffect(() => {
    api.get<{ bucket: string; revenue: number }[]>(`/admin/metrics/revenue?period=${period}`)
      .then((rows) => setRevenue(rows.map((r) => ({ ...r, revenue: Number(r.revenue) || 0 }))))
      .catch(() => {});
  }, [period]);

  // Sesi/fault realtime memengaruhi angka overview.
  useTopic('admin', () => { loadSummary(); loadPending(); });

  const decide = async (id: number, action: 'approve' | 'reject') => {
    try {
      await api.post(`/admin/topups/${id}/${action}`, action === 'reject' ? { reason } : {});
      toast('ok', action === 'approve' ? 'Top-up disetujui, saldo user bertambah.' : 'Top-up ditolak.');
      setRejectId(null); setReason('');
      await Promise.all([loadSummary(), loadPending()]);
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal memproses');
    }
  };

  // Number() eksplisit: DECIMAL MySQL bisa tiba sebagai string — CountUp NaN tanpa ini.
  const stats = summary ? [
    { label: 'Total Pendapatan', value: Number(summary.revenue) || 0, prefix: 'Rp ', icon: Banknote, tint: 'bg-cmw-50 text-cmw-600' },
    { label: 'Top-Up Disetujui', value: Number(summary.approvedTopup) || 0, prefix: 'Rp ', icon: WalletCards, tint: 'bg-energy-50 text-energy-600' },
    { label: 'Pengguna Terdaftar', value: Number(summary.registeredUsers) || 0, prefix: '', icon: UsersIcon, tint: 'bg-sky-100 text-sky-500' },
    { label: 'Sesi Aktif', value: Number(summary.activeSessions) || 0, prefix: '', icon: Activity, tint: 'bg-amber-100 text-amber-700', live: true },
  ] : [];

  return (
    <div>
      <PageHeader title="Overview" sub="Denyut jaringan SPKLU Anda hari ini" />

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s, i) => (
          <Card key={s.label} className="rise-in" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="mb-3 flex items-center justify-between">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.tint}`}>
                <s.icon size={18} />
              </span>
              {s.live && <Badge tone="energy" pulse>Live</Badge>}
            </div>
            <p className="font-display text-[22px] font-extrabold leading-tight tabular">
              <CountUp value={s.value} prefix={s.prefix} />
            </p>
            <p className="mt-0.5 text-[12px] font-semibold text-ink-400">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Grafik pendapatan */}
        <Card className="rise-in xl:col-span-2" style={{ animationDelay: '200ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-bold">Pendapatan</h2>
            <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${period === p.key ? 'bg-white text-cmw-700 shadow-card' : 'text-ink-400'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <RevenueBars data={revenue} />
        </Card>

        {/* Kolom kanan */}
        <div className="flex flex-col gap-4">
          <Card className="rise-in" style={{ animationDelay: '260ms' }}>
            <h2 className="mb-4 font-display text-[15px] font-bold">Status Mesin</h2>
            {summary && (
              <Donut
                centerLabel="mesin"
                centerValue={String(summary.machines.total)}
                segments={[
                  { label: 'Online', value: summary.machines.online, color: '#10B981' },
                  { label: 'Offline', value: summary.machines.total - summary.machines.online, color: '#E4EBF3' },
                ]}
              />
            )}
          </Card>

          <Card className="rise-in" style={{ animationDelay: '320ms' }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-bold">Top-Up Menunggu</h2>
              <Link to="/admin/topup" className="inline-flex items-center text-[12.5px] font-bold text-cmw-600">
                Semua <ChevronRight size={14} />
              </Link>
            </div>
            {pending.length === 0 && (
              <p className="py-4 text-center text-[13px] text-ink-400">Tidak ada yang menunggu review.</p>
            )}
            <div className="flex flex-col gap-3">
              {pending.map((t) => (
                <div key={t.id} className="rounded-2xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold">{t.full_name}</p>
                      <p className="text-[11px] text-ink-400">{dateTime(t.created_at)}</p>
                    </div>
                    <p className="font-mono text-[13px] font-bold tabular">{rupiah(Number(t.amount))}</p>
                  </div>
                  {rejectId === t.id ? (
                    <div className="mt-2.5 flex gap-2">
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Alasan penolakan (wajib)"
                        className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-[12px] outline-none focus:border-danger-500"
                      />
                      <Button variant="danger" disabled={!reason.trim()} onClick={() => decide(t.id, 'reject')} className="!px-3 !py-2 !text-[12px]">
                        Tolak
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2.5 flex gap-2">
                      <Button variant="primary" onClick={() => decide(t.id, 'approve')} className="flex-1 !py-2 !text-[12px]">
                        Setujui
                      </Button>
                      <Button variant="ghost" onClick={() => setRejectId(t.id)} className="!py-2 !text-[12px] text-danger-500">
                        Tolak
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
