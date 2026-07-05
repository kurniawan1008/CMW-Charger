import { NavLink, Outlet } from 'react-router-dom';
import { House, Wallet2, History, UserRound } from 'lucide-react';

const tabs = [
  { to: '/', label: 'Beranda', icon: House },
  { to: '/saldo', label: 'Saldo', icon: Wallet2 },
  { to: '/riwayat', label: 'Riwayat', icon: History },
  { to: '/profil', label: 'Profil', icon: UserRound },
];

export default function UserLayout() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col">
      <main className="flex-1 px-4 pb-28 pt-6">
        <Outlet />
      </main>

      {/* Bottom nav — pengguna memakai HP sambil berdiri di stasiun */}
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[520px] px-4 pb-4">
        <div className="flex items-center justify-around rounded-[22px] border border-line bg-white/90 py-2 shadow-raise backdrop-blur-xl">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex min-w-[64px] cursor-pointer flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-colors ${isActive ? 'text-cmw-600' : 'text-ink-400 hover:text-ink-600'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={21} strokeWidth={isActive ? 2.4 : 2} />
                  <span className={`text-[10.5px] ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{label}</span>
                  <span className={`h-1 w-5 rounded-full transition-all ${isActive ? 'bg-grad-energy' : 'bg-transparent'}`} />
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
