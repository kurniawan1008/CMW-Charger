// Wizard charging: Lokasi → Charger → Motor → Jumlah → Konfirmasi → Live → Selesai.
// Transisi antar langkah searah (maju = geser kiri); telemetry live via WebSocket.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation as useRouteLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, MapPin, Bike, CircleCheck, Zap, X, TriangleAlert, PartyPopper,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTopic } from '../../lib/ws';
import { rupiah, duration } from '../../lib/format';
import { Button, Card, Badge } from '../../components/ui';
import { CountUp, CurrentLine, FlowLink, ProgressRing, Sparkline } from '../../components/energy';
import { BoltRain, Confetti } from '../../components/motion';
import type { Charger, Location, MotorProfile, SessionFinal, SessionTick } from '../../lib/types';

const STEPS = ['Lokasi', 'Charger', 'Motor', 'Jumlah', 'Konfirmasi'];
const PRICE_FALLBACK = 2440;

type Mode = 'idr' | 'kwh';

export default function Wizard() {
  const navigate = useNavigate();
  const routeLoc = useRouteLocation();
  const { refresh } = useAuth();

  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1);
  const [price, setPrice] = useState(PRICE_FALLBACK);

  const [locations, setLocations] = useState<Location[]>([]);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [motors, setMotors] = useState<MotorProfile[]>([]);

  const [selLocation, setSelLocation] = useState<Location | null>(null);
  const [selCharger, setSelCharger] = useState<Charger | null>(null);
  const [selMotor, setSelMotor] = useState<MotorProfile | null>(null);
  const [mode, setMode] = useState<Mode>('idr');
  const [amount, setAmount] = useState(15000);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState<SessionTick | null>(null);
  const [powerHistory, setPowerHistory] = useState<number[]>([]);
  const [finalResult, setFinalResult] = useState<SessionFinal | null>(null);

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); };

  useEffect(() => {
    api.get<{ pricePerKwh: number }>('/price').then((r) => setPrice(r.pricePerKwh)).catch(() => {});
    api.get<Location[]>('/locations').then((raw) => {
      const ls = [...raw].sort((a, b) => b.available_chargers - a.available_chargers);
      setLocations(ls);
      const preset = (routeLoc.state as { locationId?: number } | null)?.locationId;
      if (preset) {
        const found = ls.find((l) => l.id === preset);
        if (found) { setSelLocation(found); setStep(2); }
      }
    }).catch(() => {});
    api.get<MotorProfile[]>('/motors').then(setMotors).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selLocation) return;
    api.get<Charger[]>(`/locations/${selLocation.id}/chargers`).then(setChargers).catch(() => {});
  }, [selLocation?.id]);

  // Telemetry live
  useTopic(sessionId ? `session.${sessionId}` : null, (data) => {
    const d = data as SessionTick | SessionFinal;
    if ('final' in d && d.final) {
      setFinalResult(d);
      refresh(); // saldo berubah (refund)
      setTimeout(() => setStep(7), 700);
    } else if ('energy' in d) {
      setTick(d);
      setPowerHistory((h) => [...h.slice(-40), d.power]);
    }
  });

  const estKwh = mode === 'idr' ? amount / price : amount;
  const estCost = mode === 'idr' ? amount : Math.ceil(amount * price);

  const startSession = async () => {
    if (!selCharger || !selMotor) return;
    setStarting(true);
    setError('');
    try {
      const res = await api.post<{ sessionId: string }>('/sessions/start', {
        channelId: selCharger.id,
        motorProfileId: selMotor.id,
        mode,
        target: amount,
      });
      setSessionId(res.sessionId);
      setTick(null);
      setPowerHistory([]);
      setFinalResult(null);
      refresh(); // saldo direservasi
      setDir(1);
      setStep(6);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulai sesi');
    } finally {
      setStarting(false);
    }
  };

  const stopSession = async () => {
    if (!sessionId) return;
    try { await api.post(`/sessions/${sessionId}/stop`); } catch { /* final event tetap datang */ }
  };

  const progress = useMemo(() => {
    if (!tick) return 0;
    return mode === 'idr' ? tick.cost / estCost : tick.energy / estKwh;
  }, [tick, mode, estCost, estKwh]);

  // Variants statis (tanpa custom function) — varian ber-custom membuat exit
  // AnimatePresence macet; arah tetap terasa dari offset enter/exit.
  const variants = {
    enter: { opacity: 0, x: 28 * dir },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 * dir },
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-10 pt-5">
      {/* Header wizard */}
      <div className="mb-5 flex items-center gap-3">
        {step <= 5 && (
          <button
            onClick={() => (step === 1 ? navigate('/') : go(step - 1))}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-line bg-white text-ink-600 transition-colors hover:border-cmw-500 hover:text-cmw-600"
            aria-label="Kembali"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex-1">
          <p className="font-display text-[17px] font-bold leading-tight">
            {step <= 5 ? STEPS[step - 1] : step === 6 ? 'Sesi berlangsung' : 'Selesai'}
          </p>
          {step <= 5 && <p className="text-xs font-semibold text-ink-400">Langkah {step} dari 5</p>}
        </div>
        {step <= 5 && (
          <Link to="/" aria-label="Tutup" className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-400 hover:text-ink-600">
            <X size={19} />
          </Link>
        )}
      </div>

      {/* Stepper: selesai = biru solid, aktif = arus mengalir, berikutnya = abu */}
      {step <= 5 && (
        <div className="mb-6 flex items-center gap-1.5">
          {STEPS.map((_, i) =>
            i + 1 === step ? (
              <CurrentLine key={i} active className="flex-1" />
            ) : (
              <div
                key={i}
                className={`h-[3px] flex-1 rounded-full ${i + 1 < step ? 'bg-cmw-500' : 'bg-line'}`}
              />
            ),
          )}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1"
        >
          {/* ===== 1. Lokasi ===== */}
          {step === 1 && (
            <div className="flex flex-col gap-2.5">
              {locations.map((loc, i) => (
                <button
                  key={loc.id}
                  disabled={loc.status === 'OFFLINE'}
                  onClick={() => { setSelLocation(loc); setSelCharger(null); go(2); }}
                  className="rise-in cursor-pointer text-left disabled:opacity-50"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <Card className="hover-wiggle card-lift flex items-center gap-3.5">
                    <div className="wiggle-target flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cmw-50 text-cmw-600">
                      <MapPin size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{loc.name}</p>
                      <p className="truncate text-xs text-ink-400">{loc.address}</p>
                    </div>
                    {loc.available_chargers > 0
                      ? <Badge tone="energy" pulse>{loc.available_chargers} siap</Badge>
                      : <Badge tone="neutral">Penuh</Badge>}
                  </Card>
                </button>
              ))}
            </div>
          )}

          {/* ===== 2. Charger (flat, mesin disembunyikan) ===== */}
          {step === 2 && (
            <div className="grid grid-cols-2 gap-3">
              {chargers.map((ch, i) => (
                <button
                  key={ch.id}
                  disabled={!ch.available}
                  onClick={() => { setSelCharger(ch); go(3); }}
                  className="rise-in cursor-pointer disabled:cursor-not-allowed"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <Card className={`hover-wiggle flex flex-col items-center gap-2 py-6 ${ch.available ? 'card-lift' : 'opacity-55'}`}>
                    <div className={`wiggle-target flex h-12 w-12 items-center justify-center rounded-2xl ${ch.available ? 'shine soft-float bg-grad-energy text-white shadow-glow-energy' : 'bg-surface-sunken text-ink-300'}`}>
                      <Zap size={22} />
                    </div>
                    <p className="font-display text-sm font-bold">{ch.label}</p>
                    {ch.available
                      ? <Badge tone="energy">Tersedia</Badge>
                      : <Badge tone={ch.status === 'CHARGING' ? 'sky' : ch.status === 'FAULT' ? 'danger' : 'neutral'}>
                          {ch.status === 'CHARGING' ? 'Dipakai' : ch.status === 'MAINTENANCE' ? 'Perawatan' : ch.status === 'FAULT' ? 'Gangguan' : 'Offline'}
                        </Badge>}
                  </Card>
                </button>
              ))}
              {chargers.length === 0 && (
                <p className="col-span-2 py-10 text-center text-sm text-ink-400">Memuat charger…</p>
              )}
            </div>
          )}

          {/* ===== 3. Motor ===== */}
          {step === 3 && (
            <div className="flex flex-col gap-2.5">
              {motors.map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => { setSelMotor(m); go(4); }}
                  className="rise-in cursor-pointer text-left"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <Card className={`hover-wiggle card-lift flex items-center gap-3.5 ${selMotor?.id === m.id ? 'ring-2 ring-cmw-500' : ''}`}>
                    <div className="wiggle-target flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-500">
                      <Bike size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{m.brand} {m.model}</p>
                      <p className="text-xs text-ink-400">
                        {m.category || 'Motor listrik'}
                        {m.batt_cap_kwh ? ` · Baterai ${m.batt_cap_kwh} kWh` : ''}
                      </p>
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          )}

          {/* ===== 4. Jumlah ===== */}
          {step === 4 && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-1 rounded-control bg-surface-sunken p-1">
                {(['idr', 'kwh'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setAmount(m === 'idr' ? 15000 : 2); }}
                    className={`cursor-pointer rounded-xl py-2.5 text-sm font-bold transition-all ${mode === m ? 'bg-white text-cmw-700 shadow-card' : 'text-ink-400'}`}
                  >
                    {m === 'idr' ? 'Rupiah' : 'kWh'}
                  </button>
                ))}
              </div>

              <Card className="flex flex-col items-center gap-1 py-8">
                <p className="text-xs font-bold uppercase tracking-wider text-ink-400">Target pengisian</p>
                <p className="font-display text-[40px] font-extrabold tabular leading-tight">
                  {mode === 'idr' ? rupiah(amount) : `${amount} kWh`}
                </p>
                <p className="text-[13px] font-semibold text-ink-400">
                  ≈ {mode === 'idr' ? `${estKwh.toFixed(2)} kWh` : rupiah(estCost)}
                </p>
                <input
                  type="range"
                  aria-label="Atur jumlah"
                  min={mode === 'idr' ? 5000 : 0.5}
                  max={mode === 'idr' ? 100000 : 15}
                  step={mode === 'idr' ? 1000 : 0.5}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="mt-4 w-full accent-cmw-600"
                />
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {(mode === 'idr' ? [10000, 15000, 25000, 50000] : [1, 2, 3, 5]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setAmount(v)}
                      className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors ${amount === v ? 'bg-cmw-600 text-white' : 'bg-surface-sunken text-ink-600 hover:bg-cmw-100'}`}
                    >
                      {mode === 'idr' ? `${v / 1000}rb` : `${v} kWh`}
                    </button>
                  ))}
                </div>
              </Card>

              <Button variant="energy" onClick={() => go(5)}>Lanjut ke konfirmasi</Button>
            </div>
          )}

          {/* ===== 5. Konfirmasi ===== */}
          {step === 5 && selLocation && selCharger && selMotor && (
            <div className="flex flex-col gap-4">
              <Card className="flex flex-col divide-y divide-line">
                {[
                  ['Stasiun', selLocation.name],
                  ['Charger', selCharger.label],
                  ['Motor', `${selMotor.brand} ${selMotor.model}`],
                  ['Target', mode === 'idr' ? rupiah(amount) : `${amount} kWh`],
                  ['Estimasi biaya', rupiah(estCost)],
                  ['Tarif', `${rupiah(price)}/kWh`],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between py-3 first:pt-1 last:pb-1">
                    <span className="text-[13px] font-semibold text-ink-400">{k}</span>
                    <span className="text-sm font-bold">{v}</span>
                  </div>
                ))}
              </Card>
              <p className="rounded-control bg-sky-100/60 px-4 py-3 text-[12.5px] font-medium leading-relaxed text-ink-600">
                Saldo dipotong {rupiah(estCost)} di awal sebagai reservasi. Jika pengisian berhenti
                lebih cepat, sisa saldo otomatis dikembalikan.
              </p>
              {error && (
                <p className="rounded-control bg-danger-50 px-4 py-3 text-[13px] font-semibold text-danger-700" role="alert">
                  {error}
                </p>
              )}
              <Button variant="energy" loading={starting} onClick={startSession}>
                <Zap size={16} /> Mulai sekarang
              </Button>
            </div>
          )}

          {/* ===== 6. LIVE ===== */}
          {step === 6 && (
            <div className="flex flex-col items-center gap-5 text-center">
              <Badge tone="energy" pulse>Sedang mengisi daya</Badge>
              <p className="-mt-3 text-[13px] font-semibold text-ink-400">
                {selCharger?.label} · {selLocation?.name}
              </p>

              <div className="relative">
                <ProgressRing progress={progress} charging>
                  <p className="font-mono text-[13px] font-bold tabular text-sky-500">
                    {Math.round(Math.min(1, progress) * 100)}%
                  </p>
                  <p className="font-display text-[38px] font-extrabold leading-tight">
                    <CountUp value={tick?.energy ?? 0} decimals={3} />
                  </p>
                  <p className="text-[13px] font-bold text-ink-400">kWh</p>
                </ProgressRing>
                <BoltRain />
              </div>

              <FlowLink active />

              <Card className="w-full p-4 text-left">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Daya real-time</span>
                  <span className="font-mono text-sm font-bold tabular text-sky-500">
                    <CountUp value={tick?.power ?? 0} decimals={0} suffix=" W" />
                  </span>
                </div>
                <Sparkline points={powerHistory} />
              </Card>

              <div className="grid w-full grid-cols-2 gap-2">
                {[
                  ['Tegangan', tick ? `${tick.voltage.toFixed(1)} V` : '—'],
                  ['Arus', tick ? `${tick.current.toFixed(1)} A` : '—'],
                  ['Biaya', tick ? rupiah(tick.cost) : '—'],
                  ['Durasi', tick ? duration(tick.elapsed) : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-card">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-400">{k}</p>
                    <p className="whitespace-nowrap font-mono text-[13.5px] font-bold tabular">{v}</p>
                  </div>
                ))}
              </div>

              <Button variant="danger" onClick={stopSession} className="mt-1">
                Hentikan sesi
              </Button>
            </div>
          )}

          {/* ===== 7. Ringkasan ===== */}
          {step === 7 && finalResult && (
            <div className="relative flex flex-col items-center gap-5 pt-6 text-center">
              {finalResult.status !== 'FAULT' && <Confetti />}
              <div className={`pop-in flex h-20 w-20 items-center justify-center rounded-full ${finalResult.status === 'FAULT' ? 'bg-danger-50 text-danger-500' : 'bg-energy-100 text-energy-600'}`}>
                {finalResult.status === 'FAULT'
                  ? <TriangleAlert size={36} />
                  : finalResult.status === 'COMPLETED'
                    ? <PartyPopper size={36} />
                    : <CircleCheck size={36} />}
              </div>
              <div>
                <h2 className="font-display text-xl font-extrabold">
                  {finalResult.status === 'FAULT' ? 'Sesi terhenti' : 'Pengisian selesai'}
                </h2>
                <p className="mt-1 text-sm text-ink-400">
                  {finalResult.endReason === 'target_reached' ? 'Target tercapai — kerja bagus!'
                    : finalResult.endReason === 'user_stop' ? 'Dihentikan manual.'
                    : finalResult.endReason === 'cable_unplug' ? 'Kabel tercabut saat mengisi.'
                    : 'Terjadi gangguan pada mesin.'}
                </p>
              </div>

              <Card className="w-full">
                <div className="grid grid-cols-3 divide-x divide-line">
                  {[
                    ['Energi', `${finalResult.kwh.toFixed(3)} kWh`],
                    ['Biaya', rupiah(finalResult.cost)],
                    ['Durasi', duration(finalResult.durationSec)],
                  ].map(([k, v]) => (
                    <div key={k} className="px-2 py-1">
                      <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-400">{k}</p>
                      <p className="mt-1 font-display text-[15px] font-extrabold tabular">{v}</p>
                    </div>
                  ))}
                </div>
                {finalResult.refund > 0 && (
                  <p className="mt-4 rounded-xl bg-energy-50 px-3 py-2.5 text-[13px] font-bold text-energy-700">
                    {rupiah(finalResult.refund)} dikembalikan ke saldo
                  </p>
                )}
              </Card>

              <div className="flex w-full gap-2.5">
                <Button variant="outline" onClick={() => navigate('/riwayat')} className="flex-1">
                  Lihat riwayat
                </Button>
                <Button variant="primary" onClick={() => navigate('/')} className="flex-1">
                  Ke beranda
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
