'use client';

import { useState } from 'react';

/**
 * Starts a collection for a single invoice via the backend, which routes
 * through the org's active payment processor:
 *  - M-Pesa Daraja: STK push to the entered phone number.
 *  - Flutterwave / Paystack / Stripe: redirects the member to a hosted
 *    payment page; the webhook reconciles the invoice afterwards.
 */
export default function PayButton({ invoiceId, defaultPhone }: { invoiceId: string; defaultPhone: string }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handlePay = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/mpesa/stk-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, phone: phone.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `Payment request failed (HTTP ${res.status}).`);
      }
      if (data.authorizationUrl) {
        setMessage({ kind: 'ok', text: 'Opening the secure payment page…' });
        window.location.href = data.authorizationUrl as string;
        return;
      }
      setMessage({
        kind: 'ok',
        text:
          data.message ||
          'Payment request sent. Follow the prompt on your phone to complete payment.',
      });
    } catch (err: unknown) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Payment failed.' });
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
          placeholder="Phone (for M-Pesa)"
          aria-label="Phone number for mobile money"
          className="w-44 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={handlePay}
          disabled={busy}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Pay now'}
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
