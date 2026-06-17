const MAP = {
  OFFER_SENT:        ['Offer sent', 'bg-amber-50 text-amber-700 ring-amber-200'],
  OFFER_ACCEPTED:    ['Offer accepted', 'bg-sky-50 text-sky-700 ring-sky-200'],
  DETAILS_PENDING:   ['Filling details', 'bg-sky-50 text-sky-700 ring-sky-200'],
  DETAILS_SUBMITTED: ['Awaiting review', 'bg-violet-50 text-violet-700 ring-violet-200'],
  HR_REVIEW:         ['In review', 'bg-violet-50 text-violet-700 ring-violet-200'],
  SENT_BACK:         ['Sent back', 'bg-orange-50 text-orange-700 ring-orange-200'],
  APPROVED:          ['Approved', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  ACTIVE:            ['Active', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  EXPIRED:           ['Expired', 'bg-slate-100 text-slate-500 ring-slate-200'],
};
export default function StatusBadge({ status }) {
  const [label, cls] = MAP[status] || [status, 'bg-slate-100 text-slate-600 ring-slate-200'];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${cls}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{label}
  </span>;
}
