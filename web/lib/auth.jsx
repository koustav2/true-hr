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

  function establish(data) {
    setToken(data.token);
    const a = { token: data.token, user: data.user };
    storeAuth(a);
    setAuth(a);
    return data.user;
  }
  async function login(email, password) {
    const data = await api.post('/auth/login', { email, password });
    // Two-step login: server emailed a code instead of a session.
    if (data.otpRequired) return { otpRequired: true, maskedEmail: data.email };
    return establish(data);
  }
  async function verifyLoginOtp(email, otp) {
    const data = await api.post('/auth/login/verify-otp', { email, otp });
    return establish(data);
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
    <AuthCtx.Provider value={{ auth, user: auth?.user, login, verifyLoginOtp, logout, patchUser, ready }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
