import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { rupiah, dateTime } from '../../lib/format';
import { Button, Badge, Card } from '../../components/ui';
import { Modal, useToast } from '../../components/overlay';
import { PageHeader, SearchBox, Table, Pager, useDebounced } from './shared';
import type { Paged } from '../../lib/types';

interface UserRow {
  id: number; email: string; phone: string | null; full_name: string;
  balance: number; role: string; status: 'ACTIVE' | 'SUSPENDED'; created_at: string;
}
interface UserDetail {
  user: UserRow;
  stats: { sessions: number; spent: number; kwh: number };
  recentSessions: { id: string; status: string; consumed_kwh: number; total_cost: number | null; start_time: string }[];
}

export default function AdminUsers() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<UserRow> | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);

  const load = () =>
    api.get<Paged<UserRow>>(`/admin/users?search=${encodeURIComponent(q)}&page=${page}&limit=12`)
      .then(setResult).catch(() => {});

  useEffect(() => { load(); }, [q, page]);
  useEffect(() => { setPage(1); }, [q]);

  const openDetail = (id: number) =>
    api.get<UserDetail>(`/admin/users/${id}`).then(setDetail).catch(() => toast('err', 'Gagal memuat detail'));

  const toggleStatus = async (u: UserRow) => {
    try {
      await api.post(`/admin/users/${u.id}/${u.status === 'ACTIVE' ? 'deactivate' : 'activate'}`);
      toast('ok', u.status === 'ACTIVE' ? 'Akun dinonaktifkan.' : 'Akun diaktifkan lagi.');
      await load();
      if (detail?.user.id === u.id) await openDetail(u.id);
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal mengubah status');
    }
  };

  return (
    <div>
      <PageHeader title="Pengguna" sub="Daftar akun user, saldo, dan aktivitasnya" />
      <div className="mb-4"><SearchBox value={search} onChange={setSearch} placeholder="Cari nama / email…" /></div>

      <Table head={['Pengguna', 'Kontak', 'Saldo', 'Status', 'Terdaftar', '']}>
        {result?.data.filter((u) => u.role === 'USER').map((u) => (
          <tr key={u.id} className="transition-colors hover:bg-surface-sunken/50">
            <td className="px-4 py-3">
              <button onClick={() => openDetail(u.id)} className="cursor-pointer font-bold text-cmw-700 hover:underline">
                {u.full_name}
              </button>
            </td>
            <td className="px-4 py-3">
              <p className="text-ink-600">{u.email}</p>
              {u.phone && <p className="text-[11.5px] text-ink-400">{u.phone}</p>}
            </td>
            <td className="px-4 py-3 font-mono font-bold tabular">{rupiah(Number(u.balance))}</td>
            <td className="px-4 py-3">
              {u.status === 'ACTIVE' ? <Badge tone="energy">Aktif</Badge> : <Badge tone="danger">Nonaktif</Badge>}
            </td>
            <td className="px-4 py-3 text-[12px] text-ink-400">{dateTime(u.created_at)}</td>
            <td className="px-4 py-3 text-right">
              <Button
                variant={u.status === 'ACTIVE' ? 'danger' : 'outline'}
                onClick={() => toggleStatus(u)}
                className="!px-3.5 !py-2 !text-[12px]"
              >
                {u.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {result && <Pager page={result.page} totalPages={result.totalPages} onPage={setPage} />}

      {/* Detail drill-in */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.user.full_name ?? ''} wide>
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                ['Saldo', rupiah(Number(detail.user.balance))],
                ['Total sesi', String(detail.stats.sessions)],
                ['Total belanja', rupiah(Number(detail.stats.spent))],
                ['Total energi', `${Number(detail.stats.kwh).toFixed(2)} kWh`],
              ].map(([k, v]) => (
                <Card key={k} className="!p-3.5">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-400">{k}</p>
                  <p className="mt-1 font-display text-[15px] font-extrabold tabular">{v}</p>
                </Card>
              ))}
            </div>
            <div>
              <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-ink-400">10 sesi terakhir</p>
              <div className="max-h-[260px] overflow-y-auto rounded-2xl border border-line">
                {detail.recentSessions.length === 0 && (
                  <p className="p-5 text-center text-[13px] text-ink-400">Belum pernah charging.</p>
                )}
                {detail.recentSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b border-line px-4 py-2.5 last:border-0">
                    <div>
                      <p className="font-mono text-[11.5px] font-bold">{s.id}</p>
                      <p className="text-[11px] text-ink-400">{dateTime(s.start_time)}</p>
                    </div>
                    <p className="font-mono text-[12px] tabular">{Number(s.consumed_kwh).toFixed(3)} kWh</p>
                    <p className="font-mono text-[12px] font-bold tabular">{rupiah(Number(s.total_cost ?? 0))}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
