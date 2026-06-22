'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Input, Spinner } from '@/components/ui.jsx';

export default function PoliciesAdminPage() {
  const [rows, setRows] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api.get('/admin/policies').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function upload() {
    if (!title || !file) { setMsg('Title and file are required.'); return; }
    if (file.size > 10 * 1024 * 1024) { setMsg('File too large (max 10MB).'); return; }
    setBusy(true); setMsg('');
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]); // strip data: prefix
        r.onerror = rej; r.readAsDataURL(file);
      });
      await api.post('/admin/policies', { title, category: category || null, file: b64, mime: file.type, filename: file.name });
      setTitle(''); setCategory(''); setFile(null); await load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
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
        <p className="text-ink-faint text-sm mt-0.5">Upload company policy documents employees can read in the app.</p>
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
        <Card className="p-5">
          <h2 className="font-semibold text-ink mb-3">Upload policy</h2>
          <div className="space-y-3">
            <label className="block"><span className="block text-[13px] font-medium text-ink-soft mb-1.5">Title</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leave Policy 2026" /></label>
            <label className="block"><span className="block text-[13px] font-medium text-ink-soft mb-1.5">Category (optional)</span>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. HR, IT, Code of Conduct" /></label>
            <label className="block"><span className="block text-[13px] font-medium text-ink-soft mb-1.5">File (PDF/image, max 10MB)</span>
              <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700 file:font-medium" /></label>
            {msg && <p className="text-sm text-rose-600">{msg}</p>}
            <Button onClick={upload} disabled={busy} className="w-full">{busy ? <Spinner /> : 'Upload policy'}</Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
            : rows.length === 0 ? <p className="p-6 text-sm text-ink-faint">No policies uploaded yet.</p> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
                <tr><th className="text-left px-5 py-3 font-medium">Title</th><th className="text-left px-5 py-3 font-medium">Category</th><th className="text-left px-5 py-3 font-medium">Uploaded</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 text-ink font-medium">{p.title}</td>
                    <td className="px-5 py-3 text-ink-soft">{p.category || '—'}</td>
                    <td className="px-5 py-3 text-ink-faint whitespace-nowrap">{(p.uploadedAt || '').slice(0, 10)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button onClick={() => view(p.id)} className="text-brand-700 text-xs font-medium hover:underline mr-4">View</button>
                      <button onClick={() => remove(p.id)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
