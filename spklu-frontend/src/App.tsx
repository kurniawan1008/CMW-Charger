import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import AuthPage from './pages/AuthPage';
import UserLayout from './layouts/UserLayout';
import Home from './pages/user/Home';
import Wizard from './pages/user/Wizard';
import History from './pages/user/History';
import Wallet from './pages/user/Wallet';
import Profile from './pages/user/Profile';
import AdminLayout from './layouts/AdminLayout';
import Overview from './pages/admin/Overview';
import Locations from './pages/admin/Locations';
import Machines from './pages/admin/Machines';
import Channels from './pages/admin/Channels';
import Motors from './pages/admin/Motors';
import Topups from './pages/admin/Topups';
import Logs from './pages/admin/Logs';
import AdminUsers from './pages/admin/Users';
import Admins from './pages/admin/Admins';

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-cmw-100 border-t-cmw-600" />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;

  if (!user) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN';

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="lokasi" element={<Locations />} />
          <Route path="mesin" element={<Machines />} />
          <Route path="channel" element={<Channels />} />
          <Route path="motor" element={<Motors />} />
          <Route path="topup" element={<Topups />} />
          <Route path="log" element={<Logs />} />
          <Route path="users" element={<AdminUsers />} />
          {user.role === 'SUPERADMIN' && <Route path="admins" element={<Admins />} />}
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<UserLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/riwayat" element={<History />} />
        <Route path="/saldo" element={<Wallet />} />
        <Route path="/profil" element={<Profile />} />
      </Route>
      <Route path="/charge" element={<Wizard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
