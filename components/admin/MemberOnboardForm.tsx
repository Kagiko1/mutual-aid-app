'use client';

import { useState } from 'react';
import { inputCls, btnPrimary } from './ui';

type Msg = { ok: boolean; text: string } | null;

export default function MemberOnboardForm() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      full_name: String(fd.get('full_name') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      phone: String(fd.get('phone') || '').trim() || null,
      national_id: String(fd.get('national_id') || '').trim() || null,
      role: String(fd.get('role') || 'member'),
      status: String(fd.get('status') || 'pending'),
    };
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 404) {
        setMsg({
          ok: false,
          text: 'POST /api/admin/members is not available yet. Ask an admin to create the auth user in Supabase Auth (email invite), then insert a matching row in public.profiles with the same id.',
        });
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      const temp = (data as { tempPassword?: string }).tempPassword;
      setMsg({
        ok: true,
        text: temp
          ? `Member onboarded. Temporary password (share securely, shown once): ${temp}`
          : 'Member onboarded successfully.',
      });
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Request failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      {msg && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {msg.text}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Full name *</label>
          <input name="full_name" required className={inputCls} placeholder="e.g. Jane Wanjiru" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Email *</label>
          <input name="email" type="email" required className={inputCls} placeholder="jane@example.com" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Phone</label>
          <input name="phone" className={inputCls} placeholder="+2547…" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">National ID</label>
          <input name="national_id" className={inputCls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Role</label>
          <select name="role" defaultValue="member" className={inputCls}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Initial status</label>
          <select name="status" defaultValue="pending" className={inputCls}>
            <option value="pending">pending</option>
            <option value="active">active</option>
            <option value="ineligible">ineligible</option>
            <option value="suspended">suspended</option>
          </select>
        </div>
      </div>
      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? 'Creating…' : 'Create member'}
      </button>
      <p className="text-xs text-slate-500">
        This calls <code className="rounded bg-slate-100 px-1">POST /api/admin/members</code>, which creates the auth
        user via the service role (built by the API agent).
      </p>
    </form>
  );
}
