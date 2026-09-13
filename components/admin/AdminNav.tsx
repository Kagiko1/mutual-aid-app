'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

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
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/settings', label: 'Settings' },
];

export interface OrgOption {
  slug: string;
  name: string;
}

function OrgSwitcher({ orgs, currentSlug }: { orgs: OrgOption[]; currentSlug: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(currentSlug ?? '');
  const [saving, setSaving] = useState(false);

  const onChange = async (slug: string) => {
    setValue(slug);
    setSaving(true);
    try {
      await fetch('/api/super/view-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug || null }),
      });
      router.refresh();
      window.location.href = '/admin';
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
      <label htmlFor="org-switcher" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        Viewing org
      </label>
      <select
        id="org-switcher"
        value={value}
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none"
      >
        <option value="">My organization</option>
        {orgs.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </select>
      {value && (
        <p className="mt-1 text-[11px] text-amber-600">Impersonating another organization.</p>
      )}
    </div>
  );
}

export default function AdminNav({
  isSuperAdmin = false,
  orgs = [],
  currentOrgSlug = null,
}: {
  isSuperAdmin?: boolean;
  orgs?: OrgOption[];
  currentOrgSlug?: string | null;
}) {
  const pathname = usePathname();
  const links = isSuperAdmin ? [...LINKS, { href: '/admin/super', label: 'Super Admin' }] : LINKS;
  return (
    <nav className="space-y-1">
      {isSuperAdmin && orgs.length > 0 && <OrgSwitcher orgs={orgs} currentSlug={currentOrgSlug} />}
      {links.map((l) => {
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
