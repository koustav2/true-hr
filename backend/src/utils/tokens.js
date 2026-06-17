import crypto from 'crypto';

// Generate a raw magic-link token + its sha256 hash (only the hash is stored).
export function generateMagicToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}
export const hashToken = (raw) =>
  crypto.createHash('sha256').update(raw).digest('hex');
