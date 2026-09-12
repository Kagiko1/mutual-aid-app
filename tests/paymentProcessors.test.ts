import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

const TEST_KEY = 'a'.repeat(64); // 32-byte hex

beforeEach(() => {
  process.env.PROCESSOR_CREDENTIALS_KEY = TEST_KEY;
  process.env.MPESA_MODE = 'stub';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('credential crypto', () => {
  it('encrypt/decrypt round-trips per org', async () => {
    const { encryptCredentials, decryptCredentials } = await import('@/lib/payments/crypto');
    const creds = { secret_key: 'sk_test_123', public_key: 'pk_test_456' };
    const cipher = encryptCredentials('org-1', creds);
    expect(cipher).not.toContain('sk_test_123');
    expect(decryptCredentials('org-1', cipher)).toEqual(creds);
  });

  it('decryption with a different org id fails', async () => {
    const { encryptCredentials, decryptCredentials } = await import('@/lib/payments/crypto');
    const cipher = encryptCredentials('org-1', { k: 'v' });
    expect(() => decryptCredentials('org-2', cipher)).toThrow();
  });

  it('tampered ciphertext fails authentication', async () => {
    const { encryptCredentials, decryptCredentials } = await import('@/lib/payments/crypto');
    const cipher = encryptCredentials('org-1', { k: 'v' });
    const buf = Buffer.from(cipher, 'base64');
    buf[buf.length - 20] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptCredentials('org-1', buf.toString('base64'))).toThrow();
  });

  it('maskSecret hides the middle of secrets', async () => {
    const { maskSecret } = await import('@/lib/payments/crypto');
    expect(maskSecret('sk_test_abcdef123456')).toBe('sk_t…3456');
    expect(maskSecret('short')).toBe('••••••••');
  });

  it('requires PROCESSOR_CREDENTIALS_KEY', async () => {
    delete process.env.PROCESSOR_CREDENTIALS_KEY;
    const { encryptCredentials } = await import('@/lib/payments/crypto');
    expect(() => encryptCredentials('org-1', { k: 'v' })).toThrow(/PROCESSOR_CREDENTIALS_KEY/);
  });
});

describe('processor metadata + credential validation', () => {
  it('validates daraja required fields', async () => {
    const { validateCredentials } = await import('@/lib/payments/types');
    expect(() =>
      validateCredentials('daraja', { consumer_key: 'k' }),
    ).toThrow(/Consumer secret/);
    const clean = validateCredentials('daraja', {
      consumer_key: ' k ',
      consumer_secret: 's',
      shortcode: '174379',
      passkey: 'p',
      initiator_name: '',
    });
    expect(clean).toEqual({ consumer_key: 'k', consumer_secret: 's', shortcode: '174379', passkey: 'p' });
  });

  it('rejects unknown processors', async () => {
    const { getProcessorMeta } = await import('@/lib/payments/types');
    expect(() => getProcessorMeta('nope')).toThrow(/unknown payment processor/);
  });

  it('stripe supports collections but not payouts', async () => {
    const { getProcessorMeta } = await import('@/lib/payments/types');
    const m = getProcessorMeta('stripe');
    expect(m.supportsCollections).toBe(true);
    expect(m.supportsPayouts).toBe(false);
  });

  it('daraja is KES-only', async () => {
    const { getProcessorMeta } = await import('@/lib/payments/types');
    expect(getProcessorMeta('daraja').currencies).toEqual(['KES']);
    expect(getProcessorMeta('flutterwave').currencies).toContain('UGX');
  });
});

describe('daraja client', () => {
  it('effectiveMode maps test->sandbox, live->live, unset->MPESA_MODE', async () => {
    const { effectiveMode } = await import('@/lib/mpesa');
    expect(effectiveMode({ environment: 'test' })).toBe('sandbox');
    expect(effectiveMode({ environment: 'live' })).toBe('live');
    expect(effectiveMode(undefined)).toBe('stub');
  });

  it('normalizePhone converts 07.. to 254..', async () => {
    const { normalizePhone } = await import('@/lib/mpesa');
    expect(normalizePhone('0712345678')).toBe('254712345678');
    expect(normalizePhone('+254712345678')).toBe('254712345678');
    expect(() => normalizePhone('123')).toThrow(/Invalid Kenyan phone/);
  });

  it('stkPush stubs without network in stub mode', async () => {
    const { stkPush } = await import('@/lib/mpesa');
    const r = await stkPush({ phone: '0712345678', amountMinor: 500000, accountRef: 'inv-1', description: 'test' });
    expect(r.checkoutRequestId).toMatch(/^ws_CO_stub_/);
  });
});

describe('webhook signature verification', () => {
  it('paystack HMAC-SHA512 verifies', async () => {
    const { verifyPaystackWebhook } = await import('@/lib/payments/paystack');
    const secret = 'sk_test_abc';
    const raw = '{"event":"charge.success"}';
    const sig = createHmac('sha512', secret).update(raw).digest('hex');
    expect(verifyPaystackWebhook(secret, raw, sig)).toBe(true);
    expect(verifyPaystackWebhook(secret, raw, 'deadbeef')).toBe(false);
    expect(verifyPaystackWebhook(secret, raw, null)).toBe(false);
  });

  it('stripe timestamped signature verifies and rejects stale timestamps', async () => {
    const { verifyStripeWebhook } = await import('@/lib/payments/stripe');
    const secret = 'whsec_123';
    const raw = '{"type":"checkout.session.completed"}';
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    expect(verifyStripeWebhook(secret, raw, `t=${t},v1=${v1}`)).toBe(true);
    const oldT = t - 3600;
    const oldV1 = createHmac('sha256', secret).update(`${oldT}.${raw}`).digest('hex');
    expect(verifyStripeWebhook(secret, raw, `t=${oldT},v1=${oldV1}`)).toBe(false);
    expect(verifyStripeWebhook(undefined, raw, `t=${t},v1=${v1}`)).toBe(false);
  });

  it('flutterwave verif-hash compares against the stored secret', async () => {
    const { verifyFlutterwaveWebhook } = await import('@/lib/payments/flutterwave');
    expect(verifyFlutterwaveWebhook('s3cret', 's3cret')).toBe(true);
    expect(verifyFlutterwaveWebhook('s3cret', 'wrong')).toBe(false);
    expect(verifyFlutterwaveWebhook(undefined, 's3cret')).toBe(false);
  });
});

describe('dispatcher fallback', () => {
  /** Minimal chainable mock of the Supabase client surface we use. */
  function mockAdmin(rows: unknown[]) {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    const terminal = {
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
    };
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      chain[m] = () => proxy;
    }
    const proxy = new Proxy({ ...chain, ...terminal }, {
      get: (t, k: string) => (t as Record<string, unknown>)[k] ?? (() => proxy),
    });
    return { from: () => proxy };
  }

  it('falls back to the daraja stub when no processor is configured', async () => {
    const { resolveProcessor } = await import('@/lib/payments');
    const admin = mockAdmin([]);
    const proc = await resolveProcessor(admin as never, 'org-1', 'collections', 'KES');
    expect(proc.processor).toBe('daraja');
    expect(proc.live).toBe(false);
    const r = await proc.collect({
      amountMinor: 100000,
      currency: 'KES',
      phone: '0712345678',
      accountRef: 'inv-1',
      description: 'test',
    });
    expect(r.channel).toBe('mpesa_stk');
    expect(r.nextAction.kind).toBe('stk_sent');
  });

  it('daraja-configured org rejects unsupported currency at resolve time', async () => {
    const { encryptCredentials } = await import('@/lib/payments/crypto');
    const { resolveProcessor } = await import('@/lib/payments');
    const cipher = encryptCredentials('org-1', { consumer_key: 'k', consumer_secret: 's', shortcode: '1', passkey: 'p' });
    const row = {
      id: 'row-1', org_id: 'org-1', processor: 'daraja', environment: 'test',
      purpose: 'both', is_active: true, credentials_cipher: cipher,
    };
    const admin = mockAdmin([row]);
    await expect(resolveProcessor(admin as never, 'org-1', 'collections', 'UGX')).rejects.toThrow(
      /does not support UGX/,
    );
  });

  it('stripe payout throws unsupported', async () => {
    const { stripePayout } = await import('@/lib/payments/stripe');
    await expect(
      stripePayout({ secret_key: 'sk_test_x' }, { amountMinor: 100, currency: 'USD', remarks: 'r' }),
    ).rejects.toThrow(/collections-only/);
  });
});

