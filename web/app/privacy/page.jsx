import LegalDoc from '@/components/LegalDoc.jsx';
import { PRIVACY_POLICY } from '@/lib/legalContent.js';

export const metadata = { title: 'Privacy Policy — TrueHR' };

export default function PrivacyPage() {
  return <LegalDoc markdown={PRIVACY_POLICY} />;
}
