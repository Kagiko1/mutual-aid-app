'use client';

import { useState } from 'react';

/** Triggers an M-Pesa STK push for a single invoice via the backend API. */
export default function PayButton({ invoiceId, defaultPhone }: { invoiceId: string; defaultPhone: string }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handlePay = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!phone.trim()) throw new Error('Please enter your M-Pesa phone number.');
      const res = await fetch('/api/mpesa/stk-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `Payment request failed (HTTP ${res.status}).`);
      }
      setMessage({
        kind: 'ok',
        text: data.message || 'STK push sent. Enter your M-Pesa PIN on your phone to complete payment.',
      });
    } catch (err: any) {
      setMessage({ kind: 'error', text: err.message ?? 'Payment failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+2547..."
          aria-label="M-Pesa phone number"
          className="w-40 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={handlePay}
          disabled={busy}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy ? 'Sending...' : 'Pay with M-Pesa'}
        </button>
      </div>
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
    </div>
  );
}
