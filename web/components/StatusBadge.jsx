import { Badge } from '@/components/ui.jsx';
import { label } from '@/lib/labels.js';

// ============================================================================
// Onboarding / employment state chip.
//
// This used to carry its own palette — amber, sky, violet, rose, emerald pills
// with full radius and a ring — while the rest of the console used the kit's
// semantic tones. Two badge vocabularies on the same table is what makes a
// screen look assembled rather than designed, so this now maps each state onto
// a kit tone and renders the kit's Badge. One shape, one colour language, and a
// tone change here follows every other chip in the product.
//
// The tones mean: ok = settled and good, warn = waiting on somebody,
// grape = with HR, danger = stopped, neutral = no longer live.
// ============================================================================
const MAP = {
  OFFER_SENT:        ['Offer sent',      'warn'],
  OFFER_ACCEPTED:    ['Accepted',        'info'],
  REJECTED:          ['Rejected',        'danger'],
  DETAILS_PENDING:   ['Filling details', 'info'],
  DETAILS_SUBMITTED: ['Awaiting review', 'grape'],
  HR_REVIEW:         ['In review',       'grape'],
  SENT_BACK:         ['Sent back',       'warn'],
  APPROVED:          ['Approved',        'ok'],
  ACTIVE:            ['Active',          'ok'],
  INACTIVE:          ['Inactive',        'danger'],
  EXPIRED:           ['Expired',         'neutral'],
  JOINING:           ['Joining',         'info'],
  EXITED:            ['Exited',          'neutral'],
};

export default function StatusBadge({ status }) {
  const [text, tone] = MAP[status] || [label(status), 'neutral'];
  return <Badge tone={tone} dot>{text}</Badge>;
}
