import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getNeonSql } from './neon';

function encryptionKey(): Buffer {
  const encoded = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  if (!encoded) throw new Error('Admin MFA is not configured. Set ADMIN_MFA_ENCRYPTION_KEY.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error('ADMIN_MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function createTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptTotpSecret(value: string): string {
  const [ivValue, tagValue, ciphertextValue] = value.split('.');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Stored admin MFA secret is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function createTotpUri(secret: string, email: string): string {
  const label = encodeURIComponent(`G-squad Admin:${email}`);
  const issuer = encodeURIComponent('G-squad Admin');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(now / 30_000);
  for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
    const expected = totpAtStep(secret, step);
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(code);
    if (expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer)) {
      return step;
    }
  }
  return null;
}

export function createBackupCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase());
  return {
    codes,
    hashes: codes.map((code) => createHash('sha256').update(code).digest('hex')),
  };
}

export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const normalized = code.replace(/-/g, '').toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(normalized)) return false;
  const hash = createHash('sha256').update(normalized).digest('hex');
  const rows = await getNeonSql()`SELECT admin_totp_backup_codes AS codes FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
  const codes = rows[0]?.codes;
  if (!Array.isArray(codes) || !codes.includes(hash)) return false;
  const remaining = codes.filter((value) => value !== hash);
  const updated = await getNeonSql()`UPDATE app_users SET admin_totp_backup_codes = ${JSON.stringify(remaining)}::jsonb
    WHERE id = ${userId}::uuid AND admin_totp_backup_codes = ${JSON.stringify(codes)}::jsonb
    RETURNING id` as Record<string, unknown>[];
  return Boolean(updated[0]);
}

function totpAtStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

function base32Encode(input: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Stored admin MFA secret is invalid.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
