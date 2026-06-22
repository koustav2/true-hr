'use client';
import { useEffect, useRef, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Spinner } from '@/components/ui.jsx';

export default function PoliciesAdminPage() {
  const [items, setItems] = useState(null);
  const [busyTitle, setBusyTitle] = useState('');
  const [msg, setMsg] = useState('');
  const fileInputs = useRef({});

  const load = () =>
    api.get('/admin/policies')
      .then((r) => setItems(r.items || []))
      .catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  async function upload(title, file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setMsg('File too large (max 10MB).'); return; }
    setBusyTitle(title); setMsg('');
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej; r.readAsDataURL(file);
      });
      await api.post('/admin/policies', { title, file: b64, mime: file.type, filename: file.name });
      await load();
    } catch (e) { setMsg(e.message); } finally { setBusyTitle(''); }
  }

  async function remove(id) { await api.del(`/admin/policies/${id}`); load(); }

  async function view(id) {
    const win = window.open('', '_blank');
    try {
      const auth = getStoredAuth();
      const res = await fetch(`/api/policies/${id}/file`, { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (!res.ok) { win?.close(); return; }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location = url; else window.location.href = url;
    } catch { win?.close(); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold text-ink tracking-tight">Policies</h1>
        <p className="text-ink-faint text-sm mt-0.5">
          Upload a document for each policy. Employees see this fixed list in the app and can download
          whichever ones have a file. Uploading again replaces the existing file.
        </p>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <Card className="overflow-hidden">
        {items === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Document</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((p) => (
                <tr key={p.title} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 text-ink font-medium">{p.title}</td>
                  <td className="px-5 py-3">
                    {p.available
                      ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Uploaded {(p.uploadedAt || '').slice(0, 10)}</span>
                      : <span className="inline-flex items-center gap-1.5 text-ink-faint"><span className="h-1.5 w-1.5 rounded-full bg-slate-300" />Not uploaded</span>}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <input
                      ref={(el) => { fileInputs.current[p.title] = el; }}
                      type="file" accept="application/pdf,image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(p.title, f); }}
                    />
                    {p.available && <button onClick={() => view(p.id)} className="text-brand-700 text-xs font-medium hover:underline mr-4">View</button>}
                    <button onClick={() => fileInputs.current[p.title]?.click()} disabled={busyTitle === p.title}
                      className="text-brand-700 text-xs font-medium hover:underline mr-4">
                      {busyTitle === p.title ? 'Uploading…' : (p.available ? 'Replace' : 'Upload')}
                    </button>
                    {p.available && <button onClick={() => remove(p.id)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
