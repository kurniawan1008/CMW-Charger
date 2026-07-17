import { useEffect, useState } from 'react';
import { WalletCards } from 'lucide-react';
import { api } from '../../lib/api';
import { rupiah, dateTime } from '../../lib/format';
import { Button, Badge } from '../../components/ui';
import { Modal, useToast } from '../../components/overlay';
import { PageHeader, Table, Pager } from './shared';
import type { Paged } from '../../lib/types';

interface TopupRow {
  id: number; amount: number; status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string | null; created_at: string; decided_at: string | null;
  full_name: string; email: string;
}
interface AdminActionRow {
  id: number; amount: number; type: 'ADMIN_TOPUP' | 'ADMIN_ADJUST';
  description: string | null; created_at: string;
  full_name: string; email: string; admin_name: string | null;
}

const FILTERS = [
  { key: '', label: 'Semua' },
  { key: 'pending', label: 'Menunggu' },
  { key: 'approved', label: 'Disetujui' },
  { key: 'rejected', label: 'Ditolak' },
  { key: 'admin', label: 'Aksi Admin' },
];
const tone = { PENDING: 'amber', APPROVED: 'energy', REJECTED: 'danger' } as const;
const label = { PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak' } as const;

export default function Topups() {
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<TopupRow> | null>(null);
  const [adminResult, setAdminResult] = useState<Paged<AdminActionRow> | null>(null);
  const [rejecting, setRejecting] = useState<TopupRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const isAdminTab = filter === 'admin';

  const load = () => {
    if (isAdminTab) {
      api.get<Paged<AdminActionRow>>(`/admin/balance-actions?page=${page}&limit=12`)
        .then(setAdminResult).catch(() => {});
    } else {
      api.get<Paged<TopupRow>>(`/admin/topups?status=${filter}&page=${page}&limit=12`)
        .then(setResult).catch(() => {});
    }
  };

  useEffect(() => { load(); }, [filter, page]);
  useEffect(() => { setPage(1); }, [filter]);

  const approve = async (t: TopupRow) => {
    try {
      await api.post(`/admin/topups/${t.id}/approve`);
      toast('ok', `Top-up ${rupiah(Number(t.amount))} milik ${t.full_name} disetujui.`);
      await load();
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal approve');
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await api.post(`/admin/topups/${rejecting.id}/reject`, { reason });
      toast('ok', 'Top-up ditolak, user mendapat notifikasi alasannya.');
      setRejecting(null); setReason('');
      await load();
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal menolak');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        title="Top-Up Requests"
        sub="Verifikasi manual: cocokkan nominal dengan mutasi rekening sebelum menyetujui"
        icon={<WalletCards size={20} />}
      />

      <div className="mb-4 flex gap-1 rounded-xl bg-surface-sunken p-1" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`cursor-pointer rounded-lg px-4 py-2 text-[12.5px] font-bold transition-all ${filter === f.key ? 'bg-white text-cmw-700 shadow-card' : 'text-ink-400'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isAdminTab ? (
        <>
          <Table head={['Pengguna', 'Nominal', 'Jenis', 'Catatan / Alasan', 'Oleh Admin', 'Waktu']}>
            {adminResult?.data.map((a) => {
              const amt = Number(a.amount);
              const positive = amt >= 0;
              return (
                <tr key={a.id} className="transition-colors hover:bg-surface-sunken/50">
                  <td className="px-4 py-3">
                    <p className="font-bold">{a.full_name}</p>
                    <p className="text-[11.5px] text-ink-400">{a.email}</p>
                  </td>
                  <td className={`px-4 py-3 font-mono text-[14px] font-bold tabular ${positive ? '' : 'text-danger-700'}`}>
                    {positive ? '+ ' : '− '}{rupiah(Math.abs(amt))}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={a.type === 'ADMIN_TOPUP' ? 'sky' : positive ? 'sky' : 'danger'}>
                      {a.type === 'ADMIN_TOPUP' ? 'Top-up langsung' : 'Rebalancing'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-ink-600">{a.description || '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-600">{a.admin_name || '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-400">{dateTime(a.created_at)}</td>
                </tr>
              );
            })}
          </Table>
          {adminResult && <Pager page={adminResult.page} totalPages={adminResult.totalPages} onPage={setPage} />}
        </>
      ) : (
        <>
          <Table head={['Pengguna', 'Nominal', 'Diajukan', 'Status', 'Keputusan', '']}>
            {result?.data.map((t) => (
              <tr key={t.id} className="transition-colors hover:bg-surface-sunken/50">
                <td className="px-4 py-3">
                  <p className="font-bold">{t.full_name}</p>
                  <p className="text-[11.5px] text-ink-400">{t.email}</p>
                </td>
                <td className="px-4 py-3 font-mono text-[14px] font-bold tabular">{rupiah(Number(t.amount))}</td>
                <td className="px-4 py-3 text-[12px] text-ink-400">{dateTime(t.created_at)}</td>
                <td className="px-4 py-3">
                  <Badge tone={tone[t.status]} pulse={t.status === 'PENDING'}>{label[t.status]}</Badge>
                  {t.status === 'REJECTED' && t.reason && (
                    <p className="mt-1 max-w-[220px] text-[11px] text-danger-700">{t.reason}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px] text-ink-400">{t.decided_at ? dateTime(t.decided_at) : '—'}</td>
                <td className="px-4 py-3">
                  {t.status === 'PENDING' && (
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => approve(t)} className="!px-3.5 !py-2 !text-[12px]">Setujui</Button>
                      <Button variant="danger" onClick={() => setRejecting(t)} className="!px-3.5 !py-2 !text-[12px]">Tolak</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {result && <Pager page={result.page} totalPages={result.totalPages} onPage={setPage} />}
        </>
      )}

      <Modal open={rejecting !== null} onClose={() => { setRejecting(null); setReason(''); }} title="Tolak top-up">
        <p className="mb-4 text-sm text-ink-600">
          Menolak {rejecting && rupiah(Number(rejecting.amount))} dari <b>{rejecting?.full_name}</b>.
          Alasan akan dikirim ke user sebagai notifikasi.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reject-reason" className="text-[13px] font-bold text-ink-700">Alasan penolakan</label>
          <textarea
            id="reject-reason" autoFocus rows={3} value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Transfer belum diterima di rekening operator."
            className="rounded-control border border-line px-4 py-3 text-sm outline-none focus:border-danger-500 focus:ring-2 focus:ring-danger-50"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => { setRejecting(null); setReason(''); }}>Batal</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={reject}>Tolak top-up</Button>
        </div>
      </Modal>
    </div>
  );
}
