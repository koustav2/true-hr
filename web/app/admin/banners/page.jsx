'use client';
import { useEffect, useRef, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Spinner, Empty, ConfirmClick } from '@/components/ui.jsx';

const MAX_MB = 3;

// <img> can't carry the Authorization header, so fetch the bytes and object-URL them.
function AuthImg({ id, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    const auth = getStoredAuth();
    fetch(`/api/banners/${id}/image`, { headers: { Authorization: `Bearer ${auth?.token}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) { url = URL.createObjectURL(b); setSrc(url); } })
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (!src) return <div className={`${className} grid place-items-center bg-slate-100`}><Spinner className="text-slate-400" /></div>;
  return <img src={src} alt="banner" className={className} />;
}

export default function BannersAdminPage() {
  const [items, setItems] = useState(null);
  const [picked, setPicked] = useState([]); // [{file, preview}]
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const inputRef = useRef(null);

  const load = () => api.get('/admin/banners').then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.preview)), [picked]);

  function pick(files) {
    setMsg('');
    const good = [], bad = [];
    for (const f of Array.from(files || [])) {
      if (!f.type.startsWith('image/')) bad.push(`${f.name}: not an image`);
      else if (f.size > MAX_MB * 1024 * 1024) bad.push(`${f.name}: larger than ${MAX_MB}MB`);
      else good.push({ file: f, preview: URL.createObjectURL(f) });
    }
    if (bad.length) setMsg(bad.join(' · '));
    setPicked((p) => [...p, ...good]);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function upload() {
    if (!picked.length) return;
    setBusy(true); setMsg('');
    try {
      const images = await Promise.all(picked.map(({ file }) => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res({ file: String(r.result).split(',')[1], mime: file.type, filename: file.name });
        r.onerror = rej; r.readAsDataURL(file);
      })));
      await api.post('/admin/banners', { images });
      picked.forEach((p) => URL.revokeObjectURL(p.preview));
      setPicked([]);
      await load();
      setMsg('Uploaded.');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    try { await api.del(`/admin/banners/${id}`); load(); } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">App Banners</h1>
        <p className="text-ink-faint text-sm mt-0.5">
          Images shown in the auto-scrolling banner on the app dashboard (above Workspace).
          Wide images work best — roughly 3:1, e.g. 1200×400. Max {MAX_MB}MB each.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => pick(e.target.files)} />
          <Button variant="outline" onClick={() => inputRef.current?.click()}>Choose images…</Button>
          <span className="text-xs text-ink-faint">Select one or many at once (bulk upload supported).</span>
          {picked.length > 0 && (
            <Button onClick={upload} disabled={busy}>
              {busy ? 'Uploading…' : `Upload ${picked.length} banner${picked.length > 1 ? 's' : ''}`}
            </Button>
          )}
        </div>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {picked.map((p, i) => (
              <div key={p.preview} className="relative">
                <img src={p.preview} alt={p.file.name} className="h-20 w-48 object-cover rounded-lg border border-line" />
                <button onClick={() => setPicked((x) => x.filter((_, j) => j !== i))}
                  className="absolute -top-2 -right-2 h-5 w-5 grid place-items-center rounded-full bg-rose-600 text-white text-xs leading-none">×</button>
                <div className="text-[10px] text-ink-faint truncate w-48 mt-0.5">{p.file.name}</div>
              </div>
            ))}
          </div>
        )}
        {msg && <p className={`text-sm ${msg === 'Uploaded.' ? 'text-emerald-700' : 'text-rose-600'}`}>{msg}</p>}
      </Card>

      {items === null ? <Spinner className="text-brand-600" /> : !items.length
        ? <Empty title="No banners yet" subtitle="Upload images above — they appear in the app immediately." />
        : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((b) => (
            <Card key={b.id} className="overflow-hidden">
              <AuthImg id={b.id} className="w-full h-36 object-cover" />
              <div className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{b.filename || `Banner #${b.id}`}</div>
                  <div className="text-xs text-ink-faint">
                    {(b.uploadedAt || '').slice(0, 10)}{b.uploadedByName ? ` · ${b.uploadedByName}` : ''}
                  </div>
                </div>
                <ConfirmClick onConfirm={() => remove(b.id)} confirmLabel="Confirm delete?"
                  className="shrink-0 text-xs font-medium text-rose-600 border border-rose-200 rounded-lg px-2.5 py-1.5 hover:bg-rose-50">
                  Delete
                </ConfirmClick>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
