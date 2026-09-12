'use client';

import { useState } from 'react';

interface BallotOption {
  id: string;
  label: string;
}

/** Vote form for an open ballot. Votes are anonymized server-side. */
export default function BallotVoteForm({
  ballotId,
  options,
}: {
  ballotId: string;
  options: BallotOption[];
}) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handleVote = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (!selected) throw new Error('Please choose an option.');
      const res = await fetch(`/api/ballots/${ballotId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `Vote failed (HTTP ${res.status}).`);
      }
      setMessage({ kind: 'ok', text: data.message || 'Your vote has been recorded.' });
    } catch (err: any) {
      setMessage({ kind: 'error', text: err.message ?? 'Vote failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleVote} className="mt-4 space-y-3">
      {options.map((opt) => (
        <label key={opt.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-gray-50">
          <input
            type="radio"
            name={`vote-${ballotId}`}
            value={opt.id}
            checked={selected === opt.id}
            onChange={(e) => setSelected(e.target.value)}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium text-gray-800">{opt.label}</span>
        </label>
      ))}
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-md px-3 py-2 text-sm ${
            message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !selected}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {busy ? 'Submitting...' : 'Submit vote'}
      </button>
    </form>
  );
}
