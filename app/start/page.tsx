'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CURRENCIES } from '@/lib/currency';

type Mode = 'create' | 'join';

const inputCls =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none';
const labelCls = 'block text-sm font-medium text-gray-700';

function StartForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get('mode') === 'join' ? 'join' : 'create';
  const [mode, setMode] = useState<Mode>(initial);

  // create fields
  const [orgName, setOrgName] = useState('');
  const [currency, setCurrency] = useState('KES');
  // shared fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body =
        mode === 'create'
          ? { mode: 'create_org', orgName: orgName.trim(), currency, fullName: fullName.trim(), email, password, phone: phone.trim() || undefined }
          : { mode: 'join', inviteCode: inviteCode.trim().toUpperCase(), fullName: fullName.trim(), email, password, phone: phone.trim() || undefined };
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'Sign-up failed. Please try again.');
      router.push(mode === 'create' ? '/login?created=org' : '/login?created=member');
    } catch (err: any) {
      setError(err.message ?? 'Sign-up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <h1 className="text-2xl font-bold text-emerald-900">Get started</h1>
      <p className="mt-1 text-sm text-gray-600">
        {mode === 'create'
          ? 'Create your welfare organization and become its administrator.'
          : 'Join your welfare organization with the invite code from your group.'}
      </p>

      <div className="mt-6 flex rounded-lg bg-gray-100 p-1">
        {(['create', 'join'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
              mode === m ? 'bg-white text-emerald-800 shadow' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {m === 'create' ? 'Create organization' : 'Join organization'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        {mode === 'create' && (
          <>
            <div>
              <label htmlFor="orgName" className={labelCls}>Organization name</label>
              <input
                id="orgName"
                type="text"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className={inputCls}
                placeholder="Umoja Welfare Association"
              />
            </div>
            <div>
              <label htmlFor="currency" className={labelCls}>Currency</label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={inputCls}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name} ({c.symbol})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                All contributions, benefits and invoices for this organization use this currency.
              </p>
            </div>
          </>
        )}
        {mode === 'join' && (
          <div>
            <label htmlFor="inviteCode" className={labelCls}>Invite code</label>
            <input
              id="inviteCode"
              type="text"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              className={`${inputCls} uppercase tracking-widest`}
              placeholder="ABC-123"
            />
            <p className="mt-1 text-xs text-gray-500">
              Ask your group&apos;s administrator for the invite code.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="fullName" className={labelCls}>Your full name</label>
          <input
            id="fullName"
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputCls}
            placeholder="Jane Kamau"
          />
        </div>
        <div>
          <label htmlFor="email" className={labelCls}>Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            placeholder="you@example.org"
          />
        </div>
        <div>
          <label htmlFor="phone" className={labelCls}>
            Phone <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputCls}
            placeholder="+2547..."
          />
        </div>
        <div>
          <label htmlFor="password" className={labelCls}>Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {loading ? 'Please wait...' : mode === 'create' ? 'Create organization' : 'Join organization'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-emerald-700 hover:text-emerald-800">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function StartPage() {
  return (
    <Suspense fallback={<p className="px-4 py-16 text-center text-sm text-gray-500">Loading…</p>}>
      <StartForm />
    </Suspense>
  );
}
