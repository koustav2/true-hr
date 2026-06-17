'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { Spinner } from './ui.jsx';
import { IconFile, IconCheck, IconUpload, IconX } from './icons.jsx';

const ACCEPT = {
  pdf: { attr: 'application/pdf', mimes: ['application/pdf'], note: 'PDF' },
  image: { attr: 'image/png,image/jpeg', mimes: ['image/png', 'image/jpeg', 'image/jpg'], note: 'JPG / PNG' },
};

// Uploads a single e-joining document immediately on selection.
export default function DocUpload({ token, type, label, hint, required, accept = 'pdf', defaultName = null, onStatus }) {
  const inputRef = useRef(null);
  const cfg = ACCEPT[accept];
  const [status, setStatus] = useState(defaultName ? 'done' : 'idle'); // idle | uploading | done | error
  const [name, setName] = useState(defaultName);
  const [err, setErr] = useState('');

  function pick() { inputRef.current?.click(); }

  function handle(file) {
    setErr('');
    if (!file) return;
    if (!cfg.mimes.includes(file.type)) { setErr(`Must be ${cfg.note}.`); return; }
    if (file.size > 10 * 1024 * 1024) { setErr('Max 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setStatus('uploading');
      try {
        await api.post('/onboarding/document', { token, type, name: file.name, dataUrl: reader.result });
        setName(file.name); setStatus('done'); onStatus?.(type, true);
      } catch (e) { setErr(e.message); setStatus('error'); onStatus?.(type, false); }
    };
    reader.readAsDataURL(file);
  }

  const done = status === 'done';
  return (
    <div className={`rounded-xl border p-3 transition-colors ${done ? 'border-brand-200 bg-brand-50/40' : 'border-line bg-white'}`}>
      <div className="flex items-center gap-3">
        <div className={`grid place-items-center h-9 w-9 rounded-lg shrink-0 ${done ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-ink-faint'}`}>
          {status === 'uploading' ? <Spinner /> : done ? <IconCheck width={17} height={17} /> : <IconFile width={17} height={17} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink leading-tight">{label}{required && <span className="text-brand-600"> *</span>}</div>
          <div className="text-xs text-ink-faint truncate">{done ? name : (hint || cfg.note)}</div>
        </div>
        {done ? (
          <button type="button" onClick={pick} className="text-xs font-medium text-ink-soft hover:text-brand-700 px-2 py-1 rounded-md hover:bg-white">Replace</button>
        ) : (
          <button type="button" onClick={pick} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
            <IconUpload width={14} height={14} /> Upload
          </button>
        )}
      </div>
      {err && <div className="text-xs text-rose-600 mt-2 flex items-center gap-1"><IconX width={12} height={12} /> {err}</div>}
      <input ref={inputRef} type="file" accept={cfg.attr} className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
    </div>
  );
}
