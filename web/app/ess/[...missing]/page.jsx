import { notFound } from 'next/navigation';

// Any /ess address that matches no page renders the ESS 404 (ess/not-found.jsx)
// inside the employee portal's header and menu, rather than the bare root 404
// (E65). Real pages and dynamic routes always take precedence over this.
export default function MissingEssPage() {
  notFound();
}
