'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// ============================================================================
// Live module permissions + the organisation switcher.
//
// The server is the only authority on what a user may open: the portal asks
// /me/permissions and renders the sidebar from the answer. That means a Super
// Admin can grant or revoke a module from the Roles screen and every affected
// user's navigation changes on their next page load — no deploy, no code change.
//
// Hiding a link is presentation only. Every endpoint behind it is independently
// guarded by requireModule() on the server.
// ============================================================================

const PermCtx = createContext(null);

// D1: the Master "works inside" a tenant after Switch to. Remembered per tab,
// so the platform console stays the default everywhere else.
const WS_KEY = 'truehr.masterWorkspace';
export function getMasterWorkspace() {
  try { return window.sessionStorage.getItem(WS_KEY); } catch { return null; }
}
function setMasterWorkspace(id) {
  try {
    if (id) window.sessionStorage.setItem(WS_KEY, String(id));
    else window.sessionStorage.removeItem(WS_KEY);
  } catch { /* private mode */ }
}

export function PermProvider({ children }) {
  const [perms, setPerms] = useState(null);      // { role, isPlatformAdmin, modules[] }
  const [me, setMe] = useState(null);            // { name, email, organisationName, ... }
  const [orgs, setOrgs] = useState(null);        // { canSwitch, activeOrganisationId, organisations[] }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetched together so the shell renders once, not twice.
      const [p, o, m] = await Promise.all([
        api.get('/me/permissions'),
        api.get('/me/organisations').catch(() => null),
        api.get('/me').catch(() => null),
      ]);
      setPerms(p);
      setOrgs(o);
      setMe(m);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load your permissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allowed = new Map((perms?.modules || []).map((m) => [m.key, m]));

  /** Can the signed-in user open this module? */
  const canView = useCallback((key) => allowed.has(key), [perms]);
  /** Can they change things inside it? */
  const canManage = useCallback((key) => !!allowed.get(key)?.canManage, [perms]);

  /** Move a platform owner's working context to another organisation. */
  // D1: switching opens that tenant's admin console (with a banner saying so).
  const switchOrg = useCallback(async (organisationId) => {
    await api.post('/admin/organisations/switch', { organisationId });
    setMasterWorkspace(organisationId);
    // Everything on screen belongs to the previous tenant — a full load rather
    // than trying to invalidate each screen's state piecemeal.
    window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/admin`);
  }, []);

  /** Leave the tenant console and go back to the Master's organisation list. */
  const exitWorkspace = useCallback(() => {
    setMasterWorkspace(null);
    window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/admin/organisations`);
  }, []);

  const activeOrg = (orgs?.organisations || [])
    .find((o) => String(o.id) === String(orgs?.activeOrganisationId)) || null;

  // Master inside a tenant console: the flag must name the org that is
  // actually active server-side (a stale flag from another tab is ignored).
  const ws = typeof window !== 'undefined' ? getMasterWorkspace() : null;
  const workingInside = !!perms?.isPlatformAdmin && !!ws && !!activeOrg && String(ws) === String(activeOrg.id)
    ? activeOrg : null;
  const displayName = me?.name || null;

  return (
    <PermCtx.Provider value={{
      perms, orgs, activeOrg, loading, error, reload: load,
      canView, canManage, switchOrg, exitWorkspace, workingInside, me, displayName,
      organisationName: perms?.organisationName || activeOrg?.name || null,
      isPlatformAdmin: !!perms?.isPlatformAdmin,
      role: perms?.role || null,
      modules: perms?.modules || [],
    }}>
      {children}
    </PermCtx.Provider>
  );
}

export function usePerms() {
  return useContext(PermCtx) || {
    perms: null, orgs: null, activeOrg: null, loading: true, error: '',
    canView: () => false, canManage: () => false, switchOrg: async () => {},
    exitWorkspace: () => {}, workingInside: null, me: null, displayName: null, organisationName: null,
    isPlatformAdmin: false, role: null, modules: [], reload: async () => {},
  };
}

// ── Does the signed-in employee manage anyone? (E2) ─────────────────────────
// Team wording and team tabs are shown only to people with reportees. One
// request per page load, shared by every component that asks.
let teamPromise = null;
export function resetTeamCache() { teamPromise = null; }
export function useHasTeam() {
  const [has, setHas] = useState(null); // null = still loading
  useEffect(() => {
    if (!teamPromise) {
      teamPromise = api.get('/me/team')
        .then((rows) => Array.isArray(rows) && rows.length > 0)
        .catch(() => false);
    }
    let alive = true;
    teamPromise.then((v) => { if (alive) setHas(v); });
    return () => { alive = false; };
  }, []);
  return has;
}

/** Initials from a person's name; falls back to the email's first letters. */
export function initialsFor(name, email) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return String(email || 'ME').slice(0, 2).toUpperCase();
}
