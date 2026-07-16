import { useEffect, useState } from 'react';
import { Users as UsersIcon, Wallet2, Scale } from 'lucide-react';
import { api } from '../../lib/api';
import { rupiah, dateTime } from '../../lib/format';
import { Button, Badge, Card, Field } from '../../components/ui';
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

  const [topupTarget, setTopupTarget] = useState<UserRow | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const [topupBusy, setTopupBusy] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState<UserRow | null>(null);
  const [adjustDir, setAdjustDir] = useState<'add' | 'sub'>('add');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);

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

  const refreshAffected = async (id: number) => {
    await load();
    if (detail?.user.id === id) await openDetail(id);
  };

  const closeTopup = () => { setTopupTarget(null); setTopupAmount(''); setTopupNote(''); };
  const submitTopup = async () => {
    if (!topupTarget) return;
    const amount = Number(topupAmount);
    if (!(amount > 0)) { toast('err', 'Nominal harus lebih dari 0'); return; }
    setTopupBusy(true);
    try {
      await api.post(`/admin/users/${topupTarget.id}/topup`, { amount, note: topupNote });
      toast('ok', `Saldo ${topupTarget.full_name} ditambah ${rupiah(amount)}. User mendapat notifikasi.`);
      const id = topupTarget.id;
      closeTopup();
      await refreshAffected(id);
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal top-up');
    } finally { setTopupBusy(false); }
  };

  const closeAdjust = () => { setAdjustTarget(null); setAdjustAmount(''); setAdjustReason(''); setAdjustDir('add'); };
  const submitAdjust = async () => {
    if (!adjustTarget) return;
    const magnitude = Number(adjustAmount);
    if (!(magnitude > 0)) { toast('err', 'Nominal harus lebih dari 0'); return; }
    if (!adjustReason.trim()) { toast('err', 'Alasan koreksi wajib diisi'); return; }
    const amount = adjustDir === 'add' ? magnitude : -magnitude;
    setAdjustBusy(true);
    try {
      await api.post(`/admin/users/${adjustTarget.id}/adjust-balance`, { amount, reason: adjustReason });
      toast('ok', `Saldo ${adjustTarget.full_name} dikoreksi ${adjustDir === 'add' ? '+' : '-'}${rupiah(magnitude)}. User mendapat notifikasi.`);
      const id = adjustTarget.id;
      closeAdjust();
      await refreshAffected(id);
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal koreksi saldo');
    } finally { setAdjustBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Pengguna" sub="Daftar akun user, saldo, dan aktivitasnya" icon={<UsersIcon size={20} />} />
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
            <td className="px-4 py-3">
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setTopupTarget(u)}
                  className="!px-3 !py-2 !text-[12px]"
                  title="Top-up saldo langsung"
                  aria-label={`Top-up saldo ${u.full_name}`}
                >
                  <Wallet2 size={14} />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAdjustTarget(u)}
                  className="!px-3 !py-2 !text-[12px]"
                  title="Rebalancing saldo"
                  aria-label={`Rebalancing saldo ${u.full_name}`}
                >
                  <Scale size={14} />
                </Button>
                <Button
                  variant={u.status === 'ACTIVE' ? 'danger' : 'outline'}
                  onClick={() => toggleStatus(u)}
                  className="!px-3.5 !py-2 !text-[12px]"
                >
                  {u.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}
                </Button>
              </div>
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
            <div className="flex gap-2.5">
              <Button variant="outline" onClick={() => setTopupTarget(detail.user)} className="flex-1 !text-[12.5px]">
                <Wallet2 size={15} /> Top-Up Saldo
              </Button>
              <Button variant="outline" onClick={() => setAdjustTarget(detail.user)} className="flex-1 !text-[12.5px]">
                <Scale size={15} /> Rebalancing Saldo
              </Button>
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

      {/* Top-up langsung — bukan lewat request user, langsung dari admin */}
      <Modal open={topupTarget !== null} onClose={closeTopup} title="Top-Up Saldo Langsung">
        <p className="mb-4 text-sm text-ink-600">
          Menambah saldo <b>{topupTarget?.full_name}</b> langsung tanpa request top-up.
          User akan menerima notifikasi.
        </p>
        <div className="flex flex-col gap-3">
          <Field
            label="Nominal (Rp)" type="number" min={1000} step={1000}
            value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)}
            placeholder="Contoh: 50000" autoFocus
          />
          <Field
            label="Catatan (opsional)" value={topupNote} onChange={(e) => setTopupNote(e.target.value)}
            placeholder="Contoh: Top-up via kasir tunai"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={closeTopup}>Batal</Button>
          <Button loading={topupBusy} disabled={!(Number(topupAmount) > 0)} onClick={submitTopup}>
            Tambah Saldo
          </Button>
        </div>
      </Modal>

      {/* Rebalancing manual — koreksi saldo, bisa tambah atau kurangi, alasan wajib */}
      <Modal open={adjustTarget !== null} onClose={closeAdjust} title="Rebalancing Saldo">
        <p className="mb-4 text-sm text-ink-600">
          Koreksi manual saldo <b>{adjustTarget?.full_name}</b> (mis. salah top-up atau kesalahan lain).
          Alasan wajib diisi dan akan dikirim ke user sebagai notifikasi.
        </p>
        <div className="mb-3 flex gap-1 rounded-xl bg-surface-sunken p-1" role="tablist">
          <button
            type="button" role="tab" aria-selected={adjustDir === 'add'}
            onClick={() => setAdjustDir('add')}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-[12.5px] font-bold transition-all ${adjustDir === 'add' ? 'bg-white text-energy-700 shadow-card' : 'text-ink-400'}`}
          >
            Tambah (+)
          </button>
          <button
            type="button" role="tab" aria-selected={adjustDir === 'sub'}
            onClick={() => setAdjustDir('sub')}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-[12.5px] font-bold transition-all ${adjustDir === 'sub' ? 'bg-white text-danger-700 shadow-card' : 'text-ink-400'}`}
          >
            Kurangi (−)
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <Field
            label="Nominal (Rp)" type="number" min={1} step={1000}
            value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)}
            placeholder="Contoh: 25000" autoFocus
          />
          <Field
            label="Alasan koreksi" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}
            placeholder="Contoh: Salah input nominal top-up sebelumnya"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={closeAdjust}>Batal</Button>
          <Button
            variant={adjustDir === 'sub' ? 'danger' : 'primary'}
            loading={adjustBusy}
            disabled={!(Number(adjustAmount) > 0) || !adjustReason.trim()}
            onClick={submitAdjust}
          >
            {adjustDir === 'add' ? 'Tambah Saldo' : 'Kurangi Saldo'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
