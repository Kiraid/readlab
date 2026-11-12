import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, UNAUTHORIZED, type User } from './api';

interface AuthState {
  user: User | null;
  ready: boolean;
  setUser: (u: User | null) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, ready: false, setUser: () => {}, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api.me().then(setUser, () => setUser(null)).finally(() => setReady(true));
    const lost = () => setUser(null);
    window.addEventListener(UNAUTHORIZED, lost);
    return () => window.removeEventListener(UNAUTHORIZED, lost);
  }, []);
  const signOut = async () => {
    try { await api.signOut(); } finally { setUser(null); }
  };
  return <Ctx.Provider value={{ user, ready, setUser, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
