'use client';

import { useRef } from 'react';

/**
 * Reusable 6-digit TOTP code input. Controlled: parent owns the code string.
 * Digits only, auto-advances, backspace moves back, paste fills all boxes.
 */
export default function TotpField({
  value,
  onChange,
  disabled = false,
  label = 'Authenticator code (6 digits)',
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setCode = (next: string) => {
    onChange(next.replace(/\D/g, '').slice(0, 6));
  };

  const handleChange = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;
    const arr = value.split('');
    // fill sequentially from the focused box (handles paste of several digits)
    digits.split('').forEach((d, k) => {
      if (i + k < 6) arr[i + k] = d;
    });
    setCode(arr.join(''));
    const nextFocus = Math.min(i + digits.length, 5);
    refs.current[nextFocus]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) {
      e.preventDefault();
      const arr = value.split('');
      arr[i - 1] = '';
      setCode(arr.join(''));
      refs.current[i - 1]?.focus();
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">{label}</label>
      <div className="flex gap-2" role="group" aria-label={label}>
        {Array.from({ length: 6 }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            disabled={disabled}
            value={value[i] ?? ''}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            className="h-11 w-10 rounded-lg border border-slate-300 text-center text-lg font-semibold tracking-widest text-slate-900 focus:border-slate-900 focus:outline-none disabled:opacity-50"
          />
        ))}
      </div>
    </div>
  );
}
