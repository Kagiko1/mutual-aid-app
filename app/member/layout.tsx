import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import NotificationBell from '@/components/member/NotificationBell';
import SignOutButton from '@/components/member/SignOutButton';

const NAV = [
  { href: '/member', label: 'Dashboard' },
  { href: '/member/onboarding', label: 'Onboarding' },
  { href: '/member/cases/new', label: 'Raise Case' },
  { href: '/member/invoices', label: 'My Invoices' },
  { href: '/member/notifications', label: 'Notifications' },
  { href: '/member/leadership', label: 'Leadership' },
  { href: '/member/events', label: 'Events' },
  { href: '/member/ballots', label: 'Ballots' },
];

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, status')
    .eq('id', user.id)
    .maybeSingle();

  // Admins have their own console.
  if (profile?.role === 'admin') redirect('/admin');

  return (
    <div className="min-h-screen">
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Link href="/member" className="mr-4 text-base font-bold text-emerald-800">
            Member Portal
          </Link>
          <div className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-emerald-700"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <SignOutButton />
          </div>
        </div>
      </nav>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
