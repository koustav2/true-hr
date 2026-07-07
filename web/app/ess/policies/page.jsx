'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Spinner, Empty } from '@/components/ui.jsx';

export default function PoliciesPage() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get('/policies').then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Policies & Formats</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No policies uploaded yet" /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((p) => (
            <Card key={p.slot ?? p.id ?? p.title} className="p-3 flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{p.title || p.name}</div>
                {!p.available && p.id == null && <div className="text-xs text-ink-faint">Not uploaded yet</div>}
              </div>
              {(p.id != null) && (
                <Button size="sm" variant="outline"
                  onClick={() => downloadFile(`/policies/${p.id}/file`, p.filename || `${(p.title || 'policy')}.pdf`).catch((e) => setMsg(e.message))}>
                  Download
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
