'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Input, Spinner, Empty } from '@/components/ui.jsx';

const TABS = ['Dashboard', 'Project-wise Expense', 'Client Billing', 'Settlements'];
const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

export default function NfaReportsPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold text-ink tracking-tight">NFA Reports</h1>
        <p className="text-ink-faint text-sm mt-0.5">FY analytics, expense rollups, client billing and settlement register — with Excel export.</p>
      </div>
      <div className="flex gap-1.5 border-b border-line overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <DashboardTab />}
      {tab === 1 && <ProjectExpenseTab />}
      {tab === 2 && <ClientBillingTab />}
      {tab === 3 && <SettlementsTab />}
    </div>
  );
}

function ExportButtons({ path, name }) {
  const [msg, setMsg] = useState('');
  const dl = (fmt) => downloadFile(`${path}${path.includes('?') ? '&' : '?'}format=${fmt}`, `${name}.${fmt}`).catch((e) => setMsg(e.message));
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => dl('xlsx')}>Export Excel</Button>
      <Button size="sm" variant="outline" onClick={() => dl('csv')}>CSV</Button>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}

function DashboardTab() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/admin/nfa-dashboard').then(setD).catch(() => setD(false)); }, []);
  if (d === null) return <div className="p-8 flex justify-center"><Spinner /></div>;
  if (!d) return <Empty title="Could not load dashboard" />;
  const cards = [
    ['Total NFA Raised', d.totalRaised], ['Total Approved', d.totalApproved], ['Payment Released', d.paymentReleased],
    ['Pending', d.pending], ['On Query', d.query], ['Settled', d.settled],
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-faint">Financial year {d.financialYear}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map(([label, v]) => (
          <Card key={label} className="p-4">
            <div className="text-2xl font-bold text-ink">{v}</div>
            <div className="text-xs text-ink-faint mt-0.5">{label}</div>
          </Card>
        ))}
        <Card className="p-4">
          <div className="text-2xl font-bold text-ink">{fmtMoney(d.releasedAmount)}</div>
          <div className="text-xs text-ink-faint mt-0.5">Released amount (raised: {fmtMoney(d.raisedAmount)})</div>
        </Card>
      </div>
      {!!d.pendingByStage?.length && (
        <Card className="p-4">
          <div className="font-semibold text-sm mb-2">Pending approvals by stage</div>
          {d.pendingByStage.map((s) => (
            <div key={s.roleKey} className="flex justify-between text-sm border-b border-line/60 py-1 last:border-0">
              <span className="text-ink-soft">{s.roleKey.replace(/_/g, ' ')}</span><span className="font-medium">{s.count}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function useDateRange() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join('&');
  const controls = (
    <div className="flex gap-2 items-center">
      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
      <span className="text-ink-faint text-sm">to</span>
      <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
    </div>
  );
  return [qs, controls];
}

function ReportTable({ rows, cols }) {
  if (!rows) return <div className="p-8 flex justify-center"><Spinner /></div>;
  if (!rows.length) return <Empty title="No data" subtitle="Nothing matches the current filters." />;
  return (
    <Card className="p-0 overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
          {cols.map((c) => <th key={c.key} className={`px-3 py-2.5 ${c.right ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {cols.map((c) => <td key={c.key} className={`px-3 py-2 ${c.right ? 'text-right font-medium' : ''}`}>{c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ProjectExpenseTab() {
  const [qs, controls] = useDateRange();
  const [rows, setRows] = useState(null);
  const load = () => api.get(`/admin/reports/project-expense${qs ? `?${qs}` : ''}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex gap-2 items-center">{controls}<Button size="sm" onClick={load}>Filter</Button></div>
        <ExportButtons path={`/admin/reports/project-expense${qs ? `?${qs}` : ''}`} name="project-wise-expense" />
      </div>
      <ReportTable rows={rows} cols={[
        { key: 'company', label: 'Cost To Company' }, { key: 'project', label: 'Project' },
        { key: 'category', label: 'Category' }, { key: 'header', label: 'Header' }, { key: 'subheader', label: 'Sub Header' },
        { key: 'location', label: 'Location' }, { key: 'nfas', label: "NFA's", right: true },
        { key: 'amount', label: 'Amount', right: true, fmt: fmtMoney }, { key: 'last_date', label: 'Date' },
      ]} />
    </div>
  );
}

function ClientBillingTab() {
  const [qs, controls] = useDateRange();
  const [rows, setRows] = useState(null);
  const load = () => api.get(`/admin/reports/client-billing${qs ? `?${qs}` : ''}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex gap-2 items-center">{controls}<Button size="sm" onClick={load}>Filter</Button></div>
        <ExportButtons path={`/admin/reports/client-billing${qs ? `?${qs}` : ''}`} name="client-billing" />
      </div>
      <ReportTable rows={rows} cols={[
        { key: 'client', label: 'Client' }, { key: 'billable_type', label: 'Billable Type' },
        { key: 'billed_state', label: 'Billed / To be billed' }, { key: 'nfas', label: "NFA's", right: true },
        { key: 'amount', label: 'Amount', right: true, fmt: fmtMoney },
        { key: 'invoiced_amount', label: 'Invoiced', right: true, fmt: fmtMoney },
      ]} />
    </div>
  );
}

function SettlementsTab() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const load = () => api.get(`/admin/settlements${status ? `?status=${status}` : ''}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {['', 'IN_PROGRESS', 'CLOSED', 'REJECTED', 'AUTO_REJECTED'].map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 text-xs rounded-full border ${status === s ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>
      <ReportTable rows={rows && rows.map((r) => ({
        nfaCode: r.nfaCode, employee: r.employee?.name, project: r.project?.name,
        amount: r.amount, status: r.status, raisedAt: r.raisedAt?.slice(0, 10),
        stage: r.approval ? `${r.approval.currentStageSeq}/${r.approval.chain.length}` : '—',
      }))} cols={[
        { key: 'nfaCode', label: 'NFA Code' }, { key: 'employee', label: 'Employee' }, { key: 'project', label: 'Project' },
        { key: 'amount', label: 'Amount', right: true, fmt: fmtMoney }, { key: 'status', label: 'Status' },
        { key: 'stage', label: 'Chain stage' }, { key: 'raisedAt', label: 'Raised' },
      ]} />
    </div>
  );
}
