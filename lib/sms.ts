/**
 * SMS sending.
 *
 * SMS_PROVIDER controls behavior:
 *   'stub'          (default) — console.log only, always "succeeds".
 *   'africastalking'          — real HTTP to api.africastalking.com.
 * If Africa's Talking is selected but credentials are missing, we fall back
 * to stub mode with a warning (never throw on a best-effort notification).
 */

export interface SmsResult {
  ok: boolean;
  provider: string;
}

export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  const provider = process.env.SMS_PROVIDER ?? 'stub';

  if (provider !== 'africastalking') {
    console.log(`[sms stub] to=${phone} msg="${message}"`);
    return { ok: true, provider: 'stub' };
  }

  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;
  if (!apiKey || !username) {
    console.warn(
      "[sms] SMS_PROVIDER=africastalking but AFRICASTALKING_API_KEY/USERNAME are missing — falling back to stub",
    );
    console.log(`[sms stub] to=${phone} msg="${message}"`);
    return { ok: true, provider: 'stub' };
  }

  try {
    const params = new URLSearchParams({ username, to: phone, message });
    const senderId = process.env.AFRICASTALKING_SENDER_ID;
    if (senderId) params.set('from', senderId);

    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        apiKey,
      },
      body: params.toString(),
    });
    if (!res.ok) {
      console.error(`[sms] Africa's Talking HTTP ${res.status}`);
      return { ok: false, provider: 'africastalking' };
    }
    return { ok: true, provider: 'africastalking' };
  } catch (e) {
    console.error('[sms] Africa\'s Talking request failed:', e);
    return { ok: false, provider: 'africastalking' };
  }
}
