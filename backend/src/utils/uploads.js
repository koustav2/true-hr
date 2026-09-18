// ============================================================================
// Safe handling of files that came from a user.
//
// Two rules, applied at every upload and every download, because breaking
// either one turns an attachment into stored cross-site scripting:
//
//   1. The type is decided HERE, from an allowlist, and never taken from the
//      uploader. A client that says `text/html` used to have that echoed back
//      as the response Content-Type.
//   2. It is served as a download, never inline. The portal fetches these into
//      a blob: URL, and a blob inherits the page's origin — so an inline HTML
//      response executes as script on our own domain, where the session token
//      lives.
//
// The magic-byte check is the third belt: it means the allowlist describes what
// the bytes actually are, not what the request claimed.
// ============================================================================
import { AppError } from '../middleware/error.js';

/** mime -> { ext, kind, magic? }. Anything absent is refused. */
const TYPES = {
  'image/png':  { ext: 'png',  kind: 'image', magic: ['89504e47'] },
  'image/jpeg': { ext: 'jpg',  kind: 'image', magic: ['ffd8ff'] },
  'image/webp': { ext: 'webp', kind: 'image', magic: ['52494646'] },   // RIFF....WEBP
  'image/gif':  { ext: 'gif',  kind: 'image', magic: ['47494638'] },
  'application/pdf': { ext: 'pdf', kind: 'doc', magic: ['25504446'] }, // %PDF
  // Office files are ZIP containers (PK..) or the old OLE compound format.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    { ext: 'docx', kind: 'office', magic: ['504b0304'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    { ext: 'xlsx', kind: 'office', magic: ['504b0304'] },
  'application/msword': { ext: 'doc', kind: 'office', magic: ['d0cf11e0'] },
  'application/vnd.ms-excel': { ext: 'xls', kind: 'office', magic: ['d0cf11e0', '504b0304'] },
};

export const IMAGE_KINDS = ['image'];
export const DOC_KINDS = ['image', 'doc'];
export const ANY_KINDS = ['image', 'doc', 'office'];

const MB = 1024 * 1024;

/** Bytes a base64 payload will decode to, without decoding it. */
export const base64Bytes = (s) => {
  const t = String(s || '').replace(/=+$/, '');
  return Math.floor(t.length * 3 / 4);
};

const normaliseMime = (m) => String(m || '').toLowerCase().split(';')[0].trim();

// A data: URL slips through when a client sends the whole FileReader result
// instead of just the payload; take the bytes and believe none of the header.
const stripDataUrl = (s) => {
  const str = String(s || '');
  const at = str.indexOf('base64,');
  return at === -1 ? str : str.slice(at + 7);
};

function magicMatches(b64, spec) {
  if (!spec.magic) return true;
  // 12 base64 chars decode to 9 bytes — enough for every signature above.
  let head;
  try { head = Buffer.from(b64.slice(0, 16), 'base64').toString('hex'); }
  catch { return false; }
  return spec.magic.some((sig) => head.startsWith(sig));
}

/**
 * Check one uploaded file and return what is safe to store.
 *
 * @returns {{ data: string, mime: string, name: string, bytes: number }}
 * @throws  {AppError} 400, with a message meant for the person who uploaded it.
 */
export function checkUpload({
  data, mime, name, label = 'file', maxMb = 5, kinds = DOC_KINDS, required = false,
} = {}) {
  const raw = stripDataUrl(data);
  if (!raw) {
    if (required) throw new AppError(`A ${label} is required`);
    return null;
  }
  const type = normaliseMime(mime);
  const spec = TYPES[type];
  const allowed = Object.entries(TYPES).filter(([, v]) => kinds.includes(v.kind));
  if (!spec || !kinds.includes(spec.kind)) {
    const list = [...new Set(allowed.map(([, v]) => v.ext.toUpperCase()))].join(', ');
    throw new AppError(`The ${label} must be a ${list} file`);
  }
  const bytes = base64Bytes(raw);
  if (bytes > maxMb * MB) throw new AppError(`The ${label} is larger than ${maxMb}MB`);
  if (!magicMatches(raw, spec)) {
    throw new AppError(`That ${label} is not really a ${spec.ext.toUpperCase()} file`);
  }
  const safeName = String(name || '').trim().replace(/[^\w.\- ]/g, '_').slice(0, 120)
    || `${label.replace(/\s+/g, '-')}.${spec.ext}`;
  return { data: raw, mime: type, name: safeName, bytes };
}

/**
 * Send a stored file back. The type comes from the allowlist, not from the
 * column, and it always downloads — see the header comment for why.
 */
export function sendAttachment(res, { data, mime, name, fallbackName = 'attachment' }) {
  const spec = TYPES[normaliseMime(mime)];
  // A row written before the allowlist existed may hold anything at all. Serving
  // it as a generic download is safe; guessing its type is not.
  const type = spec ? normaliseMime(mime) : 'application/octet-stream';
  const ext = spec ? spec.ext : 'bin';
  const safe = String(name || '').trim().replace(/[^\w.\- ]/g, '_').slice(0, 120)
    || `${fallbackName}.${ext}`;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(Buffer.from(data, 'base64'));
}

/** Photos we generate ourselves (attendance, geo-tags) — always JPEG, inline is fine. */
export function sendOwnPhoto(res, data) {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(data, 'base64'));
}
