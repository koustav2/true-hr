'use client';
// Shared NFA display pieces (employee and admin screens): readable labels, one
// date format, the approval chain with who actually acted, every expense line
// and the attachments.
import { openFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';

export const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const STATUS_TONE = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  QUERY: 'bg-sky-50 text-sky-700 border-sky-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAYMENT_RELEASED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  WITHDRAWN: 'bg-slate-50 text-slate-600 border-slate-200',
};
export const STAGE_TONE = {
  APPROVED: 'text-emerald-700', REJECTED: 'text-red-700', BYPASSED: 'text-slate-400',
  PENDING: 'text-amber-700', QUERY: 'text-sky-700', WAITING: 'text-ink-faint', CANCELLED: 'text-slate-400',
};
const STAGE_STATUS = { WAITING: 'Waiting', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', QUERY: 'Query raised', BYPASSED: 'Skipped (no approver)', CANCELLED: 'Withdrawn' };
export const stageName = (s) => s.roleLabel || label(s.roleKey);

// "Query Raised By: FINANCE" → "Query raised by Finance".
export function statusText(d) {
  if (d.status === 'QUERY' && d.statusLabel) return d.statusLabel.replace(/^Query Raised By:\s*([A-Z_]+)/, (m, k) => `Query raised by ${label(k)}`);
  if (d.status === 'REJECTED' && d.statusLabel && d.statusLabel !== 'REJECTED') {
    return d.statusLabel.replace(/^([A-Z_]+) Rejected-/, (m, k) => `Rejected by ${label(k)} — `);
  }
  return label(d.status);
}

export function StatusChip({ d }) {
  const t = statusText(d);
  return <span title={t} className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_TONE[d.status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
    {t.length > 40 ? `${t.slice(0, 38)}…` : t}
  </span>;
}

export function ChainList({ approval }) {
  if (!approval) return null;
  return (
    <div className="space-y-1">
      {approval.chain.map((s) => (
        <div key={s.seq} className="flex items-start justify-between gap-3 text-xs border border-line rounded px-2.5 py-1.5">
          <div>
            <span className="text-ink-faint mr-1">{s.seq}.</span>
            <span className="font-medium text-ink">{stageName(s)}</span>
            <span className="text-ink-soft ml-1.5">{s.approver?.name || 'No approver'}</span>
            {s.actedBy && (s.actedBy.override || s.actedBy.name !== s.approver?.name) && (
              <div className="text-[11px] text-violet-700 mt-0.5">
                Actioned by {s.actedBy.name}{s.actedBy.override ? ' (HR override)' : ''}{s.actedAt ? ` on ${fmtDate(s.actedAt)}` : ''}
              </div>
            )}
            {s.remarks && <div className="text-ink-faint mt-0.5">“{s.remarks}”</div>}
          </div>
          <span className={`font-semibold whitespace-nowrap ${STAGE_TONE[s.status] || ''}`}>{STAGE_STATUS[s.status] || label(s.status)}</span>
        </div>
      ))}
    </div>
  );
}

export function LinesTable({ d }) {
  const pr = d.raiseFor === 'PURCHASE_REQUEST';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border border-line rounded min-w-[520px]">
        <thead><tr className="text-left text-ink-faint border-b border-line">
          <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Expense header</th><th className="px-2 py-1.5">Sub-header</th>
          {pr && <><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5 text-right">Qty × rate</th></>}
          <th className="px-2 py-1.5 text-right">NFA amount</th><th className="px-2 py-1.5 text-right">Logistic</th><th className="px-2 py-1.5 text-right">Total</th></tr></thead>
        <tbody>
          {(d.lines || []).map((l) => (
            <tr key={l.seq} className="border-b border-line last:border-0">
              <td className="px-2 py-1.5">{l.seq}</td><td className="px-2 py-1.5">{l.header.name}</td>
              <td className="px-2 py-1.5 text-ink-soft">{l.subheader?.name || '—'}</td>
              {pr && <><td className="px-2 py-1.5">{l.itemDescription || '—'}</td>
                <td className="px-2 py-1.5 text-right">{l.quantity != null ? `${Number(l.quantity)} × ${fmtMoney(l.unitRate)}` : '—'}</td></>}
              <td className="px-2 py-1.5 text-right">{fmtMoney(l.nfaAmount)}</td>
              <td className="px-2 py-1.5 text-right">{fmtMoney(l.logisticAmount)}</td>
              <td className="px-2 py-1.5 text-right font-medium">{fmtMoney(l.totalAmount)}</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-medium">
            <td colSpan={pr ? 5 : 3} className="px-2 py-1.5 text-right text-ink-faint">Grand total</td>
            <td className="px-2 py-1.5 text-right">{fmtMoney(d.totals.nfa)}</td>
            <td className="px-2 py-1.5 text-right">{fmtMoney(d.totals.logistic)}</td>
            <td className="px-2 py-1.5 text-right">{fmtMoney(d.totals.grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const DOC_LABEL = { BILL: 'Bill', INVOICE: 'Invoice', QUOTATION: 'Quotation', REIMBURSEMENT_FORM: 'Reimbursement form', QUERY_REPLY: 'Query reply', OTHER: 'Document' };
export const DOC_KINDS = Object.entries(DOC_LABEL).filter(([k]) => k !== 'QUERY_REPLY');

export function DocList({ nfaId, docs, onError }) {
  if (!docs?.length) return <p className="text-xs text-ink-faint">No attachments.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {docs.map((doc) => (
        <button key={doc.id} type="button" onClick={() => openFile(`/nfa/${nfaId}/documents/${doc.id}`).catch((e) => onError?.(e.message))}
          className="text-[11px] text-brand-700 bg-brand-50 border border-brand-100 rounded-full px-2.5 py-1 hover:bg-brand-100">
          {DOC_LABEL[doc.kind] || 'Document'}: {doc.filename || `#${doc.id}`}
        </button>
      ))}
    </div>
  );
}

// Read picked files as base64 attachments (max 5MB each). Returns { files, errors }.
export async function readFiles(list, kind) {
  const files = []; const errors = [];
  for (const f of Array.from(list || [])) {
    if (f.size > 5 * 1024 * 1024) { errors.push(`${f.name} is larger than 5MB`); continue; }
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = rej; r.readAsDataURL(f);
    });
    files.push({ file: b64, mime: f.type, filename: f.name, kind });
  }
  return { files, errors };
}

// Detail facts as [label, value] pairs.
export function facts(d) {
  return [
    ['NFA raised for', label(d.raiseFor)], ['Business operation', d.businessOperation?.name],
    ['Cost to company', d.company?.name], ['Project', d.project?.name],
    ['Expense category', d.expenseCategory?.name], ['Zone', d.zone?.name],
    ['Location', d.location?.name], ['Client / vendor', d.clientVendor?.name || '—'],
    ['Expense month', `${String(d.expenseMonth).padStart(2, '0')}-${d.expenseYear}`], ['Payment type', label(d.paymentType)],
    ['Billable type', label(d.billableType)], ['Settlement date', fmtDate(d.settlementDueDate)],
    ['Priority', label(d.priority)], ['Raised on', fmtDate(d.createdAt)],
    ...(d.vendorQuoteRef ? [['Vendor quote ref.', d.vendorQuoteRef]] : []),
    ['Purpose', d.purpose], ...(d.description ? [['Description', d.description]] : []),
  ];
}