describe('adapter request building (mocked fetch)', () => {
  it('flutterwave collect posts a payment link', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ status: 'success', data: { link: 'https://pay.flw/abc' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { flutterwaveCollect } = await import('@/lib/payments/flutterwave');
    const r = await flutterwaveCollect(
      { secret_key: 'FLWSECK_TEST-x' },
      { amountMinor: 500000, currency: 'UGX', accountRef: 'inv-1', description: 'd', returnUrl: 'https://app/r' },
    );
    expect(r.channel).toBe('flutterwave_link');
    expect(r.nextAction.kind).toBe('redirect');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.currency).toBe('UGX');
    expect(body.amount).toBe(5000);
  });

  it('paystack collect posts an initialize transaction', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ status: true, data: { authorization_url: 'https://paystack.pay/x', reference: 'ref-1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { paystackCollect } = await import('@/lib/payments/paystack');
    const r = await paystackCollect(
      { secret_key: 'sk_test_x' },
      { amountMinor: 250000, currency: 'NGN', accountRef: 'inv-2', description: 'd' },
    );
    expect(r.channel).toBe('paystack_inline');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(250000); // lowest denomination
    expect(body.currency).toBe('NGN');
  });

  it('stripe collect creates a checkout session', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: 'cs_123', url: 'https://checkout.stripe/x' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { stripeCollect } = await import('@/lib/payments/stripe');
    const r = await stripeCollect(
      { secret_key: 'sk_test_x' },
      { amountMinor: 1000, currency: 'USD', accountRef: 'inv-3', description: 'Welfare', returnUrl: 'https://app/r' },
    );
    expect(r.channel).toBe('stripe_checkout');
    expect(r.providerRef).toBe('cs_123');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
});
