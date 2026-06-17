const BASE = '/api';
let token = null;

export function setToken(t) { token = t; }
export function getStoredAuth() {
  try { return JSON.parse(localStorage.getItem('truehr_auth') || 'null'); } catch { return null; }
}
export function storeAuth(auth) {
  if (auth) localStorage.setItem('truehr_auth', JSON.stringify(auth));
  else localStorage.removeItem('truehr_auth');
}

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
};
