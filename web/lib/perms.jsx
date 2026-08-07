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

export function PermProvider({ children }) {
  const [perms, setPerms] = useState(null);      // { role, isPlatformAdmin, modules[] }
  const [orgs, setOrgs] = useState(null);        // { canSwitch, activeOrganisationId, organisations[] }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetched together so the shell renders once, not twice.
      const [p, o] = await Promise.all([
        api.get('/me/permissions'),
        api.get('/me/organisations').catch(() => null),
      ]);
      setPerms(p);
      setOrgs(o);
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
  const switchOrg = useCallback(async (organisationId) => {
    await api.post('/admin/organisations/switch', { organisationId });
    // Everything on screen belongs to the previous tenant — reload rather than
    // trying to invalidate each screen's state piecemeal.
    window.location.reload();
  }, []);

  const activeOrg = (orgs?.organisations || [])
    .find((o) => String(o.id) === String(orgs?.activeOrganisationId)) || null;

  return (
    <PermCtx.Provider value={{
      perms, orgs, activeOrg, loading, error, reload: load,
      canView, canManage, switchOrg,
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
    isPlatformAdmin: false, role: null, modules: [], reload: async () => {},
  };
}
