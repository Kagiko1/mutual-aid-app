'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/cases', label: 'Cases' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/ledger', label: 'Ledger' },
  { href: '/admin/funds', label: 'Funds' },
  { href: '/admin/ballots', label: 'Ballots' },
  { href: '/admin/events', label: 'Events' },
  { href: '/admin/checklists', label: 'Checklists' },
  { href: '/admin/leadership', label: 'Leadership' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/audit', label: 'Audit' },
  { href: '/admin/config', label: 'Config' },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {LINKS.map((l) => {
        const active = l.href === '/admin' ? pathname === '/admin' : pathname === l.href || pathname.startsWith(l.href + '/');
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
