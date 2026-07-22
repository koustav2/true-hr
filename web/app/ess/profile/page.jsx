'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Spinner, Empty, Input } from '@/components/ui.jsx';

export default function ProfilePage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">My Profile & Team</h1>
      <div className="flex gap-1.5 border-b border-line">
        {['Profile', 'My Team', 'Address Book'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Profile />}
      {tab === 1 && <Team />}
      {tab === 2 && <Directory />}
    </div>
  );
}

function Profile() {
  const [p, setP] = useState(null);
  useEffect(() => { api.get('/me/profile').then(setP).catch(() => setP(false)); }, []);
  if (p === null) return <Spinner />;
  if (!p) return <Empty title="No employee profile linked to this account" />;
  const rows = [
    ['Employee code', p.employeeCode], ['Name', p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim()],
    ['Designation', p.designation], ['Department', p.department], ['Company', p.company],
    ['Official email', p.officialEmail], ['Phone', p.phone], ['Location', p.location],
    ['Date of joining', p.dateOfJoining?.slice?.(0, 10) || p.dateOfJoining],
    ['Reporting manager', p.reportingManager], ['Functional manager', p.functionManager || p.functionalManager],
  ];
  return (
    <Card className="p-4 max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1.5">
            <span className="text-ink-faint">{k}</span><span className="text-right font-medium">{String(v)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PersonRow({ m }) {
  const name = m.name || `${m.firstName || m.first_name || ''} ${m.lastName || m.last_name || ''}`.trim();
  return (
    <Card className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
      <div>
        <div className="font-medium">{name} <span className="text-xs text-ink-faint">{m.employeeCode || m.employee_code}</span></div>
        <div className="text-xs text-ink-faint">{[m.designation, m.department, m.state].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="text-xs text-ink-soft text-right">
        <div>{m.officialEmail || m.official_email || m.email || ''}</div>
        <div>{m.phone || ''}</div>
      </div>
    </Card>
  );
}

function Team() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/me/team').then(setRows).catch(() => setRows([])); }, []);
  return !rows ? <Spinner /> : !rows.length ? <Empty title="No team yet" subtitle="People reporting to you appear here." /> : (
    <div className="space-y-2">{rows.map((m) => <PersonRow key={m.id || m.employeeCode} m={m} />)}</div>
  );
}

function Directory() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api.get('/me/directory').then(setRows).catch(() => setRows([])); }, []);
  const filtered = (rows || []).filter((m) => {
    const s = `${m.name || ''} ${m.firstName || ''} ${m.lastName || ''} ${m.employeeCode || ''} ${m.designation || ''}`.toLowerCase();
    return !q || s.includes(q.toLowerCase());
  });
  return (
    <div className="space-y-3">
      <Input placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {!rows ? <Spinner /> : !filtered.length ? <Empty title="No matches" /> : (
        <div className="space-y-2">{filtered.map((m, i) => <PersonRow key={m.id || i} m={m} />)}</div>
      )}
    </div>
  );
}
