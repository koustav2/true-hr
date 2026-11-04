// The portal speaks API v2 (QA fix pass). v1 (/api) stays as it was for clients
// already in the field — the Android app above all.
export const API_BASE = '/api/v2';
const BASE = API_BASE;
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
  // On a full page reload the in-memory token is null until AuthProvider rehydrates;
  // fall back to the stored token so requests aren't sent unauthenticated (which
  // would 401 and bounce the user to /login — seen when switching organisations).
  const bearer = token || (typeof window !== 'undefined' ? getStoredAuth()?.token : null);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  // Session expired/invalid → clear auth and send the user back to login (skip the login call itself).
  // Calls that legitimately answer 401 for a bad credential or handoff token
  // must show their own message, not "session expired".
  const credentialCall = /^\/auth\/(login|web-sso|forgot-password|reset-password)/.test(path);
  if (res.status === 401 && !credentialCall && typeof window !== 'undefined') {
    storeAuth(null); setToken(null);
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    if (!window.location.pathname.startsWith(`${base}/login`)) {
      window.location.assign(`${base}/login?expired=1`);
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
    const err = new Error(res.status >= 500 && !data?.error ? `Server error (${res.status}). Is the backend running?` : msg);
    err.status = res.status;
    err.fields = data?.fields || null;   // v2: { fieldKey: message } for every invalid field
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  patch: (p, b) => req('PATCH', p, b),
  put: (p, b) => req('PUT', p, b),
  del: (p) => req('DELETE', p),
};

// Authenticated file download (CSV/XLSX exports) — fetches as a blob and
// triggers a browser download.
export async function downloadFile(path, filename) {
  const headers = {};
  const bearer = token || (typeof window !== 'undefined' ? getStoredAuth()?.token : null);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function authHeaders() {
  const bearer = token || (typeof window !== 'undefined' ? getStoredAuth()?.token : null);
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

// Authenticated GET of a file. Throws an Error carrying the server's message
// (never fails silently), and treats 401 like every other call.
export async function fetchBlob(path) {
  const res = await fetch(BASE + path, { headers: authHeaders() });
  if (res.status === 401 && typeof window !== 'undefined') {
    storeAuth(null); setToken(null);
    window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/login?expired=1`);
  }
  if (!res.ok) {
    let msg = `Could not open the file (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.blob();
}

// Open an authenticated file in a new tab. The tab is opened synchronously,
// inside the click, so Safari/Firefox popup blockers allow it; the blob is
// loaded into it afterwards. Returns a promise that rejects with the reason.
export async function openFile(path) {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const blob = await fetchBlob(path);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

// Absolute URL for an <a href>/<img src> to an unauthenticated API path.
export const apiUrl = (path) => BASE + path;
