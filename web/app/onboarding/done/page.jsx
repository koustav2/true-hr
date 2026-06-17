import { Logo } from '@/components/Brand.jsx';
import { Card } from '@/components/ui.jsx';

export default function DonePage() {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
      <Card className="max-w-md w-full p-10 text-center animate-in">
        <div className="flex justify-center mb-6"><Logo size={44} /></div>
        <div className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-emerald-100 text-emerald-600 text-3xl mb-4">✓</div>
        <h1 className="text-2xl font-bold text-ink">All done!</h1>
        <p className="text-ink-soft mt-2">
          Your onboarding details have been submitted and e-signed. HR will review them shortly.
          Once approved, you'll receive an email with your <strong>Employee ID</strong>, login credentials and the link to the TRUE HR app.
        </p>
        <p className="text-xs text-ink-faint mt-6">You can safely close this window.</p>
      </Card>
    </div>
  );
}
