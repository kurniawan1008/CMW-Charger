import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, MapPin, ChevronRight, PlugZap } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { rupiah, dateTime } from '../../lib/format';
import { Card, Badge, Empty } from '../../components/ui';
import { CountUp } from '../../components/energy';
import type { Location, Paged, SessionRecord } from '../../lib/types';

export default function Home() {
  const { user } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [recent, setRecent] = useState<SessionRecord[]>([]);

  useEffect(() => {
    api.get<Location[]>('/locations')
      .then((ls) => setLocations([...ls].sort((a, b) => b.available_chargers - a.available_chargers)))
      .catch(() => {});
    api.get<Paged<SessionRecord>>('/user/transactions?limit=3').then((r) => setRecent(r.data)).catch(() => {});
  }, []);

  const firstName = (user?.fullName || '').split(' ')[0] || 'Kamu';

  return (
    <div className="flex flex-col gap-5">
      {/* Kartu saldo — hero pribadi */}
      <section className="rise-in relative overflow-hidden rounded-card bg-grad-deep p-6 text-white shadow-raise">
        <div className="aurora right-[-30%] top-[-60%] h-64 w-64" style={{ background: 'rgba(56,189,248,0.35)' }} />
        <div className="soft-float absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
          <Zap size={19} className="fill-sky-400 text-sky-400" />
        </div>
        <p className="text-[13px] font-semibold text-white/70">Halo, {firstName}</p>
        <p className="mt-3 text-[12px] font-bold uppercase tracking-wider text-white/60">Saldo aktif</p>
        <p className="font-display text-[34px] font-extrabold leading-tight">
          <CountUp value={Number(user?.balance ?? 0)} prefix="Rp " />
        </p>
        <div className="mt-5 flex gap-2.5">
          <Link
            to="/charge"
            className="shine inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-control bg-white px-4 py-3 text-sm font-extrabold text-cmw-700 transition-all hover:-translate-y-0.5 hover:shadow-raise active:scale-[0.97]"
          >
            <Zap size={17} className="fill-cmw-600 text-cmw-600" /> Mulai Charging
          </Link>
          <Link
            to="/saldo"
            className="inline-flex cursor-pointer items-center justify-center rounded-control border border-white/30 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10 active:scale-[0.97]"
          >
            Top-Up
          </Link>
        </div>
      </section>

      {/* Lokasi terdekat */}
      <section className="rise-in" style={{ animationDelay: '80ms' }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-bold">Stasiun tersedia</h2>
          <Link to="/charge" className="inline-flex items-center gap-0.5 text-[13px] font-bold text-cmw-600">
            Semua <ChevronRight size={15} />
          </Link>
        </div>
        <div className="flex flex-col gap-2.5">
          {locations.slice(0, 3).map((loc) => (
            <Link key={loc.id} to="/charge" state={{ locationId: loc.id }}>
              <Card className="hover-wiggle card-lift flex cursor-pointer items-center gap-3.5">
                <div className="wiggle-target flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cmw-50 text-cmw-600">
                  <MapPin size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{loc.name}</p>
                  <p className="truncate text-xs text-ink-400">{loc.city} · {loc.hours}</p>
                </div>
                {loc.available_chargers > 0 ? (
                  <Badge tone="energy" pulse>{loc.available_chargers} siap</Badge>
                ) : (
                  <Badge tone="neutral">Penuh</Badge>
                )}
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Riwayat singkat */}
      <section className="rise-in" style={{ animationDelay: '160ms' }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-bold">Aktivitas terakhir</h2>
          <Link to="/riwayat" className="inline-flex items-center gap-0.5 text-[13px] font-bold text-cmw-600">
            Riwayat <ChevronRight size={15} />
          </Link>
        </div>
        {recent.length === 0 ? (
          <Card>
            <Empty
              icon={<PlugZap size={26} />}
              title="Belum ada sesi charging"
              body="Sesi pertamamu akan tampil di sini."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-2.5">
            {recent.map((s) => (
              <Card key={s.id} className="flex items-center gap-3.5">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.status === 'COMPLETED' ? 'bg-energy-50 text-energy-600' : s.status === 'FAULT' ? 'bg-danger-50 text-danger-500' : 'bg-surface-sunken text-ink-400'}`}>
                  <Zap size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{s.station_name || 'Stasiun'}</p>
                  <p className="text-xs text-ink-400">{dateTime(s.start_time)} · {Number(s.consumed_kwh).toFixed(2)} kWh</p>
                </div>
                <p className="font-mono text-[13px] font-bold tabular">{rupiah(Number(s.total_cost ?? 0))}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
