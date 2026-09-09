'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Select, Field, Modal, Textarea, Spinner, Empty, Badge, PageHeader } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];
const KIND_LABEL = { PROFILE: 'Personal details', ADDRESS: 'Address', BANK: 'Bank account' };
const FIELD_LABEL = {
  phone: 'Phone', personalEmail: 'Personal email', dob: 'Date of birth', gender: 'Gender',
  type: 'Address type', line1: 'Address line 1', line2: 'Address line 2', city: 'City',
  state: 'State', pincode: 'PIN code', country: 'Country',
  accountHolder: 'Account holder', bankName: 'Bank', branch: 'Branch',
  ifsc: 'IFSC', accountNumber: 'Account number',
};
const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger' };

const dmy = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function ChangeRequestsPage() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState('');
  const [reject, setReject] = useState(null);
  const [note, setNote] = useState('');

  const load = () => {
    setRows(null);
    api.get(`/admin/change-requests?status=${status}`).then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const counts = useMemo(() => {
    const c = { PROFILE: 0, ADDRESS: 0, BANK: 0 };
    (rows || []).forEach((r) => { if (c[r.kind] !== undefined) c[r.kind] += 1; });
    return c;
  }, [rows]);

  async function decide(id, action, reason) {
    setBusy(id); setMsg('');
    try {
      await api.post(`/admin/change-requests/${id}/${action}`, reason ? { note: reason } : {});
      setReject(null); setNote(''); load();
    } catch (e) { setMsg(e.message); } finally { setBusy(0); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Change requests"
        subtitle="Employees propose edits to their own record. Nothing is written until you approve it — payroll-critical fields always keep a checker."
        action={
          <div className="flex items-end gap-2.5">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All' : s[0] + s.slice(1).toLowerCase()}</option>)}
              </Select>
            </Field>
            <Button variant="outline" onClick={() => downloadCsv(`change-requests-${status.toLowerCase()}.csv`,
              (rows || []).map((r) => ({
                'Employee ID': r.employee?.code || '', Name: r.employee?.name || '',
                Type: KIND_LABEL[r.kind] || r.kind,
                Changes: Object.entries(r.payload || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}=${v}`).join('; '),
                Status: r.status, Submitted: (r.submittedAt || '').slice(0, 10),
                Reviewed: (r.reviewedAt || '').slice(0, 10), Remark: r.reviewNote || '',
              })))}>
              Export CSV
            </Button>
          </div>
        }
      />

      {rows && rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-ink-soft">
          {Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => (
            <span key={k} className="rounded border border-line bg-white px-2 py-1">
              {KIND_LABEL[k]}: <b className="text-ink">{n}</b>
            </span>
          ))}
        </div>
      )}
      {msg && <p className="text-sm text-neg">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? (
          <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : rows.length === 0 ? (
          <Empty
            title={status === 'PENDING' ? 'No requests waiting' : `No ${status.toLowerCase()} requests`}
            subtitle="When an employee proposes a change to their profile, address or bank details from the app, it lands here for review."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Employee</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Proposed change</th>
                  <th className="text-left">Submitted</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4">
                      <div className="text-ink font-medium">{r.employee?.name || `#${r.id}`}</div>
                      <div className="text-ink-faint text-[11.5px] font-mono">{r.employee?.code || '—'}</div>
                      <div className="text-ink-faint text-[11.5px]">{r.employee?.designation || '—'}</div>
                    </td>
                    <td className="px-4 whitespace-nowrap">
                      <Badge tone={TONE[r.status] || 'neutral'}>{r.status}</Badge>
                      <div className="text-ink-soft text-[12.5px] mt-1">{KIND_LABEL[r.kind] || r.kind}</div>
                    </td>
                    <td className="px-4 max-w-[420px]">
                      <dl className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-3 gap-y-1">
                        {Object.entries(r.payload || {}).map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-[11.5px] text-ink-faint truncate">{FIELD_LABEL[k] || k}</dt>
                            <dd className="text-[12.5px] text-ink font-medium break-words">{String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                      {r.reviewNote && <div className="text-ink-faint text-[11.5px] mt-1.5">Remark: {r.reviewNote}</div>}
                    </td>
                    <td className="px-4 whitespace-nowrap text-ink-soft text-[12.5px]">
                      {dmy(r.submittedAt)}
                      {r.reviewedAt && <div className="text-ink-faint text-[11.5px]">reviewed {dmy(r.reviewedAt)}</div>}
                    </td>
                    <td className="px-4 text-right whitespace-nowrap">
                      {r.status === 'PENDING' ? (
                        <>
                          <button onClick={() => decide(r.id, 'approve')} disabled={busy === r.id}
                            className="text-pos text-[12px] font-semibold hover:underline mr-4 disabled:opacity-50">Approve</button>
                          <button onClick={() => { setReject(r); setNote(''); }}
                            className="text-neg text-[12px] font-semibold hover:underline">Reject</button>
                        </>
                      ) : <span className="text-ink-faint text-[12px]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!reject}
        onClose={() => setReject(null)}
        title={`Reject change — ${reject?.employee?.name || ''}`}
        tone="danger"
        actions={
          <>
            <Button variant="ghost" onClick={() => setReject(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy === reject?.id || !note.trim()} onClick={() => decide(reject.id, 'reject', note.trim())}>
              {busy === reject?.id ? <Spinner /> : 'Reject request'}
            </Button>
          </>
        }>
        <p className="text-[12.5px] text-ink-faint mb-3">
          The employee sees this reason, so say what needs fixing.
        </p>
        <Field label="Reason" hint="Required">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. IFSC does not match the bank name — please recheck the passbook." />
        </Field>
      </Modal>
    </div>
  );
}
