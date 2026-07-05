// Efek motion "energi hidup": petir naik, gelombang, confetti perayaan.
// Semua deterministik (tanpa Math.random di render) agar stabil di StrictMode.
import { useMemo } from 'react';

const PALETTE = ['#1D66E0', '#38BDF8', '#10B981', '#0EA5E9', '#F59E0B'];

// Confetti perayaan — meledak dari tengah, warna brand.
export function Confetti({ count = 18 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const dist = 70 + (i % 4) * 26;
        return {
          dx: `${Math.cos(angle) * dist}px`,
          dy: `${Math.sin(angle) * dist - 30}px`,
          color: PALETTE[i % PALETTE.length],
          delay: `${(i % 6) * 70}ms`,
          size: 5 + (i % 3) * 3,
          round: i % 2 === 0,
        };
      }),
    [count],
  );
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute"
          style={{
            width: p.size,
            height: p.size,
            borderRadius: p.round ? '50%' : 2,
            background: p.color,
            ['--dx' as string]: p.dx,
            ['--dy' as string]: p.dy,
            animation: `confettiPop 1.15s cubic-bezier(0.16,1,0.3,1) ${p.delay} both`,
          }}
        />
      ))}
    </div>
  );
}

// Petir kecil naik di dalam ring saat charging.
export function BoltRain() {
  const bolts = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        left: `${18 + i * 16}%`,
        delay: `${i * 0.55}s`,
        scale: 0.7 + (i % 3) * 0.2,
        color: i % 2 === 0 ? '#38BDF8' : '#10B981',
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[22%] top-[35%]" aria-hidden>
      {bolts.map((b, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          className="absolute bottom-0 h-4 w-4"
          style={{
            left: b.left,
            animation: `boltRise 2.1s ease-out ${b.delay} infinite`,
            transform: `scale(${b.scale})`,
            opacity: 0,
          }}
          fill={b.color}
        >
          <polygon points="13,2 4,14 11,14 9,22 20,9 12,9" />
        </svg>
      ))}
    </div>
  );
}

// Gelombang energi memancar dari elemen (dipakai di ikon charger saat live).
export function PulseWave({ color = 'rgba(29,102,224,0.35)' }: { color?: string }) {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      {[0, 1].map((i) => (
        <span
          key={i}
          className="absolute inset-0 rounded-2xl border-2"
          style={{
            borderColor: color,
            animation: `waveExpand 2s ease-out ${i * 1}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
