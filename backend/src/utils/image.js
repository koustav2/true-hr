// ============================================================================
// Image verification for anything that will be handed to pdfkit.
//
// This exists because of a real crash: pdfkit's PNG decoder inflates the image
// data inside a zlib callback and rethrows a decode failure asynchronously. A
// try/catch around doc.image() does NOT catch it, so one slightly corrupt logo
// took down the whole API process — every PDF for every tenant — the first time
// anything tried to render it.
//
// So a logo is structurally verified before it is ever stored, and verified
// again before it is drawn (a row saved before this check existed must not be
// able to crash the process either). The PNG path deliberately inflates the
// image data itself with inflateSync, which throws SYNCHRONOUSLY and can
// therefore be caught, reproducing pdfkit's own failure safely.
// ============================================================================
import zlib from 'zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Parse a `data:image/...;base64,...` URL into { mime, buffer }, or null. */
export function parseDataUrl(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^data:(image\/(?:png|jpe?g));base64,([A-Za-z0-9+/=\s]+)$/i.exec(s.trim());
  if (!m) return null;
  try {
    const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    return buffer.length ? { mime: m[1].toLowerCase(), buffer } : null;
  } catch { return null; }
}

function checkPng(buf) {
  if (buf.length < 12 || !buf.subarray(0, 8).equals(PNG_SIG)) return 'not a PNG file';
  let off = 8;
  let sawIhdr = false;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (len > buf.length || dataEnd + 4 > buf.length) return 'the PNG is truncated';
    if (type === 'IHDR') {
      if (len < 13) return 'the PNG header is malformed';
      sawIhdr = true;
      const width = buf.readUInt32BE(dataStart);
      const height = buf.readUInt32BE(dataStart + 4);
      if (!width || !height) return 'the PNG has no dimensions';
      if (width > 8000 || height > 8000) return 'the image is larger than 8000px — resize it first';
      // pdfkit cannot draw interlaced (Adam7) PNGs; it throws on them.
      if (buf[dataStart + 12] !== 0) return 'interlaced PNGs are not supported — re-save it without interlacing';
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataEnd));
    }
    // A declared CRC that does not match is exactly what made zlib throw.
    const crcGiven = buf.readUInt32BE(dataEnd);
    const crcCalc = zlib.crc32
      ? zlib.crc32(buf.subarray(off + 4, dataEnd))
      : null;
    if (crcCalc != null && crcGiven !== crcCalc) return `the PNG's ${type} chunk is corrupt`;
    off = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (!sawIhdr) return 'the PNG has no header';
  if (!idat.length) return 'the PNG has no image data';
  // The decode that actually crashed the process — done here where it is catchable.
  try { zlib.inflateSync(Buffer.concat(idat)); }
  catch { return 'the PNG image data will not decode — re-export the file'; }
  return null;
}

function checkJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 'not a JPEG file';
  // Walk the markers far enough to find a frame header with real dimensions.
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return 'the JPEG markers are malformed';
    const marker = buf[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    if (marker === 0xd9) break;
    const len = buf.readUInt16BE(off + 2);
    if (len < 2 || off + 2 + len > buf.length) return 'the JPEG is truncated';
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      if (!width || !height) return 'the JPEG has no dimensions';
      if (width > 8000 || height > 8000) return 'the image is larger than 8000px — resize it first';
      return null;
    }
    off += 2 + len;
  }
  return 'the JPEG has no frame header';
}

/**
 * @returns {{ok:true, mime:string, buffer:Buffer} | {ok:false, error:string}}
 * Never throws.
 */
export function verifyImage(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: 'must be a PNG or JPEG image' };
  let problem;
  try {
    problem = parsed.mime === 'image/png' ? checkPng(parsed.buffer) : checkJpeg(parsed.buffer);
  } catch { problem = 'the image could not be read'; }
  return problem ? { ok: false, error: problem } : { ok: true, ...parsed };
}

/** The drawable Buffer, or null. Safe to call on anything. */
export function safeImageBuffer(dataUrl) {
  const v = verifyImage(dataUrl);
  return v.ok ? v.buffer : null;
}
