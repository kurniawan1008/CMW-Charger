// Shell admin: sidebar glass + topbar dengan bell notifikasi realtime.
// Motif arus: garis mengalir di item nav aktif — bahasa yang sama dengan user app.
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  LayoutDashboard, MapPin, HardDrive, PlugZap, Bike, WalletCards,
  ScrollText, Users, ShieldCheck, Bell, LogOut, Zap, Menu, X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTopic } from '../lib/ws';
import { api } from '../lib/api';
import { CurrentLine } from '../components/energy';
import { useToast, ConfirmDialog } from '../components/overlay';
import type { Paged } from '../lib/types';

interface Notif { id: number; type: string; title: string; body: string | null; is_read: number; created_at: string }

const NAV = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/lokasi', label: 'Lokasi SPKLU', icon: MapPin },
  { to: '/admin/mesin', label: 'Mesin', icon: HardDrive },
  { to: '/admin/channel', label: 'Channel', icon: PlugZap },
  { to: '/admin/motor', label: 'Motor Profiles', icon: Bike },
  { to: '/admin/topup', label: 'Top-Up', icon: WalletCards },
  { to: '/admin/log', label: 'Log Transaksi', icon: ScrollText },
  { to: '/admin/users', label: 'Pengguna', icon: Users },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const unread = notifs.filter((n) => !n.is_read).length;

  // Dropdown notifikasi: tutup saat klik luar / Escape / pindah halaman (audit M1).
  useEffect(() => {
    if (!bellOpen) return;
    const onDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBellOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellOpen]);
  useEffect(() => { setBellOpen(false); setNavOpen(false); }, [location.pathname]);

  const loadNotifs = () =>
    api.get<Paged<Notif>>('/admin/notifications?limit=12').then((r) => setNotifs(r.data)).catch(() => {});

  useEffect(() => { loadNotifs(); }, []);

  // Notifikasi realtime (fault mesin, dsb) -> toast + refresh daftar bell.
  useTopic('admin', (data) => {
    const d = data as { notification?: { title: string; body?: string } };
    if (d.notification) {
      toast('ok', `${d.notification.title}${d.notification.body ? ` — ${d.notification.body}` : ''}`);
      loadNotifs();
    }
  });

  const initials = (user?.fullName || 'A').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const nav = user?.role === 'SUPERADMIN'
    ? [...NAV, { to: '/admin/admins', label: 'Akun Admin', icon: ShieldCheck }]
    : NAV;

  return (
    <div className="flex min-h-dvh">
      {/* Overlay saat sidebar mobile terbuka */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink-900/40 backdrop-blur-sm lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: off-canvas di mobile, statis di layar besar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-line bg-white/95 backdrop-blur-xl transition-transform duration-300 ease-out lg:translate-x-0 lg:bg-white/80 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-grad-deep shadow-glow">
            <Zap size={17} className="fill-white text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-extrabold leading-tight">
              CMW <span className="bg-grad-energy bg-clip-text text-transparent">OS</span>
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Command Center</p>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Tutup menu"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-400 hover:bg-surface-sunken lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `mb-0.5 flex cursor-pointer flex-col rounded-xl px-3 py-2.5 transition-colors ${isActive ? 'bg-cmw-50 text-cmw-700' : 'text-ink-600 hover:bg-surface-sunken'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="flex items-center gap-2.5">
                    <Icon size={17} strokeWidth={isActive ? 2.4 : 2} />
                    <span className={`text-[13px] ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{label}</span>
                  </span>
                  {isActive && <CurrentLine active className="mt-1.5" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <button
            onClick={logout}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-danger-500 transition-colors hover:bg-danger-50"
          >
            <LogOut size={16} /> Keluar
          </button>
        </div>
      </aside>

      {/* Konten */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[232px]">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-surface/85 px-4 py-3.5 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Buka menu"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-white text-ink-600 hover:border-cmw-500 hover:text-cmw-600 lg:hidden"
            >
              <Menu size={17} />
            </button>
            <p className="truncate text-[12px] font-semibold text-ink-400 sm:text-[13px]">
              <span className="hidden sm:inline">Jaringan pengisian motor listrik · </span>
              <span className="font-mono">Rp 2.440/kWh</span>
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative" ref={bellRef}>
              <button
                onClick={() => setBellOpen((v) => !v)}
                aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ''}`}
                aria-expanded={bellOpen}
                aria-haspopup="true"
                className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-line bg-white text-ink-600 transition-colors hover:border-cmw-500 hover:text-cmw-600"
              >
                <Bell size={17} />
                {unread > 0 && (
                  <span className="pop-in absolute -right-1 -top-1 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-extrabold text-white">
                    {unread}
                  </span>
                )}
              </button>
              <AnimatePresence>
                {bellOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    className="fixed left-4 right-4 top-16 z-50 rounded-card border border-line bg-white p-2 shadow-raise sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[340px]"
                  >
                    <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-ink-400">Notifikasi</p>
                    {notifs.length === 0 && (
                      <p className="px-3 py-6 text-center text-[13px] text-ink-400">Belum ada notifikasi.</p>
                    )}
                    <div className="max-h-[320px] overflow-y-auto">
                      {notifs.map((n) => (
                        <div key={n.id} className={`rounded-xl px-3 py-2.5 ${n.is_read ? '' : 'bg-cmw-50/60'}`}>
                          <p className="text-[13px] font-bold leading-snug">{n.title}</p>
                          {n.body && <p className="text-xs text-ink-400">{n.body}</p>}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={() => setLogoutConfirm(true)}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-white py-1.5 pl-1.5 pr-2 transition-colors hover:border-cmw-500 sm:pr-3.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-grad-deep text-[11px] font-extrabold text-white">
                {initials}
              </span>
              <span className="hidden truncate text-[13px] font-bold sm:inline">{user?.fullName}</span>
              {user?.role === 'SUPERADMIN' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-700">Super</span>
              )}
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.main
            key={location.pathname}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduce ? 0.1 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-7 sm:py-6"
          >
            <Outlet />
          </motion.main>
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={logoutConfirm}
        onClose={() => setLogoutConfirm(false)}
        onConfirm={logout}
        title="Keluar dari akun?"
        body="Anda perlu login kembali untuk mengakses Command Center."
        confirmLabel="Ya, keluar"
        danger
      />
    </div>
  );
}
