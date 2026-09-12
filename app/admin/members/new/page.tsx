import Link from 'next/link';
import { PageHeader, Card } from '@/components/admin/ui';
import MemberOnboardForm from '@/components/admin/MemberOnboardForm';

export default function MemberNewPage() {
  return (
    <div>
      <PageHeader
        title="Onboard member on behalf"
        subtitle="Creates the member's auth account and profile in one step."
        actions={
          <Link href="/admin/members" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Back to members
          </Link>
        }
      />
      <Card title="New member">
        <MemberOnboardForm />
      </Card>
    </div>
  );
}
