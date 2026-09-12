'use client';

import { useState } from 'react';
import { inputCls, btnPrimary } from './ui';

export default function BallotCreateForm({
  createBallot,
}: {
  createBallot: (formData: FormData) => Promise<void>;
}) {
  const [options, setOptions] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    fd.set('options', JSON.stringify(options.map((o) => o.trim()).filter(Boolean)));
    await createBallot(fd);
    setBusy(false);
    setOptions(['', '']);
    (e.target as HTMLFormElement).reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">Title *</label>
        <input name="title" required className={inputCls} placeholder="e.g. Elect welfare committee chair" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">Description</label>
        <textarea name="description" rows={2} className={inputCls} placeholder="What is this ballot about?" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">Options</label>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={o}
                onChange={(e) => setOptions((prev) => prev.map((p, k) => (k === i ? e.target.value : p)))}
                placeholder={`Option ${i + 1}`}
                className={inputCls}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((_, k) => k !== i))}
                  className="rounded-lg border border-slate-300 px-3 text-sm text-slate-500 hover:bg-slate-50"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOptions((prev) => [...prev, ''])}
          className="mt-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          + Add option
        </button>
      </div>
      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? 'Creating…' : 'Create ballot (draft)'}
      </button>
    </form>
  );
}
