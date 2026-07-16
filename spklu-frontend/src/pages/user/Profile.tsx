import { useState, type FormEvent } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { Button, Card, Field } from '../../components/ui';
import { ConfirmDialog } from '../../components/overlay';

export default function Profile() {
  const { user, logout, refresh } = useAuth();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busyProfile, setBusyProfile] = useState(false);
  const [busyPass, setBusyPass] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  const initials = (user?.fullName || '?')
    .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  const saveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null); setBusyProfile(true);
    const f = new FormData(e.currentTarget);
    try {
      await api.patch('/user/me', { name: f.get('name'), phone: f.get('phone') });
      await refresh();
      setMsg({ kind: 'ok', text: 'Profil tersimpan.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan' });
    } finally { setBusyProfile(false); }
  };

  const changePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null); setBusyPass(true);
    const f = new FormData(e.currentTarget);
    try {
      await api.post('/user/me/password', { old: f.get('old'), new: f.get('new') });
      (e.target as HTMLFormElement).reset();
      setMsg({ kind: 'ok', text: 'Password diubah.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Gagal mengubah password' });
    } finally { setBusyPass(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => setLogoutConfirm(true)}
        className="rise-in flex cursor-pointer items-center gap-4 rounded-card text-left transition-opacity hover:opacity-80"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-grad-deep font-display text-xl font-extrabold text-white shadow-glow">
          {initials}
        </div>
        <div>
          <h1 className="font-display text-lg font-extrabold">{user?.fullName}</h1>
          <p className="text-sm text-ink-400">{user?.email}</p>
        </div>
      </button>

      {msg && (
        <p className={`rounded-control px-4 py-3 text-[13px] font-semibold ${msg.kind === 'ok' ? 'bg-energy-50 text-energy-700' : 'bg-danger-50 text-danger-700'}`} role="alert">
          {msg.text}
        </p>
      )}

      <Card className="rise-in" style={{ animationDelay: '60ms' }}>
        <h2 className="mb-4 font-display text-[15px] font-bold">Data akun</h2>
        <form onSubmit={saveProfile} className="flex flex-col gap-4">
          <Field label="Nama lengkap" name="name" defaultValue={user?.fullName} required />
          <Field label="No. HP" name="phone" type="tel" defaultValue={user?.phone ?? ''} />
          <Button type="submit" loading={busyProfile}>Simpan perubahan</Button>
        </form>
      </Card>

      <Card className="rise-in" style={{ animationDelay: '120ms' }}>
        <h2 className="mb-4 font-display text-[15px] font-bold">Ubah password</h2>
        <form onSubmit={changePassword} className="flex flex-col gap-4">
          <Field label="Password lama" name="old" type="password" required autoComplete="current-password" />
          <Field label="Password baru" name="new" type="password" required minLength={8} autoComplete="new-password" hint="Minimal 8 karakter." />
          <Button type="submit" variant="outline" loading={busyPass}>Ubah password</Button>
        </form>
      </Card>

      <Button variant="danger" onClick={() => setLogoutConfirm(true)} className="rise-in" style={{ animationDelay: '180ms' }}>
        <LogOut size={16} /> Keluar
      </Button>

      <ConfirmDialog
        open={logoutConfirm}
        onClose={() => setLogoutConfirm(false)}
        onConfirm={logout}
        title="Keluar dari akun?"
        body="Anda perlu login kembali untuk mengakses akun CMW Charge."
        confirmLabel="Ya, keluar"
        danger
      />
    </div>
  );
}
