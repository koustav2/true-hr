'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Select, Spinner, Empty } from '@/components/ui.jsx';

export default function WishesPage() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState('30');
  const load = () => api.get(`/admin/wishes?days=${days}`).then((r) => setData(r.wishes || [])).catch(() => setData([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);
  const label = (w) => w.inDays === 0 ? 'Today' : w.inDays === 1 ? 'Tomorrow' : `in ${w.inDays} days`;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Wishes &amp; Reminders</h1>
          <p className="text-ink-faint text-sm mt-0.5">Upcoming birthdays and work anniversaries across the organisation.</p>
        </div>
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-40">
          {['7', '15', '30', '60', '90'].map((d) => <option key={d} value={d}>Next {d} days</option>)}
        </Select>
      </div>
      <Card className="overflow-hidden">
        {data === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : data.length === 0 ? <Empty title="Nothing coming up" subtitle="No birthdays or anniversaries in this window." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['When', 'Occasion', 'Employee', 'Date', 'Email'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((w, i) => (
                <tr key={i} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${w.inDays === 0 ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-soft'}`}>{label(w)}</span></td>
                  <td className="px-4 py-3">{w.type}{w.type === 'Work anniversary' && w.years ? ` · ${w.years} yr` : ''}</td>
                  <td className="px-4 py-3">{w.name} <span className="text-ink-faint">({w.code})</span></td>
                  <td className="px-4 py-3 text-ink-faint">{w.date}</td>
                  <td className="px-4 py-3 text-ink-faint">{w.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
