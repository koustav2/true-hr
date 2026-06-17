const BASE = '/api';
let token = null;

export function setToken(t) { token = t; }

export function getStoredAuth() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('truehr_auth') || 'null'); } catch { return null; }
}
export function storeAuth(auth) {
  if (typeof window === 'undefined') return;
  if (auth) localStorage.setItem('truehr_auth', JSON.stringify(auth));
  else localStorage.removeItem('truehr_auth');
}

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  // Session expired/invalid → clear auth and send the user back to login (skip the login call itself).
  if (res.status === 401 && path !== '/auth/login' && typeof window !== 'undefined') {
    storeAuth(null); setToken(null);
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login?expired=1');
    }
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { error: text.slice(0, 200) }; }   // non-JSON body (e.g. a proxy/500 page)
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(res.status >= 500 && !data?.error ? `Server error (${res.status}). Is the backend running?` : msg);
  }
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
};
