'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Spinner, Empty } from '@/components/ui.jsx';

export default function EssLettersPage() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/me/letters').then((r) => setRows(r.letters || [])).catch(() => setRows([])); }, []);
  function openPdf(id) {
    const auth = getStoredAuth();
    fetch(`/api/me/letters/${id}/pdf`, { headers: { Authorization: `Bearer ${auth?.token}` } }).then((r) => r.ok && r.blob()).then((b) => b && window.open(URL.createObjectURL(b), '_blank'));
  }
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">My Letters</h1>
      {!rows ? <Spinner className="text-brand-600 h-6 w-6" /> : !rows.length ? <Empty title="No letters yet" subtitle="Letters issued to you by HR will appear here." /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((l) => (
            <Card key={l.id} className="p-4 flex items-center justify-between text-sm">
              <div><div className="font-medium">{l.title}</div><div className="text-xs text-ink-faint">{l.ref_no} · {String(l.issued_at).slice(0, 10)}</div></div>
              <button onClick={() => openPdf(l.id)} className="text-brand-700 font-medium">PDF</button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
