/**
 * Credential encryption for per-tenant payment processor secrets.
 *
 * Processor credentials (API keys, secrets, passkeys) are stored in the
 * `org_payment_processors.credentials_cipher` column as AES-256-GCM
 * ciphertext. The master key comes from PROCESSOR_CREDENTIALS_KEY
 * (32 bytes, hex or base64). A per-org data key is derived with HKDF-SHA256
 * so a leaked row cannot be decrypted without the master key, and key
 * rotation can be scoped per org in future.
 *
 * Wire format (base64): version(1) | salt(16) | iv(12) | ciphertext | tag(16)
 */
import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'crypto';

const VERSION = 1;

function masterKey(): Buffer {
  const raw = process.env.PROCESSOR_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error(
      'PROCESSOR_CREDENTIALS_KEY is not set — generate with: openssl rand -hex 32',
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error('PROCESSOR_CREDENTIALS_KEY must decode to 32 bytes');
  }
  return key;
}

/** Derive a per-org 32-byte key from the master key. */
export function deriveOrgKey(orgId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey(), orgId, 'org-payment-processor-v1', 32));
}

export function encryptCredentials(orgId: string, plaintext: Record<string, string>): string {
  const key = deriveOrgKey(orgId);
  const salt = randomBytes(16); // reserved for future KDF params; mixed into AAD
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([Buffer.from([VERSION]), salt]));
  const data = Buffer.from(JSON.stringify(plaintext), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), salt, iv, ciphertext, tag]).toString('base64');
}

export function decryptCredentials(orgId: string, encoded: string): Record<string, string> {
  const key = deriveOrgKey(orgId);
  const buf = Buffer.from(encoded, 'base64');
  const version = buf[0];
  if (version !== VERSION) throw new Error(`unsupported credential cipher version: ${version}`);
  const salt = buf.subarray(1, 17);
  const iv = buf.subarray(17, 29);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(29, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.concat([Buffer.from([VERSION]), salt]));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('decrypted credentials are not an object');
  }
  return parsed as Record<string, string>;
}

/** Mask a secret for display (e.g. "sk_live_abc...xyz1" -> "sk_l...xyz1"). */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
