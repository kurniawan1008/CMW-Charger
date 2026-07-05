import { useEffect, useState } from 'react';
import { Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { rupiah, dateTime, duration } from '../../lib/format';
import { Card, Badge, Empty, Button } from '../../components/ui';
import type { Paged, SessionRecord } from '../../lib/types';

const statusMeta: Record<string, { tone: 'energy' | 'sky' | 'danger' | 'neutral'; label: string }> = {
  COMPLETED: { tone: 'energy', label: 'Selesai' },
  ACTIVE: { tone: 'sky', label: 'Berjalan' },
  STOPPED: { tone: 'neutral', label: 'Dihentikan' },
  FAULT: { tone: 'danger', label: 'Gangguan' },
};

export default function History() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<SessionRecord> | null>(null);

  useEffect(() => {
    api.get<Paged<SessionRecord>>(`/user/transactions?page=${page}&limit=10`)
      .then(setResult).catch(() => {});
  }, [page]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="rise-in font-display text-lg font-extrabold">Riwayat charging</h1>

      {result && result.data.length === 0 && (
        <Card><Empty icon={<Zap size={26} />} title="Belum ada riwayat" body="Sesi charging kamu akan tercatat di sini." /></Card>
      )}

      <div className="flex flex-col gap-2.5">
        {result?.data.map((s, i) => {
          const meta = statusMeta[s.status] ?? statusMeta.STOPPED;
          const durSec = s.end_time
            ? (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 1000
            : 0;
          return (
            <Card key={s.id} className="rise-in" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-bold">{s.station_name || 'Stasiun'}</p>
                <Badge tone={meta.tone} pulse={s.status === 'ACTIVE'}>{meta.label}</Badge>
              </div>
              <p className="text-xs text-ink-400">
                {dateTime(s.start_time)}
                {s.brand ? ` · ${s.brand} ${s.model}` : ''}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
                {[
                  ['Energi', `${Number(s.consumed_kwh).toFixed(3)} kWh`],
                  ['Biaya', rupiah(Number(s.total_cost ?? 0))],
                  ['Durasi', durSec ? duration(durSec) : '—'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{k}</p>
                    <p className="mt-0.5 font-mono text-[13px] font-bold tabular">{v}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 font-mono text-[10.5px] text-ink-300">#{s.id}</p>
            </Card>
          );
        })}
      </div>

      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="!px-3 !py-2">
            <ChevronLeft size={16} />
          </Button>
          <span className="text-[13px] font-bold text-ink-600">{page} / {result.totalPages}</span>
          <Button variant="outline" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)} className="!px-3 !py-2">
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
