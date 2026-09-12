'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { btnSecondary } from './ui';

export default function DependentActions({ depId }: { depId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(v: 'verified' | 'rejected') {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/dependents/${depId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verification_status: v }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setStatus('verified')} disabled={busy} className={btnSecondary}>
          {busy ? '…' : 'Verify'}
        </button>
        <button type="button" onClick={() => setStatus('rejected')} disabled={busy} className={btnSecondary}>
          {busy ? '…' : 'Reject'}
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
