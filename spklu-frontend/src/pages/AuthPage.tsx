import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, Field } from '../components/ui';
import { Modal } from '../components/overlay';
import { CurrentLine } from '../components/energy';

interface PendingRegister { name: string; email: string; phone?: string; password: string }

export default function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [tncOpen, setTncOpen] = useState(false);
  const [pending, setPending] = useState<PendingRegister | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);

    if (mode === 'login') {
      setBusy(true);
      try {
        await login(String(f.get('identifier')), String(f.get('password')));
        navigate('/', { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
      } finally {
        setBusy(false);
      }
      return;
    }

    // Daftar: cek konfirmasi password dulu, baru tampilkan Syarat & Ketentuan —
    // akun baru sungguh dibuat hanya setelah user klik Setuju di modal.
    const password = String(f.get('password'));
    const password2 = String(f.get('password2'));
    if (password !== password2) {
      setError('Konfirmasi password tidak sama dengan password di atas');
      return;
    }
    setPending({
      name: String(f.get('name')),
      email: String(f.get('email')),
      phone: String(f.get('phone') || '') || undefined,
      password,
    });
    setTncOpen(true);
  };

  const confirmRegister = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await register(pending);
      setTncOpen(false);
      navigate('/', { replace: true });
    } catch (err) {
      setTncOpen(false);
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    } finally {
      setBusy(false);
    }
  };

  const eyeButton = (shown: boolean, toggle: () => void, label: string) => (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      tabIndex={-1}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-surface-sunken hover:text-ink-600"
    >
      {shown ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {/* Aurora latar — teknik mesh gradient versi light */}
      <div className="aurora left-[-15%] top-[-20%] h-[55vh] w-[55vw]" style={{ background: 'rgba(29,102,224,0.18)' }} />
      <div className="aurora right-[-10%] top-[10%] h-[45vh] w-[40vw]" style={{ background: 'rgba(56,189,248,0.16)', animationDelay: '-4s' }} />
      <div className="aurora bottom-[-25%] left-[20%] h-[50vh] w-[50vw]" style={{ background: 'rgba(16,185,129,0.13)', animationDelay: '-8s' }} />

      <div className="rise-in relative w-full max-w-[420px]">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="soft-float shine mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-grad-deep shadow-glow">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="currentColor">
              <polygon points="13,2 4,14 11,14 9,22 20,9 12,9" />
            </svg>
          </div>
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink-900">
            CMW <span className="bg-grad-energy bg-clip-text text-transparent">Charge</span>
          </h1>
          <p className="mt-1 text-sm font-medium text-ink-400">
            Jaringan pengisian motor listrik
          </p>
        </div>

        <div className="rounded-card bg-white/85 p-7 shadow-raise backdrop-blur-xl">
          {/* Tab login/daftar dengan garis arus sebagai indikator */}
          <div className="mb-6 grid grid-cols-2 gap-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(''); }}
                className={`cursor-pointer rounded-none bg-transparent pb-2.5 pt-1 text-sm font-bold transition-colors ${mode === m ? 'text-ink-900' : 'text-ink-400 hover:text-ink-600'}`}
              >
                {m === 'login' ? 'Masuk' : 'Daftar'}
                <CurrentLine active={mode === m} className="mt-2" />
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <>
                <Field label="Nama lengkap" name="name" required autoComplete="name" placeholder="Nama Anda" />
                <Field label="No. HP (opsional)" name="phone" type="tel" autoComplete="tel" placeholder="08…" />
              </>
            )}
            {mode === 'login' ? (
              <Field label="Email atau No. HP" name="identifier" required autoComplete="username" placeholder="nama@email.com" />
            ) : (
              <Field label="Email" name="email" type="email" required autoComplete="email" placeholder="nama@email.com" />
            )}
            <Field
              label="Password" name="password" type={showPw ? 'text' : 'password'} required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8} placeholder="Minimal 8 karakter"
              endAdornment={eyeButton(showPw, () => setShowPw((v) => !v), showPw ? 'Sembunyikan password' : 'Tampilkan password')}
            />
            {mode === 'register' && (
              <Field
                label="Ulangi password" name="password2" type={showPw2 ? 'text' : 'password'} required
                autoComplete="new-password" minLength={8} placeholder="Ketik ulang password"
                endAdornment={eyeButton(showPw2, () => setShowPw2((v) => !v), showPw2 ? 'Sembunyikan password' : 'Tampilkan password')}
              />
            )}
            {error && (
              <p className="rounded-control bg-danger-50 px-4 py-3 text-[13px] font-semibold text-danger-700" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="energy" loading={busy} className="shine mt-1 w-full">
              {mode === 'login' ? 'Masuk' : 'Buat akun'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs font-medium text-ink-400">
          Rp 2.440/kWh · Semua stasiun · Tanpa langganan
        </p>
      </div>

      <Modal open={tncOpen} onClose={() => setTncOpen(false)} title="Syarat & Ketentuan" wide>
        <div className="max-h-[45vh] overflow-y-auto rounded-control border border-line bg-surface-sunken p-4 text-[13px] leading-relaxed text-ink-600">
          <p className="mb-3">
            Dengan membuat akun CMW Charge, Anda menyetujui hal-hal berikut:
          </p>
          <ol className="list-decimal space-y-2 pl-4">
            <li>Saldo yang sudah di-top-up digunakan untuk membayar sesi pengisian daya dan tidak dapat dicairkan kembali menjadi uang tunai, kecuali atas kebijakan admin.</li>
            <li>Setiap top-up diverifikasi manual oleh admin berdasarkan mutasi pembayaran sebelum saldo ditambahkan ke akun Anda.</li>
            <li>Biaya pengisian dihitung berdasarkan tarif per kWh yang berlaku saat sesi berjalan dan dapat berubah sewaktu-waktu.</li>
            <li>Anda bertanggung jawab menjaga kerahasiaan email/nomor HP dan password akun Anda.</li>
            <li>Data yang Anda berikan (nama, email, nomor HP) digunakan untuk keperluan operasional layanan CMW Charge dan tidak dibagikan ke pihak ketiga tanpa izin.</li>
            <li>CMW Charge berhak menonaktifkan akun yang terindikasi melakukan penyalahgunaan sistem.</li>
          </ol>
        </div>
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setTncOpen(false)}>Batal</Button>
          <Button variant="energy" loading={busy} onClick={confirmRegister}>
            Setuju & Buat Akun
          </Button>
        </div>
      </Modal>
    </div>
  );
}
