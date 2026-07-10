import { useEffect, useState } from 'react';
import { Wrench, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge } from '../../components/ui';
import { ConfirmDialog, useToast } from '../../components/overlay';
import { PageHeader, Table, Pager } from './shared';
import { useTopic } from '../../lib/ws';
import { useAuth } from '../../lib/auth';
import { MotorParamsModal } from './MotorParamsModal';
import type { Paged } from '../../lib/types';

interface ChannelRow {
  id: number; device_ch: number; status: string; maintenance: number;
  machine_name: string | null; device_online: number; station_name: string | null;
  current_session_id: string | null;
}

const statusMeta: Record<string, { tone: 'energy' | 'sky' | 'danger' | 'amber' | 'neutral'; label: string }> = {
  READY: { tone: 'energy', label: 'Siap' },
  CHARGING: { tone: 'sky', label: 'Mengisi' },
  FAULT: { tone: 'danger', label: 'Gangguan' },
  PAUSED: { tone: 'amber', label: 'Jeda' },
  OFFLINE: { tone: 'neutral', label: 'Offline' },
};

export default function Channels() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<ChannelRow> | null>(null);
  const [confirming, setConfirming] = useState<ChannelRow | null>(null);
  const [editingParams, setEditingParams] = useState<ChannelRow | null>(null);
  const { user } = useAuth();

  const load = () =>
    api.get<Paged<ChannelRow>>(`/admin/channels?page=${page}&limit=15`).then(setResult).catch(() => {});

  useEffect(() => { load(); }, [page]);
  useTopic('admin', () => load()); // status berubah realtime saat ada event mesin

  const toggleMaintenance = async (ch: ChannelRow) => {
    try {
      await api.post(`/admin/channels/${ch.id}/maintenance`, { enabled: !ch.maintenance });
      toast('ok', ch.maintenance ? 'Channel kembali beroperasi.' : 'Channel masuk mode maintenance.');
      await load();
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal mengubah');
    }
  };

  return (
    <div>
      <PageHeader
        title="Manajemen Channel"
        sub="Status real-time dari telemetry firmware — satu-satunya kontrol manual: maintenance"
      />

      <Table head={['Channel', 'Mesin', 'Lokasi', 'Status', 'Sesi berjalan', 'Maintenance']}>
        {result?.data.map((ch) => {
          const meta = ch.maintenance ? { tone: 'amber' as const, label: 'Maintenance' }
            : statusMeta[ch.status] ?? statusMeta.OFFLINE;
          return (
            <tr key={ch.id} className="transition-colors hover:bg-surface-sunken/50">
              <td className="px-4 py-3 font-mono font-bold">CH {ch.device_ch}</td>
              <td className="px-4 py-3 font-semibold">{ch.machine_name || '—'}</td>
              <td className="px-4 py-3 text-ink-600">{ch.station_name || '—'}</td>
              <td className="px-4 py-3">
                <Badge tone={meta.tone} pulse={ch.status === 'CHARGING' && !ch.maintenance}>{meta.label}</Badge>
              </td>
              <td className="px-4 py-3 font-mono text-[11.5px] text-ink-400">{ch.current_session_id || '—'}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => (ch.maintenance ? toggleMaintenance(ch) : setConfirming(ch))}
                    disabled={!ch.maintenance && ch.status === 'CHARGING'}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ch.maintenance ? 'bg-energy-50 text-energy-700 hover:bg-energy-100' : 'bg-surface-sunken text-ink-600 hover:bg-amber-100 hover:text-amber-700'}`}
                  >
                    <Wrench size={13} />
                    {ch.maintenance ? 'Aktifkan lagi' : 'Maintenance'}
                  </button>
                  {user?.role === 'SUPERADMIN' && (
                    <button
                      onClick={() => setEditingParams(ch)}
                      disabled={ch.status === 'CHARGING'}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-surface-sunken px-3 py-2 text-[12px] font-bold text-ink-600 transition-colors hover:bg-cmw-100 hover:text-cmw-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <SlidersHorizontal size={13} />
                      Parameter Motor
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </Table>
      {result && <Pager page={result.page} totalPages={result.totalPages} onPage={setPage} />}

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={async () => { if (confirming) await toggleMaintenance(confirming); }}
        title="Masukkan channel ke maintenance?"
        body={`CH ${confirming?.device_ch} di ${confirming?.machine_name ?? 'mesin'} akan dipaksa OFFLINE dan tidak bisa dipakai user sampai diaktifkan lagi.`}
        confirmLabel="Ya, maintenance"
        danger
      />

      {editingParams && (
        <MotorParamsModal
          channelId={editingParams.id}
          channelLabel={`CH ${editingParams.device_ch} — ${editingParams.machine_name ?? 'mesin'}`}
          open={editingParams !== null}
          onClose={() => setEditingParams(null)}
        />
      )}
    </div>
  );
}
