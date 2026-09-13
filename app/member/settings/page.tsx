import ChangePasswordForm from '@/components/account/ChangePasswordForm';

export const metadata = { title: 'Account settings' };

export default function MemberSettingsPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-xl font-bold text-emerald-900">Account settings</h1>
      <p className="mt-1 text-sm text-gray-600">Manage the password you use to sign in.</p>
      <div className="mt-6">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
