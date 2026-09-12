'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TotpField from './TotpField';
import { btnPrimary, btnSecondary, inputCls } from './ui';

function SignatureCanvas({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = 480;
    c.height = 160;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0f172a';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, []);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const t = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    return { x: (t.clientX - r.left) * (480 / r.width), y: (t.clientY - r.top) * (160 / r.height) };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    onChange('');
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="h-32 w-full cursor-crosshair touch-none rounded-lg border border-slate-300 bg-white"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <button type="button" onClick={clear} className="mt-1 text-xs font-medium text-slate-500 hover:text-slate-800">
        Clear signature
      </button>
    </div>
  );
}

type Msg = { ok: boolean; text: string } | null;

export default function CaseActions({
  caseId,
  status,
  initialNotes,
}: {
  caseId: string;
  status: string;
  initialNotes: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [sigType, setSigType] = useState<'typed' | 'canvas'>('typed');
  const [typedName, setTypedName] = useState('');
  const [canvasData, setCanvasData] = useState('');
  const [totpApprove, setTotpApprove] = useState('');
  const [totpDisburse, setTotpDisburse] = useState('');

  const canReview = status === 'pending_review' || status === 'draft';
  const canApprove = status === 'pending_review' || status === 'reviewed';
  const canDisburse = status === 'approved';

  async function callApi(
    key: string,
    path: string,
    opts: { method?: string; body?: unknown; totp?: string } = {},
  ) {
    setBusy(key);
    setMsg(null);
    try {
      const headers: Record<string, string> = {};
      let body: string | undefined;
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      if (opts.totp) headers['x-totp-code'] = opts.totp;
      const res = await fetch(path, { method: opts.method ?? 'POST', headers, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      setMsg({ ok: true, text: (data as { message?: string }).message || 'Done.' });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Request failed.' });
    } finally {
      setBusy(null);
    }
  }

  const review = (decision: 'request_corrections' | 'reviewed') =>
    callApi(`review-${decision}`, `/api/cases/${caseId}/review`, { body: { decision, notes } });

  const approve = () => {
    const signatureData = sigType === 'typed' ? typedName.trim() : canvasData;
    if (!signatureData) {
      setMsg({ ok: false, text: 'Please provide your signature first.' });
      return;
    }
    if (totpApprove.length !== 6) {
      setMsg({ ok: false, text: 'Enter the 6-digit authenticator code.' });
      return;
    }
    callApi('approve', `/api/cases/${caseId}/approve`, {
      body: { signatureType: sigType, signatureData },
      totp: totpApprove,
    });
  };

  const disburse = () => {
    if (totpDisburse.length !== 6) {
      setMsg({ ok: false, text: 'Enter the 6-digit authenticator code.' });
      return;
    }
    callApi('disburse', `/api/cases/${caseId}/disburse`, { totp: totpDisburse });
  };

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Review */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Review</h3>
        <p className="mb-3 text-xs text-slate-500">
          Current status: <span className="font-medium text-slate-700">{status}</span>
        </p>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">Admin notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Notes for the claimant or the audit trail…"
          className={inputCls}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => review('request_corrections')}
            disabled={!canReview || busy !== null}
            className={btnSecondary}
          >
            {busy === 'review-request_corrections' ? 'Sending…' : 'Request corrections'}
          </button>
          <button
            type="button"
            onClick={() => review('reviewed')}
            disabled={!canReview || busy !== null}
            className={btnPrimary}
          >
            {busy === 'review-reviewed' ? 'Saving…' : 'Mark reviewed'}
          </button>
        </div>
        {!canReview && <p className="mt-2 text-xs text-slate-400">Review actions are available while the case is pending review.</p>}
      </div>

      {/* Approve + sign */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Approve + sign</h3>
        <p className="mb-3 text-xs text-slate-500">TOTP-gated. Records your e-signature on approval.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Signature type</label>
            <select value={sigType} onChange={(e) => setSigType(e.target.value as 'typed' | 'canvas')} className={inputCls}>
              <option value="typed">Typed name</option>
              <option value="canvas">Drawn signature</option>
            </select>
            <div className="mt-3">
              {sigType === 'typed' ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Type your full name</label>
                  <input
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="e.g. Jane Wanjiru"
                    className={inputCls}
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Draw your signature</label>
                  <SignatureCanvas onChange={setCanvasData} />
                </div>
              )}
            </div>
          </div>
          <div>
            <TotpField value={totpApprove} onChange={setTotpApprove} />
            <button
              type="button"
              onClick={approve}
              disabled={!canApprove || busy !== null}
              className={`${btnPrimary} mt-4 w-full`}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve case'}
            </button>
            {!canApprove && <p className="mt-2 text-xs text-slate-400">Approval is available once the case is reviewed.</p>}
          </div>
        </div>
      </div>

      {/* Disburse */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Disburse</h3>
        <p className="mb-3 text-xs text-slate-500">
          TOTP-gated. Splits the benefit across beneficiaries and issues the voucher.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <TotpField value={totpDisburse} onChange={setTotpDisburse} label="Authenticator code (6 digits)" />
          <button type="button" onClick={disburse} disabled={!canDisburse || busy !== null} className={btnPrimary}>
            {busy === 'disburse' ? 'Disbursing…' : 'Disburse benefit'}
          </button>
        </div>
        {!canDisburse && <p className="mt-2 text-xs text-slate-400">Disbursement is available once the case is approved.</p>}
      </div>
    </div>
  );
}
