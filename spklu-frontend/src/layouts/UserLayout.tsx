import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { House, Wallet2, History, UserRound } from 'lucide-react';

const tabs = [
  { to: '/', label: 'Beranda', icon: House },
  { to: '/saldo', label: 'Saldo', icon: Wallet2 },
  { to: '/riwayat', label: 'Riwayat', icon: History },
  { to: '/profil', label: 'Profil', icon: UserRound },
];

export default function UserLayout() {
  const location = useLocation();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col">
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 px-4 pb-28 pt-6"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

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
                  {/* key memaksa remount saat aktif -> animasi pop terpicu tiap pindah tab */}
                  <span key={isActive ? 'on' : 'off'} className={isActive ? 'pop-in' : ''}>
                    <Icon size={21} strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  <span className={`text-[10.5px] ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{label}</span>
                  <span className={`h-1 w-5 rounded-full transition-all duration-300 ${isActive ? 'bg-grad-energy' : 'bg-transparent'}`} />
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
