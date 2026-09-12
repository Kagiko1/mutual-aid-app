'use client';

import { useState } from 'react';
import { btnSecondary } from './ui';

export default function NotifyButton({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function notify() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/notify`, { method: 'POST' });
      if (res.status === 404) {
        setUnavailable(true);
        setMsg('Notify endpoint is not available yet.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      setMsg((data as { message?: string }).message || `Members notified about “${eventTitle}”.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={notify}
        disabled={busy || unavailable}
        title={
          unavailable
            ? 'POST /api/admin/events/[id]/notify is not wired up yet'
            : 'Send an in-app notification to all members about this event'
        }
        className={btnSecondary}
      >
        {busy ? 'Sending…' : 'Notify members'}
      </button>
      {msg && <span className="mt-1 max-w-[220px] text-right text-xs text-slate-500">{msg}</span>}
    </span>
  );
}
