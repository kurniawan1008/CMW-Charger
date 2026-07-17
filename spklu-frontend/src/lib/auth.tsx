import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';
import { clientSocket } from './ws';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  register: (data: { name: string; email: string; phone?: string; password: string }) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!tokenStore.get()) { setUser(null); return; }
    try {
      const me = await api.get<User & { full_name: string }>('/user/me');
      setUser({ ...me, fullName: me.full_name });
    } catch {
      tokenStore.clear();
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const login = async (identifier: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { identifier, password });
    tokenStore.set(res.token);
    clientSocket.reset(); // koneksi WS ikut token baru
    setUser(res.user);
    return res.user;
  };

  const register = async (data: { name: string; email: string; phone?: string; password: string }) => {
    const res = await api.post<{ token: string; user: User }>('/auth/register', data);
    tokenStore.set(res.token);
    clientSocket.reset(); // koneksi WS ikut token baru, konsisten dengan login()
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    tokenStore.clear();
    clientSocket.reset();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
