'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, setToken, storeAuth } from '@/lib/api.js';
import { Spinner } from '@/components/ui.jsx';

// App → web SSO landing. The mobile app opens /sso?t=<60s handoff token>;
// we exchange it for a normal session and land on the employee portal.
function SsoInner() {
  const params = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const t = params.get('t');
    if (!t) { setError('Missing sign-in token. Open My ESS from the TrueHR app again.'); return; }
    api.post('/auth/web-sso', { token: t })
      .then((data) => {
        setToken(data.token);
        storeAuth({ token: data.token, user: data.user });
        // Full reload so the AuthProvider hydrates from storage.
        window.location.replace(data.user.mustChangePassword ? '/change-password' : '/ess');
      })
      .catch((e) => setError(e.message));
  }, [params]);

  return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      {error ? (
        <div>
          <div className="text-lg font-semibold text-ink">Could not sign you in</div>
          <p className="text-sm text-ink-faint mt-1">{error}</p>
          <a href="/login" className="text-sm text-brand-700 underline mt-3 inline-block">Go to login</a>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-ink-soft text-sm">
          <Spinner className="text-brand-600 h-5 w-5" /> Signing you in…
        </div>
      )}
    </div>
  );
}

export default function SsoPage() {
  return <Suspense fallback={null}><SsoInner /></Suspense>;
}
