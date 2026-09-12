import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { PROCESSOR_META, type ProcessorId, type ProcessorMeta, type ProcessorRow } from '@/lib/payments/types';
import { Card, PageHeader } from '@/components/admin/ui';
import PaymentsClient from '@/components/admin/PaymentsClient';

export default async function PaymentsPage() {
  const admin = createAdminClient();
  const { orgId, org } = await resolveOrgContext(admin);

  const { data: rows } = await admin
    .from('org_payment_processors')
    .select('id, org_id, processor, environment, purpose, is_active, credentials_hint, last_tested_at, last_test_ok, created_at, updated_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  return (
    <div>
      <PageHeader
        title="Payment processors"
        subtitle={`How ${org.name} collects contributions and pays out benefits (${org.currency_code}).`}
        actions={
          <Link href="/admin" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            ← Dashboard
          </Link>
        }
      />

      <Card title="How this works">
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            Connect the payment processor your organization uses. Member contributions and benefit
            payouts route through the <strong className="text-slate-900">active</strong> processor.
            Credentials are encrypted before they are stored and are never shown again after saving.
          </p>
          <p>
            After connecting, point the processor&apos;s webhook at{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              {appUrl}/api/payments/webhook/&lt;processor&gt;
            </code>{' '}
            (M-Pesa Daraja keeps using its own callback URLs). Use <strong>test</strong> mode with
            sandbox keys first, then switch to <strong>live</strong> when you are ready for real money.
          </p>
        </div>
      </Card>

      <div className="mt-4">
        <PaymentsClient
          orgCurrency={org.currency_code}
          initialRows={(rows ?? []) as ProcessorRow[]}
          meta={PROCESSOR_META as Record<ProcessorId, ProcessorMeta>}
        />
      </div>
    </div>
  );
}
