import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Archive, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, Field, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, useToast } from '../../components/overlay';
import { PageHeader, SearchBox, Table, Pager, useDebounced } from './shared';
import type { Paged } from '../../lib/types';

interface MotorRow {
  id: number; brand: string; model: string; category: string | null;
  max_power_kw: number | null; batt_cap_kwh: number | null;
  fw_slot: number; vset_v: number; iset_a: number; ocp_a: number;
  otp_c: number; lvp_v: number; is_active: number;
}

export default function Motors() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<MotorRow> | null>(null);
  const [editing, setEditing] = useState<MotorRow | 'new' | null>(null);
  const [archiving, setArchiving] = useState<MotorRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<Paged<MotorRow>>(`/admin/motors?search=${encodeURIComponent(q)}&page=${page}&limit=10`)
      .then(setResult).catch(() => {});

  useEffect(() => { load(); }, [q, page]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    for (const k of ['brand', 'model', 'category']) body[k] = f.get(k);
    for (const k of ['max_power_kw', 'batt_cap_kwh', 'fw_slot', 'vset_v', 'iset_a', 'ocp_a', 'otp_c', 'lvp_v']) {
      const v = f.get(k);
      if (v !== '' && v !== null) body[k] = Number(v);
    }
    try {
      if (editing === 'new') await api.post('/admin/motors', body);
      else if (editing) await api.patch(`/admin/motors/${editing.id}`, body);
      toast('ok', 'Profil motor tersimpan. Pastikan slot M-nya sinkron dengan HMI mesin.');
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
        title="Motor Profiles"
        sub="Katalog motor + parameter charging teknis — fw_slot memetakan ke slot M0–M9 di ESP32"
        action={<Button onClick={() => setEditing('new')}><Plus size={15} /> Tambah profil</Button>}
      />
      <div className="mb-4"><SearchBox value={search} onChange={setSearch} placeholder="Cari merk / model…" /></div>

      <Table head={['Motor', 'Kategori', 'Slot FW', 'Vset', 'Iset', 'OCP', 'OTP', 'LVP', 'Status', '']}>
        {result?.data.map((m) => (
          <tr key={m.id} className={`transition-colors hover:bg-surface-sunken/50 ${m.is_active ? '' : 'opacity-50'}`}>
            <td className="px-4 py-3">
              <p className="font-bold">{m.brand} {m.model}</p>
              {m.batt_cap_kwh && <p className="text-[11.5px] text-ink-400">Baterai {m.batt_cap_kwh} kWh</p>}
            </td>
            <td className="px-4 py-3 text-ink-600">{m.category || '—'}</td>
            <td className="px-4 py-3"><span className="rounded-lg bg-cmw-50 px-2 py-1 font-mono text-[12px] font-bold text-cmw-700">M{m.fw_slot}</span></td>
            <td className="px-4 py-3 font-mono tabular">{m.vset_v} V</td>
            <td className="px-4 py-3 font-mono tabular">{m.iset_a} A</td>
            <td className="px-4 py-3 font-mono tabular">{m.ocp_a} A</td>
            <td className="px-4 py-3 font-mono tabular">{m.otp_c} °C</td>
            <td className="px-4 py-3 font-mono tabular">{m.lvp_v} V</td>
            <td className="px-4 py-3">{m.is_active ? <Badge tone="energy">Aktif</Badge> : <Badge tone="neutral">Arsip</Badge>}</td>
            <td className="px-4 py-3">
              <div className="flex justify-end gap-1">
                <button onClick={() => setEditing(m)} aria-label={`Edit ${m.brand} ${m.model}`}
                  className="cursor-pointer rounded-lg p-2 text-ink-400 transition-colors hover:bg-cmw-50 hover:text-cmw-600">
                  <Pencil size={15} />
                </button>
                {m.is_active === 1 && (
                  <button onClick={() => setArchiving(m)} aria-label={`Arsipkan ${m.brand} ${m.model}`}
                    className="cursor-pointer rounded-lg p-2 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-500">
                    <Archive size={15} />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      {result && <Pager page={result.page} totalPages={result.totalPages} onPage={setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Tambah profil motor' : 'Edit profil motor'} wide>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <fieldset className="grid grid-cols-2 gap-4">
            <legend className="col-span-2 mb-1 text-[12px] font-extrabold uppercase tracking-wider text-ink-400">
              Info Umum (tampil ke user)
            </legend>
            <Field label="Merk" name="brand" required defaultValue={cur?.brand} placeholder="Honda" />
            <Field label="Model" name="model" required defaultValue={cur?.model} placeholder="EM1 e:" />
            <Field label="Kategori" name="category" defaultValue={cur?.category ?? ''} placeholder="Skutik" />
            <Field label="Kapasitas baterai (kWh)" name="batt_cap_kwh" type="number" step="0.001" defaultValue={cur?.batt_cap_kwh ?? ''} />
            <Field label="Daya maks (kW)" name="max_power_kw" type="number" step="0.01" defaultValue={cur?.max_power_kw ?? ''} />
          </fieldset>

          <fieldset className="grid grid-cols-3 gap-4 rounded-2xl border border-amber-100 bg-amber-100/25 p-4">
            <legend className="flex items-center gap-1.5 px-1 text-[12px] font-extrabold uppercase tracking-wider text-amber-700">
              <Zap size={13} /> Parameter Charging (Teknis)
            </legend>
            <Field label="Slot firmware (M0–M9)" name="fw_slot" type="number" min={0} max={9} required defaultValue={cur?.fw_slot ?? ''}
              hint="Wajib sinkron manual dengan slot di HMI mesin." />
            <Field label="Vset (V)" name="vset_v" type="number" step="0.01" required defaultValue={cur?.vset_v ?? ''} />
            <Field label="Iset (A)" name="iset_a" type="number" step="0.01" required defaultValue={cur?.iset_a ?? ''} />
            <Field label="OCP (A)" name="ocp_a" type="number" step="0.01" required defaultValue={cur?.ocp_a ?? ''} hint="Over-current protection" />
            <Field label="OTP (°C)" name="otp_c" type="number" required defaultValue={cur?.otp_c ?? ''} hint="Over-temperature protection" />
            <Field label="LVP (V)" name="lvp_v" type="number" step="0.01" required defaultValue={cur?.lvp_v ?? ''} hint="Low-voltage protection" />
          </fieldset>

          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Batal</Button>
            <Button type="submit" loading={busy}>{editing === 'new' ? 'Tambah' : 'Simpan'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          if (!archiving) return;
          await api.del(`/admin/motors/${archiving.id}`);
          toast('ok', 'Profil diarsipkan — tidak tampil lagi di aplikasi user.');
          await load();
        }}
        title="Arsipkan profil motor?"
        body={`${archiving?.brand} ${archiving?.model} akan disembunyikan dari user. Riwayat sesi lama tetap utuh.`}
        confirmLabel="Arsipkan"
        danger
      />
    </div>
  );
}
