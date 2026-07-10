import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Field, Button } from '../../components/ui';
import { Modal, ConfirmDialog, useToast } from '../../components/overlay';

interface ParamValues { vset: number; iset: number; ocp: number; otp: number; lvp: number }
interface GetParamResponse extends ParamValues { ch: number; slot: number; label: string }
interface SetParamResponse { ch: number; slot: number; old: ParamValues; new: ParamValues }

const FIELDS: { key: keyof ParamValues; label: string; unit: string; step: string }[] = [
  { key: 'vset', label: 'V-SET', unit: 'V', step: '0.01' },
  { key: 'iset', label: 'I-SET', unit: 'A', step: '0.01' },
  { key: 'ocp', label: 'OCP', unit: 'A', step: '0.01' },
  { key: 'otp', label: 'OTP', unit: '°C', step: '1' },
  { key: 'lvp', label: 'LVP', unit: 'V', step: '0.01' },
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
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
              />
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button variant="primary" disabled={!form} onClick={() => setConfirming(true)}>
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
