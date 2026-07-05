// Chart SVG ringan bergaya "Arus": bar pendapatan + donut status.
// Tanpa library — konsisten dengan sparkline, bundle tetap kecil.
import { useMemo, useState } from 'react';

const fmtShort = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`
  : n >= 1_000 ? `${Math.round(n / 1_000)}rb`
  : String(Math.round(n));

// ===== Bar chart pendapatan =====
export function RevenueBars({ data }: { data: { bucket: string; revenue: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 220, PAD = { t: 14, r: 8, b: 30, l: 46 };
  const max = Math.max(...data.map((d) => d.revenue), 1) * 1.15;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const bw = Math.min(38, (innerW / Math.max(data.length, 1)) * 0.62);

  const ticks = useMemo(() => [0, 0.5, 1].map((f) => max * f), [max]);

  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-ink-400">
        Belum ada data pendapatan pada rentang ini.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      role="img"
      aria-label={`Grafik pendapatan, tertinggi ${fmtShort(max / 1.15)} rupiah`}
    >
      <defs>
        <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#1D66E0" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => {
        const y = PAD.t + innerH - (t / max) * innerH;
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#EDF2F8" strokeWidth="1" />
            <text x={PAD.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#7C8AA0" fontFamily="'JetBrains Mono',monospace">
              {fmtShort(t)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = PAD.l + (innerW / data.length) * (i + 0.5) - bw / 2;
        const h = (d.revenue / max) * innerH;
        const y = PAD.t + innerH - h;
        const active = hover === i;
        return (
          <g
            key={d.bucket}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            style={{ cursor: 'pointer', outline: 'none' }}
          >
            {/* area hit lebih lebar dari bar */}
            <rect x={x - 8} y={PAD.t} width={bw + 16} height={innerH} fill="transparent" />
            <rect
              x={x} y={y} width={bw} height={Math.max(h, 2)} rx="6"
              fill="url(#barGrad)" opacity={hover === null || active ? 1 : 0.45}
              style={{ transition: 'opacity .15s ease' }}
            />
            {active && (
              <>
                <rect x={x + bw / 2 - 44} y={y - 26} width="88" height="20" rx="6" fill="#0A1A32" />
                <text x={x + bw / 2} y={y - 12} textAnchor="middle" fontSize="10.5" fill="#fff" fontFamily="'JetBrains Mono',monospace">
                  Rp {d.revenue.toLocaleString('id-ID')}
                </text>
              </>
            )}
            <text
              x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="9.5" fill="#7C8AA0"
              fontFamily="'Plus Jakarta Sans',sans-serif"
            >
              {d.bucket.length > 7 ? d.bucket.slice(5) : d.bucket}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ===== Donut status (maks 4 segmen) =====
export function Donut({
  segments, centerLabel, centerValue,
}: { segments: { label: string; value: number; color: string }[]; centerLabel: string; centerValue: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-[124px] w-[124px] shrink-0" role="img"
        aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="#EDF2F8" strokeWidth="16" />
        {segments.map((s) => {
          const frac = s.value / total;
          const dash = `${frac * C} ${C}`;
          const offset = -acc * C;
          acc += frac;
          return (
            <circle
              key={s.label} cx="70" cy="70" r={R} fill="none"
              stroke={s.color} strokeWidth="16" strokeLinecap="butt"
              strokeDasharray={dash} strokeDashoffset={offset}
              transform="rotate(-90 70 70)"
              style={{ transition: 'stroke-dasharray .5s cubic-bezier(0.16,1,0.3,1)' }}
            />
          );
        })}
        <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="800" fill="#0A1A32" fontFamily="Sora,sans-serif">
          {centerValue}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="9" fontWeight="700" fill="#7C8AA0" fontFamily="'Plus Jakarta Sans',sans-serif">
          {centerLabel}
        </text>
      </svg>
      <ul className="flex flex-col gap-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="font-semibold text-ink-600">{s.label}</span>
            <span className="font-mono font-bold tabular">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
