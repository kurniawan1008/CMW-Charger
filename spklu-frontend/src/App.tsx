import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import AuthPage from './pages/AuthPage';
import UserLayout from './layouts/UserLayout';
import Home from './pages/user/Home';
import Wizard from './pages/user/Wizard';
import History from './pages/user/History';
import Wallet from './pages/user/Wallet';
import Profile from './pages/user/Profile';

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
