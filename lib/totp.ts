/**
 * TOTP (authenticator-app MFA) helpers, backed by otplib v13.
 *
 * otplib v13 ships a functional API: generateSecret() / verifySync() /
 * generateURI(). verifySync uses the default NobleCryptoPlugin, which
 * supports synchronous HMAC.
 */
import { generateSecret, generateURI, verifySync } from 'otplib';

/** Generate a new base32 secret to store on the profile (totp_secret). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Verify a 6-digit token against the stored secret. Never throws. */
export function verifyTotp(secret: string | null | undefined, token: string | null | undefined): boolean {
  if (!secret || !token) return false;
  try {
    return verifySync({ secret, token: token.trim() }).valid === true;
  } catch {
    return false;
  }
}

/** otpauth:// URL for rendering as a QR code in the admin setup UI. */
export function totpAuthUrl(secret: string, accountName: string, issuer: string): string {
  return generateURI({ issuer, label: accountName, secret });
}
