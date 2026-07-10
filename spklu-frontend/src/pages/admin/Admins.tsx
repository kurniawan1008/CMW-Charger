import { useEffect, useState, type FormEvent } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Button, Field, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, useToast } from '../../components/overlay';
import { PageHeader, Table } from './shared';

interface AdminRow {
  id: number; email: string; full_name: string;
  role: 'ADMIN' | 'SUPERADMIN'; status: 'ACTIVE' | 'SUSPENDED'; created_at: string;
}

export default function Admins() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<AdminRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<AdminRow[]>('/admin/admins').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api.post('/admin/admins', {
        name: f.get('name'), email: f.get('email'), password: f.get('password'),
      });
      toast('ok', 'Akun admin dibuat.');
      setCreating(false);
      await load();
    } catch (err) {
      toast('err', err instanceof Error ? err.message : 'Gagal membuat admin');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        title="Akun Admin"
        sub="Hanya superadmin yang bisa menambah / menonaktifkan admin"
        icon={<ShieldCheck size={20} />}
        action={<Button onClick={() => setCreating(true)}><Plus size={15} /> Tambah admin</Button>}
      />

      <Table head={['Nama', 'Email', 'Peran', 'Status', 'Dibuat', '']}>
        {rows.map((a) => (
          <tr key={a.id} className="transition-colors hover:bg-surface-sunken/50">
            <td className="px-4 py-3 font-bold">
              {a.full_name}
              {a.id === user?.id && <span className="ml-2 text-[11px] font-semibold text-ink-400">(Anda)</span>}
            </td>
            <td className="px-4 py-3 text-ink-600">{a.email}</td>
            <td className="px-4 py-3">
              {a.role === 'SUPERADMIN'
                ? <Badge tone="amber"><ShieldCheck size={11} /> Superadmin</Badge>
                : <Badge tone="blue">Admin</Badge>}
            </td>
            <td className="px-4 py-3">
              {a.status === 'ACTIVE' ? <Badge tone="energy">Aktif</Badge> : <Badge tone="danger">Nonaktif</Badge>}
            </td>
            <td className="px-4 py-3 text-[12px] text-ink-400">{dateTime(a.created_at)}</td>
            <td className="px-4 py-3 text-right">
              {a.role === 'ADMIN' && a.status === 'ACTIVE' && (
                <Button variant="danger" onClick={() => setDeactivating(a)} className="!px-3.5 !py-2 !text-[12px]">
                  Nonaktifkan
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={creating} onClose={() => setCreating(false)} title="Tambah akun admin">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Nama lengkap" name="name" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Password" name="password" type="password" required minLength={8} hint="Minimal 8 karakter — minta admin menggantinya setelah login pertama." />
          <div className="mt-1 flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Batal</Button>
            <Button type="submit" loading={busy}>Buat akun</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        onConfirm={async () => {
          if (!deactivating) return;
          await api.post(`/admin/admins/${deactivating.id}/deactivate`);
          toast('ok', 'Akun admin dinonaktifkan.');
          await load();
        }}
        title="Nonaktifkan admin?"
        body={`${deactivating?.full_name} tidak akan bisa login lagi sampai diaktifkan ulang.`}
        confirmLabel="Nonaktifkan"
        danger
      />
    </div>
  );
}
