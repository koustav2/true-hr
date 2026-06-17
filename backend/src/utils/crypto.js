import crypto from 'crypto';
import { config } from '../config/index.js';

const KEY = Buffer.from(config.piiKey, 'hex'); // 32 bytes
const ALGO = 'aes-256-gcm';

// Encrypts a plaintext string -> "iv:tag:ciphertext" (all base64). Returns null for empty input.
export function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(payload) {
  if (!payload) return null;
  const [ivB, tagB, dataB] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

// Mask a sensitive value, keeping last n chars visible.
export function mask(value, keep = 4) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= keep) return '•'.repeat(s.length);
  return '•'.repeat(s.length - keep) + s.slice(-keep);
}
