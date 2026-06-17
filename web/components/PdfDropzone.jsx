'use client';
import { useRef, useState } from 'react';
import { IconUpload, IconFile, IconX } from './icons.jsx';

const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// Reads a PDF and reports { name, size, dataUrl } via onChange (or null when cleared).
export default function PdfDropzone({ value, onChange, error }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [localErr, setLocalErr] = useState('');

  function handleFile(file) {
    setLocalErr('');
    if (!file) return;
    if (file.type !== 'application/pdf') { setLocalErr('Please upload a PDF file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setLocalErr('File must be under 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => onChange({ name: file.name, size: file.size, dataUrl: reader.result });
    reader.readAsDataURL(file);
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-slate-50 px-4 py-3">
        <div className="grid place-items-center h-10 w-10 rounded-lg bg-rose-50 text-rose-600 shrink-0"><IconFile width={18} height={18} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate">{value.name}</div>
          <div className="text-xs text-ink-faint">{value.size ? fmtSize(value.size) : 'PDF'} · ready to attach</div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="grid place-items-center h-8 w-8 rounded-lg text-ink-faint hover:bg-slate-200 hover:text-ink transition-colors" aria-label="Remove file">
          <IconX width={16} height={16} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]); }}
        className={`w-full rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${drag ? 'border-brand-400 bg-brand-50/60' : 'border-line hover:border-brand-300 hover:bg-slate-50'}`}>
        <div className="mx-auto mb-3 grid place-items-center h-11 w-11 rounded-full bg-brand-50 text-brand-700"><IconUpload width={20} height={20} /></div>
        <div className="text-sm font-medium text-ink">Click to upload or drag &amp; drop</div>
        <div className="text-xs text-ink-faint mt-1">PDF only · up to 10 MB</div>
      </button>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      {(localErr || error) && <div className="text-xs text-rose-600 mt-2">{localErr || error}</div>}
    </div>
  );
}
