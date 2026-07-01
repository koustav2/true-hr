import LegalDoc from '@/components/LegalDoc.jsx';
import { TERMS } from '@/lib/legalContent.js';

export const metadata = { title: 'Terms & Conditions — TrueHR' };

export default function TermsPage() {
  return <LegalDoc markdown={TERMS} />;
}
