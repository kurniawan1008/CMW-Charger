/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tinta biru-malam (bukan abu-abu) — identitas "jalan raya malam"
        ink: {
          900: '#0A1A32',
          700: '#24375B',
          600: '#3C4C66',
          400: '#7C8AA0',
          300: '#A8B3C4',
        },
        surface: {
          DEFAULT: '#F5F8FC',
          card: '#FFFFFF',
          sunken: '#EDF2F8',
        },
        line: '#E4EBF3',
        // Electric blue — primary
        cmw: {
          50: '#EEF5FE',
          100: '#D9E8FC',
          500: '#2E7CEB',
          600: '#1D66E0',
          700: '#1552BC',
        },
        sky: {
          100: '#E0F4FE',
          400: '#38BDF8',
          500: '#0EA5E9',
        },
        // Hijau energi — HANYA untuk charging aktif & nilai positif
        energy: {
          50: '#ECFDF5',
          100: '#D1FAE9',
          500: '#10B981',
          600: '#0A9E6E',
          700: '#087F58',
        },
        amber: { 100: '#FEF3C7', 500: '#F59E0B', 700: '#B45309' },
        danger: { 50: '#FEF1F2', 500: '#E5484D', 700: '#BE3239' },
      },
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        card: '20px',
        control: '14px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(10,26,50,0.04), 0 8px 24px rgba(10,26,50,0.06)',
        raise: '0 2px 4px rgba(10,26,50,0.06), 0 16px 40px rgba(10,26,50,0.12)',
        glow: '0 0 0 1px rgba(29,102,224,0.12), 0 8px 32px rgba(29,102,224,0.25)',
        'glow-energy': '0 0 0 1px rgba(16,185,129,0.15), 0 8px 32px rgba(16,185,129,0.28)',
      },
      backgroundImage: {
        'grad-energy': 'linear-gradient(135deg,#1D66E0 0%,#38BDF8 55%,#10B981 100%)',
        'grad-deep': 'linear-gradient(135deg,#0A1A32 0%,#1552BC 60%,#0EA5E9 100%)',
      },
    },
  },
  plugins: [],
};
