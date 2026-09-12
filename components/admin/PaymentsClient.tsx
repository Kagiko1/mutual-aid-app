'use client';

import { useState } from 'react';
import type { ProcessorId, ProcessorMeta, ProcessorRow } from '@/lib/payments/types';
import { Card, StatusPill, btnPrimary, btnSecondary, btnDanger, inputCls } from '@/components/admin/ui';

interface Props {
  orgCurrency: string;
  initialRows: ProcessorRow[];
  meta: Record<ProcessorId, ProcessorMeta>;
}

type Purpose = 'collections' | 'payouts' | 'both';

interface FormState {
  open: boolean;
  environment: 'test' | 'live';
  purpose: Purpose;
  values: Record<string, string>;
}

const emptyForm = (): FormState => ({ open: false, environment: 'test', purpose: 'both', values: {} });

export default function PaymentsClient({ orgCurrency, initialRows, meta }: Props) {
  const [rows, setRows] = useState<ProcessorRow[]>(initialRows);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const formFor = (id: ProcessorId): FormState => forms[id] ?? emptyForm();
  const setForm = (id: ProcessorId, f: FormState) => setForms((s) => ({ ...s, [id]: f }));

  async function refresh() {
    const res = await fetch('/api/admin/payments');
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.processors)) setRows(data.processors);
  }

  async function testConnection(id: ProcessorId) {
    const f = formFor(id);
    setBusy(`test-${id}`);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/payments/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processor: id, environment: f.environment, credentials: f.values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      setNotice({ kind: 'ok', text: `${meta[id].name}: ${data.detail}` });
    } catch (e: unknown) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Connection test failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function save(id: ProcessorId) {
    const f = formFor(id);
    setBusy(`save-${id}`);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processor: id,
          environment: f.environment,
          purpose: f.purpose,
          credentials: f.values,
          is_active: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      setForm(id, emptyForm());
      setNotice({ kind: 'ok', text: `${meta[id].name} connected and activated.` });
      await refresh();
    } catch (e: unknown) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(row: ProcessorRow) {
    setBusy(`toggle-${row.id}`);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processor: row.processor,
          environment: row.environment,
          purpose: row.purpose,
          is_active: !row.is_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      await refresh();
    } catch (e: unknown) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Update failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(row: ProcessorRow) {
    if (!window.confirm(`Disconnect ${meta[row.processor].name} (${row.environment})? Its stored credentials will be deleted.`)) return;
    setBusy(`del-${row.id}`);
    try {
      const res = await fetch(`/api/admin/payments/${row.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (e: unknown) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Disconnect failed.' });
    } finally {
      setBusy(null);
    }
  }

  const order: ProcessorId[] = ['daraja', 'flutterwave', 'paystack', 'stripe'];

  return (
    <div className="space-y-4">
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-4 py-2.5 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}
        >
          {notice.text}
        </p>
      )}

      {order.map((id) => {
        const m = meta[id];
        const configured = rows.filter((r) => r.processor === id);
        const active = configured.find((r) => r.is_active);
        const f = formFor(id);
        const currencyOk = m.currencies.includes(orgCurrency);

        return (
          <Card key={id} title={m.name}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="max-w-xl">
                  <p className="text-sm text-slate-600">{m.tagline}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {m.regions} · Currencies: {m.currencies.join(', ')}
                    {!currencyOk && (
                      <span className="ml-2 font-medium text-amber-700">
                        does not support your org currency ({orgCurrency})
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  {active ? (
                    <StatusPill status={`active · ${active.environment}`} />
                  ) : (
                    <StatusPill status="not connected" />
                  )}
                </div>
              </div>

              {configured.length > 0 && (
                <div className="space-y-1.5">
                  {configured.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-800">{r.environment}</span>
                      <span className="text-slate-500">· {r.purpose}</span>
                      {r.credentials_hint && (
                        <span className="text-xs text-slate-500">
                          {Object.entries(r.credentials_hint).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </span>
                      )}
                      {r.last_tested_at && (
                        <span className={`text-xs ${r.last_test_ok ? 'text-emerald-700' : 'text-red-700'}`}>
                          · tested {new Date(r.last_tested_at).toLocaleDateString()}
                        </span>
                      )}
                      <span className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => toggleActive(r)}
                          disabled={busy !== null}
                          className={btnSecondary}
                        >
                          {r.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => disconnect(r)}
                          disabled={busy !== null}
                          className={btnDanger}
                        >
                          Disconnect
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {!f.open ? (
                <button type="button" onClick={() => setForm(id, { ...emptyForm(), open: true })} className={btnSecondary}>
                  {configured.length ? 'Update credentials' : 'Connect'}
                </button>
              ) : (
                <div className="space-y-3 rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap gap-4">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-slate-500">Environment</span>
                      <select
                        value={f.environment}
                        onChange={(e) => setForm(id, { ...f, environment: e.target.value as 'test' | 'live' })}
                        className={inputCls}
                      >
                        <option value="test">Test (sandbox keys)</option>
                        <option value="live">Live (real money)</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-slate-500">Use for</span>
                      <select
                        value={f.purpose}
                        onChange={(e) => setForm(id, { ...f, purpose: e.target.value as Purpose })}
                        className={inputCls}
                      >
                        {m.supportsCollections && m.supportsPayouts && <option value="both">Collections + payouts</option>}
                        {m.supportsCollections && <option value="collections">Collections only</option>}
                        {m.supportsPayouts && <option value="payouts">Payouts only</option>}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {m.fields.map((field) => (
                      <label key={field.key} className="text-sm">
                        <span className="mb-1 block text-xs font-medium text-slate-500">
                          {field.label} {field.required && <span className="text-red-600">*</span>}
                        </span>
                        <input
                          type={field.secret ? 'password' : 'text'}
                          value={f.values[field.key] ?? ''}
                          onChange={(e) => setForm(id, { ...f, values: { ...f.values, [field.key]: e.target.value } })}
                          placeholder={field.placeholder}
                          autoComplete="off"
                          className={inputCls}
                        />
                        {field.help && <span className="mt-1 block text-xs text-slate-400">{field.help}</span>}
                      </label>
                    ))}
                  </div>

                  <p className="text-xs text-slate-500">{m.testHint}</p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => testConnection(id)}
                      disabled={busy !== null}
                      className={btnSecondary}
                    >
                      {busy === `test-${id}` ? 'Testing…' : 'Test connection'}
                    </button>
                    <button
                      type="button"
                      onClick={() => save(id)}
                      disabled={busy !== null}
                      className={btnPrimary}
                    >
                      {busy === `save-${id}` ? 'Saving…' : 'Save & activate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(id, emptyForm())}
                      disabled={busy !== null}
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
