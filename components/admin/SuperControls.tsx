'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const btnCls =
  'rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50';
const selectCls =
  'rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none';

async function api(path: string, method: string, body: unknown) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || 'Request failed');
  return data;
}

export function OrgStatusForm({ orgId, current }: { orgId: string; current: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} disabled={saving}>
        <option value="trial">Trial</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
      </select>
      <button
        type="button"
        className={btnCls}
        disabled={saving || status === current}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            await api('/api/super/orgs', 'PATCH', { orgId, status });
            router.refresh();
          } catch (err: any) {
            setError(err.message ?? 'Failed');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? '…' : 'Save'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function OrgPlanForm({
  orgId,
  plans,
  currentPlanId,
}: {
  orgId: string;
  plans: { id: string; name: string }[];
  currentPlanId: string | null;
}) {
  const router = useRouter();
  const [planId, setPlanId] = useState(currentPlanId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
        className={selectCls}
        disabled={saving}
      >
        <option value="" disabled>
          Select plan…
        </option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btnCls}
        disabled={saving || !planId || planId === currentPlanId}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            await api('/api/super/orgs', 'PATCH', { orgId, planId });
            router.refresh();
          } catch (err: any) {
            setError(err.message ?? 'Failed');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? '…' : 'Save'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function FxRateForm({
  base,
  quote,
  rate,
}: {
  base: string;
  quote: string;
  rate: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(rate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        step="any"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`${selectCls} w-28`}
        disabled={saving}
        aria-label={`${base} to ${quote} rate`}
      />
      <button
        type="button"
        className={btnCls}
        disabled={saving || Number(value) === rate}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            await api('/api/super/fx', 'PUT', { base_currency: base, quote_currency: quote, rate: Number(value) });
            router.refresh();
          } catch (err: any) {
            setError(err.message ?? 'Failed');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? '…' : 'Save'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
