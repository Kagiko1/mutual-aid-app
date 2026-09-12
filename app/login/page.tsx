'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (authError) throw authError;
      const user = data.user;
      if (!user) {
        setNotice('Account created. Please check your email to confirm, then sign in.');
        return;
      }
      // Create the matching member profile row.
      const { data: cfg } = await supabase
        .from('org_config')
        .select('value')
        .eq('key', 'waiting_period_days')
        .maybeSingle();
      const waitingDays = Number((cfg as any)?.value);
      const days = Number.isFinite(waitingDays) && waitingDays > 0 ? waitingDays : 180;
      const waitingEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const { error: profileError } = await supabase.from('profiles').insert({
        id: user.id,
        role: 'member',
        full_name: fullName,
        email,
        status: 'pending',
        waiting_ends_at: waitingEndsAt,
      });
      if (profileError) throw profileError;
      if (!data.session) {
        setNotice('Account created. Please check your email to confirm, then sign in.');
        return;
      }
      router.push('/member');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Sign-up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <h1 className="text-2xl font-bold text-emerald-900">Umoja Welfare</h1>
      <p className="mt-1 text-sm text-gray-600">Member portal access</p>

      <div className="mt-6 flex rounded-lg bg-gray-100 p-1">
        {(['signin', 'signup'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setNotice(null);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
              mode === m ? 'bg-white text-emerald-800 shadow' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form
        onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}
        className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        {mode === 'signup' && (
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
              placeholder="Jane Kamau"
            />
          </div>
        )}
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
        {notice && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-xs text-gray-500">
        New members start with a pending status and must complete onboarding (profile, dependents,
        beneficiaries, KYC, consent and e-signature) before becoming active.
      </p>
    </div>
  );
}
