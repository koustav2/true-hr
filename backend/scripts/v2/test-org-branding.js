// Document branding (QA C29, H100, H101, H102).
import zlib from 'zlib';
import { ok, section, get, put, call, makeOrg, query, pool } from './_harness.js';

// A real, decodable PNG of w×h (solid white), for logo/signature uploads.
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0xff);
  for (let y = 0; y < h; y += 1) raw[y * (w * 3 + 1)] = 0;
  const buf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

export default async function branding(ctx) {
  section('branding: a new organisation starts from its own identity (C29)');
  const org = await makeOrg(ctx.master);
  const b0 = await get(org.token, '/admin/branding');
  ok('GET /admin/branding 200 for new org', b0.status === 200, b0.body);
  const prof = b0.body?.profile || {};
  ok('editor starts from the org\'s own name', prof.legalName === org.name, prof.legalName);
  ok('editor does not carry the deployment address/website', !/noida/i.test(prof.addressLine1 || '') && !prof.website, prof);
  const eff = b0.body?.effective || {};
  ok('effective brand is the org, not TRUE HR', eff.brandName === org.name && !/true hr/i.test(eff.brandName || ''), eff.brandName);
  ok('effective contact uses the org phone, not the deployment', /9876543210/.test(eff.contactLine || '') && !/7370067005|truekind/i.test(eff.contactLine || ''), eff.contactLine);
  const b0v1 = await get(org.token, '/admin/branding', { v: 1 });
  ok('v1 gets the same corrected defaults (wrong-data fix)', b0v1.status === 200 && b0v1.body?.effective?.brandName === org.name);
  ok('offer placeholders listed for the editor', Array.isArray(b0.body?.offerPlaceholders) && b0.body.offerPlaceholders.includes('employeeName'));

  const seedB = await get(ctx.sa, '/admin/branding');
  ok('the deployment\'s own org keeps its fallback identity', seedB.status === 200 && /true hr/i.test(seedB.body?.effective?.brandName || ''), seedB.body?.effective?.brandName);

  const { brandForEmployee, resolveBrand, joinAddress } = await import('../../src/services/docProfile.js');
  const viaCompany = await resolveBrand({ companyId: (await query(`SELECT id FROM companies WHERE organisation_id=$1`, [org.id])).rows[0].id });
  ok('resolveBrand({companyId}) alone finds the org identity (offer emails)', viaCompany.brandName === org.name, viaCompany.brandName);
  const emp = await ctx.makeEmployee(org.id);
  const be = await brandForEmployee(emp.id);
  ok('brandForEmployee for a new-org employee is that org', be.brandName === org.name && !/noida/i.test(be.addressLine || ''), be.brandName);

  section('branding: v2 validation (C29, H100)');
  const bad = await put(org.token, '/admin/branding', {
    pincode: '12ab', website: 'xyz', phone: '12', gstin: 'abc', pan: '123', cin: 'jasksfjloesifakfjkavsjfkasvjf',
    accentColor: 'red', options: { offer: { salutation: 'Dear {{badPlaceholder}},' } },
  });
  const f = bad.body?.fields || {};
  ok('invalid identity rejected with 400', bad.status === 400, bad.body);
  for (const k of ['pincode', 'website', 'phone', 'gstin', 'pan', 'cin', 'accentColor', 'offer.salutation']) {
    ok(`field error for ${k}`, !!f[k], f);
  }
  ok('accent colour message is readable', /Accent colour is not valid/.test(f.accentColor || ''), f.accentColor);
  ok('unknown placeholder named in the message', /\{\{badPlaceholder\}\}/.test(f['offer.salutation'] || ''), f['offer.salutation']);
  ok('nothing saved on a rejected PUT', (await query(`SELECT 1 FROM document_profiles WHERE organisation_id=$1`, [org.id])).rowCount === 0);
  const unclosed = await put(org.token, '/admin/branding', { options: { offer: { intro: 'Hello {{employeeName' } } });
  ok('unclosed placeholder rejected', unclosed.status === 400 && !!unclosed.body?.fields?.['offer.intro'], unclosed.body);

  const v1bad = await put(org.token, '/admin/branding', { pincode: '12ab', website: 'xyz', phone: '12' }, { v: 1 });
  ok('v1 keeps its old (lenient) contract', v1bad.status === 200, v1bad.body);
  const v1hex = await put(org.token, '/admin/branding', { accentColor: 'red' }, { v: 1 });
  ok('v1 still rejects a bad hex with its old message', v1hex.status === 400 && /hex colour/.test(v1hex.body?.error || ''), v1hex.body);

  const good = await put(org.token, '/admin/branding', {
    legalName: 'Company Admin Pvt Ltd', pincode: '751001', website: 'www.example.com', phone: '+91 98765 43210',
    gstin: '21abcde1234f1z5', pan: 'abcde1234f', cin: 'U72900OR2020PTC123456', accentColor: '#0A5FD1',
    addressLine1: 'A-11, Sector-67, Bhubaneswar, Odisha 751001', city: 'Bhubaneswar', state: 'Odisha',
    options: { offer: { salutation: 'Dear {{ employeeName }},' } },
  });
  ok('valid identity saves on v2', good.status === 200, good.body);
  ok('statutory ids stored upper-case', good.body?.profile?.gstin === '21ABCDE1234F1Z5' && good.body?.profile?.pan === 'ABCDE1234F', good.body?.profile);
  ok('brand name follows the saved legal name', good.body?.effective?.brandName === 'Company Admin Pvt Ltd', good.body?.effective?.brandName);
  ok('address printed once (no duplicated city/state/PIN)', good.body?.effective?.addressLine === 'A-11, Sector-67, Bhubaneswar, Odisha 751001', good.body?.effective?.addressLine);
  ok('joinAddress keeps distinct parts', joinAddress(['Plot 5', 'Saheed Nagar', 'Bhubaneswar Odisha', '751007']) === 'Plot 5, Saheed Nagar, Bhubaneswar Odisha, 751007');

  // A profile that was saved with the deployment's identity: renaming the legal
  // name now carries the brand with it.
  await query(`UPDATE document_profiles SET brand_name='TRUE HR PVT LTD' WHERE organisation_id=$1 AND company_id IS NULL`, [org.id]);
  const ren = await put(org.token, '/admin/branding', { legalName: 'Renamed Pvt Ltd', brandName: 'TRUE HR PVT LTD' });
  ok('a stale TRUE HR brand name follows a new legal name', ren.status === 200 && ren.body?.effective?.brandName === 'Renamed Pvt Ltd', ren.body?.effective?.brandName);
  const own = await put(org.token, '/admin/branding', { brandName: 'Acme' });
  ok('an explicit brand name is kept', own.body?.effective?.brandName === 'Acme', own.body?.effective?.brandName);

  section('branding: signature and letterhead (H102)');
  const photo = await put(org.token, '/admin/branding', { signatureImage: png(40, 40), signatoryName: 'Asha Rao' });
  ok('a photo-shaped signature is refused on v2', photo.status === 400 && !!photo.body?.fields?.signatureImage, photo.body);
  const sig = await put(org.token, '/admin/branding', { signatureImage: png(120, 30), signatoryName: 'Asha Rao', logo: png(400, 60) });
  ok('a wide signature scan and a wide logo are accepted', sig.status === 200, sig.body);
  for (const kind of ['letter', 'offer', 'payslip']) {
    const pdf = await call(org.token, 'GET', `/admin/branding/sample/${kind}`, undefined, { raw: true });
    ok(`sample ${kind} renders a PDF with the wide logo`, pdf.status === 200 && pdf.buf.slice(0, 4).toString() === '%PDF', pdf.status);
  }
  const { drawLogo } = await import('../../src/services/docPdf.js');
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument();
  const w = drawLogo(doc, Buffer.from(png(400, 60).split(',')[1], 'base64'), 0, 0, 120, 20);
  ok('drawLogo fits a wide logo inside its box (no overlap with the name)', w > 0 && w <= 120, w);
  doc.end();
  const sigOnly = await put(org.token, '/admin/branding', { signatureImage: '' });
  ok('signature can be removed (no stock image is substituted)', sigOnly.status === 200 && !sigOnly.body?.effective?.signatureImage);

  section('branding: tenancy');
  const seedCo = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [ctx.seedOrgId])).rows[0].id;
  const x = await get(org.token, `/admin/branding?companyId=${seedCo}`);
  ok('another org\'s company → 404', x.status === 404, x.status);
  const xs = await call(org.token, 'GET', `/admin/branding/sample/letter?companyId=${seedCo}`, undefined, { raw: true });
  ok('another org\'s company sample → 404', xs.status === 404, xs.status);
  const emp2 = await ctx.makeEmployee(org.id);
  const asEmp = await get(emp2.token, '/admin/branding');
  ok('an employee cannot read branding', asEmp.status === 403 || asEmp.status === 401, asEmp.status);

  section('branding: migration repairs profiles that saved the deployment identity');
  const org2 = await makeOrg(ctx.master);
  await query(
    `INSERT INTO document_profiles (organisation_id, legal_name, brand_name, address_line1, phone, website)
     VALUES ($1,'True HR Pvt Ltd','TRUE HR PVT LTD','A-11, Sector-67, Noida, U.P. 201301','+91-7370067005','www.truekindfoundation.org')`,
    [org2.id]);
  const { run } = await import('../../src/db/migrations_v2/50_org_branding.js');
  await run(pool); await run(pool);
  const fixed = (await query(`SELECT * FROM document_profiles WHERE organisation_id=$1 AND company_id IS NULL`, [org2.id])).rows[0];
  ok('legal name repaired to the org\'s own', fixed.legal_name === org2.name, fixed.legal_name);
  ok('brand / website cleared, phone = org contact', fixed.brand_name === null && fixed.website === null && fixed.phone === '9876543210', fixed);
  ok('Noida address cleared', !/noida/i.test(fixed.address_line1 || ''), fixed.address_line1);
  const home = (await query(`SELECT count(*)::int AS n FROM document_profiles WHERE organisation_id=$1`, [ctx.seedOrgId])).rows[0].n;
  ok('the deployment org is never touched by the repair', home >= 0);

  // ── H26: signatory name rule + optional company stamp ─────────────────────
  section('H26 signatory name and company stamp');
  const o26 = await makeOrg(ctx.master);
  let s26 = await put(o26.token, '/admin/branding', { signatoryName: 'A' });
  ok('v2: one-letter signatory name rejected', s26.status === 400 && /at least 2 letters/.test(s26.body?.fields?.signatoryName || ''), s26.body);
  s26 = await put(o26.token, '/admin/branding', { signatoryName: 'R2D2' });
  ok('v2: signatory name with digits rejected', s26.status === 400 && /letters only/.test(s26.body?.fields?.signatoryName || ''), s26.body);
  s26 = await put(o26.token, '/admin/branding', { stampImage: 'data:image/gif;base64,R0lGOD' });
  ok('stamp must be PNG/JPEG', s26.status === 400 && /Company stamp/.test(s26.body?.error || ''), s26.body);
  s26 = await put(o26.token, '/admin/branding', { signatoryName: 'Asha Rao', stampImage: png(80, 80) });
  ok('valid signatory + stamp saved', s26.status === 200 && !!(s26.body?.profile?.stampImage), s26.status);
  const pdf26 = await call(o26.token, 'GET', '/admin/branding/sample/letter', undefined, { raw: true });
  ok('sample letter with a stamp renders as PDF', pdf26.status === 200 && pdf26.buf.slice(0, 4).toString() === '%PDF', pdf26.status);
  const v1Sig = await put(o26.token, '/admin/branding', { signatoryName: 'A' }, { v: 1 });
  ok('v1 unchanged: short signatory name still accepted', v1Sig.status === 200, v1Sig.body);
}
