import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Field, Button } from '../../components/ui';
import { Modal, ConfirmDialog, useToast } from '../../components/overlay';

interface ParamValues { vset: number; iset: number; ocp: number; otp: number; lvp: number }
interface GetParamResponse extends ParamValues { ch: number; slot: number; label: string }
interface SetParamResponse { ch: number; slot: number; old: ParamValues; new: ParamValues }

// Rentang identik dengan validasi backend (spklu-backend/src/routes/admin.js)
// dan firmware ($SETPARAM di SPKLU_Esp32_Rev8.2.ino) — kalau salah satu
// berubah, samakan ketiganya.
const FIELDS: { key: keyof ParamValues; label: string; unit: string; step: string; min: number; max: number }[] = [
  { key: 'vset', label: 'V-SET', unit: 'V', step: '0.01', min: 1, max: 125 },
  { key: 'iset', label: 'I-SET', unit: 'A', step: '0.01', min: 0, max: 50 },
  { key: 'ocp', label: 'OCP', unit: 'A', step: '0.01', min: 0.1, max: 52 },
  { key: 'otp', label: 'OTP', unit: '°C', step: '1', min: 60, max: 120 },
  { key: 'lvp', label: 'LVP', unit: 'V', step: '0.01', min: 10, max: 145 },
];

export function MotorParamsModal({
  channelId, channelLabel, open, onClose,
}: { channelId: number; channelLabel: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [slot, setSlot] = useState(0);
  const [loading, setLoading] = useState(false);
  const [original, setOriginal] = useState<ParamValues | null>(null);
  const [form, setForm] = useState<ParamValues | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setOriginal(null);
    setForm(null);
    api.get<GetParamResponse>(`/admin/channels/${channelId}/params/${slot}`)
      .then((r) => {
        const v: ParamValues = { vset: r.vset, iset: r.iset, ocp: r.ocp, otp: r.otp, lvp: r.lvp };
        setOriginal(v);
        setForm(v);
      })
      .catch((err) => toast('err', err instanceof Error ? err.message : 'Gagal baca parameter'))
      .finally(() => setLoading(false));
  }, [open, slot, channelId]);

  const validate = (v: ParamValues): string | null => {
    for (const f of FIELDS) {
      const val = v[f.key];
      if (Number.isNaN(val) || val < f.min || val > f.max) {
        return `${f.label} harus di antara ${f.min} dan ${f.max} ${f.unit}.`;
      }
    }
    if (v.ocp < v.iset) return 'OCP harus lebih besar atau sama dengan I-SET.';
    return null;
  };

  const openConfirm = () => {
    if (!form) return;
    const err = validate(form);
    if (err) {
      toast('err', err);
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    if (!form) return;
    await api.post<SetParamResponse>(`/admin/channels/${channelId}/params`, { slot, ...form });
    toast('ok', `Parameter slot M${slot} tersimpan.`);
    onClose();
  };

  return (
    <>
      <Modal open={open && !confirming} onClose={onClose} title={`Parameter Motor — ${channelLabel}`} wide>
        <div className="mb-4 flex flex-col gap-1.5">
          <label htmlFor="param-slot" className="text-[13px] font-bold text-ink-700">Slot (M0-M9)</label>
          <select
            id="param-slot"
            value={slot}
            onChange={(e) => setSlot(Number(e.target.value))}
            className="rounded-control border border-line bg-white px-4 py-3 text-sm font-medium text-ink-900 outline-none focus:border-cmw-500 focus:ring-2 focus:ring-cmw-100"
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i}>M{i}</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-sm text-ink-400">Memuat nilai saat ini…</p>}

        {form && !loading && (
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <Field
                key={f.key}
                label={`${f.label} (${f.unit})`}
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
              />
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button variant="primary" disabled={!form} onClick={openConfirm}>
            Simpan
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={save}
        title={`Konfirmasi ubah parameter slot M${slot}?`}
        body={
          original && form
            ? FIELDS.map((f) => `${f.label}: ${original[f.key]} -> ${form[f.key]} ${f.unit}`).join(' · ')
            : ''
        }
        confirmLabel="Ya, tulis ke mesin"
        danger
      />
    </>
  );
}
