'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Spinner } from '@/components/ui.jsx';

// Bulk Salary is now one kind inside the unified Bulk utilities screen, which
// adds preview-before-apply. The old URL is kept so bookmarks do not 404.
export default function BulkSalaryRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/bulk'); }, [router]);
  return (
    <Card className="p-10 grid place-items-center gap-3">
      <Spinner className="text-brand-600 h-6 w-6" />
      <p className="text-[13px] text-ink-faint">Bulk salary now lives under Bulk utilities — taking you there.</p>
    </Card>
  );
}
