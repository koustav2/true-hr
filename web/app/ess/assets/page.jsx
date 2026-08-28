'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Spinner, Empty } from '@/components/ui.jsx';

export default function EssAssetsPage() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/me/assets').then((r) => setRows(r.assets || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function ack(id) { try { await api.post(`/me/assets/${id}/acknowledge`, {}); load(); } catch (e) { setMsg(e.message); } }
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">My Assets</h1>
      <p className="text-ink-faint text-sm">Company assets currently assigned to you.</p>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}
      {!rows ? <Spinner className="text-brand-600 h-6 w-6" /> : !rows.length ? <Empty title="No assets assigned" /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((a) => (
            <Card key={a.assignment_id} className="p-4 text-sm">
              <div className="font-mono text-[13px]">{a.asset_tag}</div>
              <div className="text-ink-soft">{[a.brand, a.model].filter(Boolean).join(' ') || a.category}</div>
              <div className="text-xs text-ink-faint mt-1">Since {String(a.assigned_at).slice(0, 10)}</div>
              {a.acknowledged ? <span className="inline-block mt-2 text-xs text-brand-700">✓ Acknowledged</span>
                : <button onClick={() => ack(a.assignment_id)} className="mt-2 text-xs text-brand-700 font-medium underline">Acknowledge receipt</button>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
