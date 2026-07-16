import { useEffect, useState, type FormEvent } from 'react';
import { WalletCards } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { rupiah, dateTime } from '../../lib/format';
import { Button, Card, Badge, Empty, Field } from '../../components/ui';
import { CountUp } from '../../components/energy';
import type { Paged } from '../../lib/types';

interface BalanceItem {
  id: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  note: string | null;
  created_at: string;
  kind: 'REQUEST' | 'ADMIN_TOPUP' | 'ADMIN_ADJUST';
}

const statusTone = { PENDING: 'amber', APPROVED: 'energy', REJECTED: 'danger' } as const;
const statusLabel = { PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak' } as const;

// Deskripsi tampilan per jenis entri riwayat saldo.
function describe(t: BalanceItem) {
  const amt = Number(t.amount);
  if (t.kind === 'ADMIN_TOPUP') {
    return {
      amountText: `+ ${rupiah(amt)}`, negative: false,
      typeLabel: 'Top-up oleh admin',
      badge: { tone: 'sky' as const, label: 'Admin', pulse: false },
      note: t.note,
    };
  }
  if (t.kind === 'ADMIN_ADJUST') {
    const positive = amt >= 0;
    return {
      amountText: `${positive ? '+' : '−'} ${rupiah(Math.abs(amt))}`, negative: !positive,
      typeLabel: 'Penyesuaian saldo (admin)',
      badge: { tone: (positive ? 'sky' : 'danger') as 'sky' | 'danger', label: 'Koreksi', pulse: false },
      note: t.note,
    };
  }
  // REQUEST
  const status = t.status ?? 'PENDING';
  return {
    amountText: rupiah(amt), negative: false,
    typeLabel: 'Permintaan top-up',
    badge: { tone: statusTone[status], label: statusLabel[status], pulse: status === 'PENDING' },
    note: status === 'REJECTED' && t.note ? `Alasan: ${t.note}` : null,
  };
}

export default function Wallet() {
  const { user, refresh } = useAuth();
  const [history, setHistory] = useState<BalanceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () =>
    api.get<Paged<BalanceItem>>('/user/balance-history').then((r) => setHistory(r.data)).catch(() => {});

  useEffect(() => { load(); }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    const amount = Number(new FormData(e.currentTarget).get('amount'));
    try {
      await api.post('/user/topups', { amount });
      setNotice('Permintaan terkirim. Transfer ke rekening operator, lalu tunggu verifikasi admin.');
      (e.target as HTMLFormElement).reset();
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim permintaan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="rise-in relative overflow-hidden rounded-card bg-grad-deep p-6 text-white shadow-raise">
        <div className="aurora right-[-30%] top-[-60%] h-64 w-64" style={{ background: 'rgba(16,185,129,0.3)' }} />
        <h1 className="text-[12px] font-bold uppercase tracking-wider text-white/85">Saldo aktif</h1>
        <p className="font-display text-[34px] font-extrabold leading-tight text-white">
          <CountUp value={Number(user?.balance ?? 0)} prefix="Rp " />
        </p>
      </section>

      <Card className="rise-in" style={{ animationDelay: '80ms' }}>
        <h2 className="mb-4 font-display text-[15px] font-bold">Ajukan top-up</h2>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Nominal (Rp)" name="amount" type="number" min={10000} step={1000} required
            placeholder="50000" hint="Minimal Rp 10.000 — transfer manual, diverifikasi admin."
            inputMode="numeric"
          />
          {error && <p className="rounded-control bg-danger-50 px-4 py-3 text-[13px] font-semibold text-danger-700" role="alert">{error}</p>}
          {notice && <p className="rounded-control bg-energy-50 px-4 py-3 text-[13px] font-semibold text-energy-700">{notice}</p>}
          <Button type="submit" loading={busy}>Kirim permintaan</Button>
        </form>
      </Card>

      <section className="rise-in" style={{ animationDelay: '160ms' }}>
        <h2 className="mb-3 font-display text-[15px] font-bold">Riwayat saldo</h2>
        {history.length === 0 ? (
          <Card>
            <Empty icon={<WalletCards size={26} />} title="Belum ada aktivitas saldo" body="Top-up dan penyesuaian saldo akan tampil di sini." />
          </Card>
        ) : (
          <div className="flex flex-col gap-2.5">
            {history.map((t) => {
              const d = describe(t);
              return (
                <Card key={t.id} className="flex items-center gap-3.5">
                  <div className="min-w-0 flex-1">
                    <p className={`font-mono text-sm font-bold tabular ${d.negative ? 'text-danger-700' : ''}`}>{d.amountText}</p>
                    <p className="text-xs text-ink-400">{d.typeLabel} · {dateTime(t.created_at)}</p>
                    {d.note && (
                      <p className={`mt-1 text-xs font-semibold ${t.status === 'REJECTED' ? 'text-danger-700' : 'text-ink-500'}`}>{d.note}</p>
                    )}
                  </div>
                  <Badge tone={d.badge.tone} pulse={d.badge.pulse}>{d.badge.label}</Badge>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
