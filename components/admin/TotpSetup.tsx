'use client';

import { useState } from 'react';
import TotpField from './TotpField';
import { btnPrimary, btnSecondary } from './ui';

type Msg = { ok: boolean; text: string } | null;

export default function TotpSetup() {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/totp/setup', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      setSecret((data as { secret?: string }).secret ?? null);
      setOtpauthUrl((data as { otpauth_url?: string }).otpauth_url ?? null);
      setVerified(false);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Request failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (token.length !== 6) {
      setMsg({ ok: false, text: 'Enter the 6-digit code from your authenticator app.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      setVerified(true);
      setMsg({ ok: true, text: 'TOTP verified and enabled for your admin account.' });
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

      {!secret ? (
        <div>
          <p className="mb-3 text-sm text-slate-600">
            Sensitive admin actions (approving cases, disbursing, certifying ballots, recording manual payments)
            require a 6-digit authenticator code. Set up TOTP for this admin account first.
          </p>
          <button type="button" onClick={generate} disabled={busy} className={btnPrimary}>
            {busy ? 'Generating…' : 'Generate setup code'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">
              Scan this link in your authenticator app, or enter the secret manually:
            </p>
            {otpauthUrl && (
              <a href={otpauthUrl} className="break-all text-sm font-medium text-slate-700 underline">
                {otpauthUrl}
              </a>
            )}
            <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm tracking-widest text-slate-900">
              {secret}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <TotpField value={token} onChange={setToken} label="Code from authenticator app" />
            <button type="button" onClick={verify} disabled={busy || verified} className={btnSecondary}>
              {busy ? 'Verifying…' : verified ? 'Verified' : 'Verify & enable'}
            </button>
          </div>
          <button type="button" onClick={generate} disabled={busy} className="text-xs font-medium text-slate-500 hover:text-slate-800">
            Regenerate setup code
          </button>
        </div>
      )}
    </div>
  );
}
