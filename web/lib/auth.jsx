'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getStoredAuth, storeAuth } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null);
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage on the client only (avoids SSR mismatch).
  useEffect(() => {
    const a = getStoredAuth();
    if (a?.token) setToken(a.token);
    setAuth(a);
    setReady(true);
  }, []);

  async function login(email, password) {
    const data = await api.post('/auth/login', { email, password });
    setToken(data.token);
    const a = { token: data.token, user: data.user };
    storeAuth(a);
    setAuth(a);
    return data.user;
  }
  function logout() { setToken(null); storeAuth(null); setAuth(null); }
  function patchUser(patch) {
    setAuth((prev) => {
      const next = { ...prev, user: { ...prev.user, ...patch } };
      storeAuth(next);
      return next;
    });
  }

  return (
    <AuthCtx.Provider value={{ auth, user: auth?.user, login, logout, patchUser, ready }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
