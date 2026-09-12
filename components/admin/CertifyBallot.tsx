'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TotpField from './TotpField';
import { btnPrimary } from './ui';

export default function CertifyBallot({ ballotId }: { ballotId: string }) {
  const router = useRouter();
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function certify() {
    if (totp.length !== 6) {
      setMsg({ ok: false, text: 'Enter the 6-digit authenticator code.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/ballots/${ballotId}/certify`, {
        method: 'POST',
        headers: { 'x-totp-code': totp },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      setMsg({ ok: true, text: (data as { message?: string }).message || 'Ballot certified.' });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Request failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {msg && (
        <div
          className={`mb-3 rounded-lg border px-4 py-3 text-sm ${
            msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {msg.text}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <TotpField value={totp} onChange={setTotp} />
        <button type="button" onClick={certify} disabled={busy} className={btnPrimary}>
          {busy ? 'Certifying…' : 'Certify ballot'}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Certification is TOTP-gated and irreversible. Results are published from the ballot record.
      </p>
    </div>
  );
}
