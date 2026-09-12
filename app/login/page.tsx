'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const created = searchParams.get('created');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      router.push('/member');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <h1 className="text-2xl font-bold text-emerald-900">Mutual Aid</h1>
      <p className="mt-1 text-sm text-gray-600">Member portal access</p>

      {created === 'org' && (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          Your organization was created. Sign in to start onboarding your members.
        </p>
      )}
      {created === 'member' && (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          Your account was created. Sign in to complete onboarding.
        </p>
      )}

      <form
        onSubmit={handleSignIn}
        className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
            placeholder="you@example.org"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
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
          {loading ? 'Please wait...' : 'Sign in'}
        </button>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/start?mode=create"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-emerald-300"
        >
          <p className="text-sm font-semibold text-slate-900">Create an organization</p>
          <p className="mt-1 text-xs text-slate-500">
            Start a new welfare group and invite your members.
          </p>
        </Link>
        <Link
          href="/start?mode=join"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-emerald-300"
        >
          <p className="text-sm font-semibold text-slate-900">Join with invite code</p>
          <p className="mt-1 text-xs text-slate-500">
            Have a code from your group? Join it here.
          </p>
        </Link>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        New members start with a pending status and must complete onboarding (profile, dependents,
        beneficiaries, KYC, consent and e-signature) before becoming active.
      </p>
    </div>
  );
}
