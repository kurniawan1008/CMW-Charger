// Motif khas "Arus" — garis arus listrik mengalir + instrumen ring + count-up.
import { useEffect, useRef, useState } from 'react';
import { PulseWave } from './motion';

// ===== CountUp: angka naik mulus (tabular, tidak goyang) =====
export function CountUp({
  value, decimals = 0, prefix = '', suffix = '', className = '',
}: { value: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const t0 = performance.now();
    const dur = 600;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return (
    <span className={`tabular ${className}`}>
      {prefix}
      {display.toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

// ===== CurrentLine: garis arus (signature) — dipakai di stepper, koneksi, nav =====
export function CurrentLine({ active, className = '' }: { active: boolean; className?: string }) {
  return (
    <svg className={className} height="4" width="100%" aria-hidden>
      <line x1="0" y1="2" x2="100%" y2="2" stroke="#E4EBF3" strokeWidth="3" strokeLinecap="round" />
      {active && (
        <line
          x1="0" y1="2" x2="100%" y2="2"
          stroke="url(#gradCurrent)" strokeWidth="3" strokeLinecap="round"
          className="current-flow"
        />
      )}
      <defs>
        {/* userSpaceOnUse: gradient pada <line> horizontal gagal dengan bounding box (tinggi 0) */}
        <linearGradient id="gradCurrent" x1="0" y1="0" x2="100%" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1D66E0" />
          <stop offset="60%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ===== ProgressRing: instrumen utama sesi charging =====
export function ProgressRing({
  progress, size = 260, stroke = 14, charging, children,
}: { progress: number; size?: number; stroke?: number; charging?: boolean; children: React.ReactNode }) {
  const r = (size - stroke) / 2 - 4;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {charging && (
        <span
          className="absolute rounded-full"
          style={{
            width: size * 0.62, height: size * 0.62,
            background: 'radial-gradient(circle, rgba(56,189,248,0.16), transparent 65%)',
            animation: 'ringBreathe 2.6s ease-in-out infinite',
          }}
        />
      )}
      <svg width={size} height={size} className="relative -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDF2F8" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="url(#gradRing)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - clamped)}
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)',
            filter: charging ? 'drop-shadow(0 0 8px rgba(56,189,248,0.5))' : undefined,
          }}
        />
        <defs>
          <linearGradient id="gradRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1D66E0" />
            <stop offset="55%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
      </svg>
      <div className={`absolute inset-0 flex flex-col items-center justify-center ${charging ? 'gauge-squish' : ''}`}>
        {children}
      </div>
    </div>
  );
}

// ===== FlowLink: koneksi charger -> kendaraan dengan arus mengalir =====
export function FlowLink({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-3" aria-hidden>
      <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-grad-deep shadow-glow">
        {active && <PulseWave color="rgba(56,189,248,0.4)" />}
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor">
          <polygon points="13,2 4,14 11,14 9,22 20,9 12,9" />
        </svg>
      </div>
      <svg width="110" height="14" className="overflow-visible">
        <line x1="0" y1="7" x2="110" y2="7" stroke="#E4EBF3" strokeWidth="4" strokeLinecap="round" />
        {active && (
          <line x1="0" y1="7" x2="110" y2="7" stroke="url(#gradCurrent2)" strokeWidth="4" strokeLinecap="round" className="current-flow" />
        )}
        <defs>
          <linearGradient id="gradCurrent2" x1="0" y1="0" x2="110" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1D66E0" />
            <stop offset="60%" stopColor="#0EA5E9" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
      </svg>
      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border-2 transition-colors ${active ? 'border-energy-500 bg-energy-50' : 'border-line bg-white'}`}>
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${active ? 'text-energy-600' : 'text-ink-300'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18.5" cy="17.5" r="3.5" /><circle cx="5.5" cy="17.5" r="3.5" />
          <path d="M15 6a1 1 0 1 0 0-2a1 1 0 0 0 0 2m-3 11.5V14l-3-3l4-3l2 3h2" />
        </svg>
      </div>
    </div>
  );
}

// ===== Sparkline daya real-time =====
export function Sparkline({ points, height = 54 }: { points: number[]; height?: number }) {
  if (points.length < 2) return <div style={{ height }} />;
  const w = 280;
  const max = Math.max(...points) * 1.15 || 1;
  const coords = points.map((p, i) => [ (i / (points.length - 1)) * w, height - (p / max) * (height - 6) ]);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="block w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <path d={area} fill="url(#sparkArea)" />
      <path d={line} fill="none" stroke="#0EA5E9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(14,165,233,0.35)" />
          <stop offset="100%" stopColor="rgba(14,165,233,0)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
