// ============================================================================
// The organisation's own branding for people-area emails, PDFs and the public
// onboarding pages (QA C5, C6, C53, H28, H29, H45, E67).
//
// services/docProfile.js resolves a company's document profile, but where a
// tenant never filled one in it silently falls back to the deployment's env
// values — which on production are the original tenant's name, Noida address
// and website. That is how every new organisation's offer letter and welcome
// mail came out as someone else's. Here the fallback is the organisation's
// own record (organisations.legal_name / name / address / contact) instead.
// ============================================================================
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { resolveBrand } from './docProfile.js';

const same = (a, b) => a != null && b != null && String(a).trim() === String(b).trim();

// Values that are known to be the deployment fallback, never a tenant's.
const FALLBACK = {
  name: [config.companyName, 'True Kind Foundation', 'True HR Pvt Ltd'],
  address: [config.companyAddress, 'A-11, Sector-67, Noida, U.P. 201301'],
  website: [config.companyWebsite, 'www.truekindfoundation.org'],
  phone: [config.supportPhone, '+91-7370067005'],
};
const isFallback = (kind, v) => !v || FALLBACK[kind].some((f) => same(f, v));

// Tidy a value typed into a settings screen: literal "\n" sequences become a
// separator rather than leaking into an email as backslash-n (C53, E67).
export const tidy = (v) => (v == null ? '' : String(v).replace(/\\n|\r?\n/g, ', ').replace(/\s*,\s*(,\s*)+/g, ', ').replace(/\s{2,}/g, ' ').trim().replace(/^,\s*|,\s*$/g, ''));

/**
 * Brand for one organisation (and optionally one of its companies).
 * Returns the docProfile brand (for PDFs) with the deployment fallbacks
 * replaced by the organisation's own data, plus `.mail` for email templates.
 * Never throws.
 */
export async function orgBrand({ organisationId = null, companyId = null } = {}) {
  let org = null; let company = null;
  try {
    if (companyId) company = (await query(`SELECT id, organisation_id, name, legal_name, address FROM companies WHERE id=$1`, [companyId])).rows[0] || null;
    const oid = organisationId || company?.organisation_id || null;
    if (oid) org = (await query(`SELECT id, name, legal_name, address, contact_email, contact_phone FROM organisations WHERE id=$1`, [oid])).rows[0] || null;
  } catch { /* fall through with what we have */ }
  const brand = await resolveBrand({ companyId: company?.id || null, organisationId: org?.id || organisationId || null });
  const orgName = company?.legal_name || company?.name || org?.legal_name || org?.name || null;

  if (isFallback('name', brand.legalName) && orgName) brand.legalName = orgName;
  if (isFallback('name', brand.brandName) && orgName) brand.brandName = company?.name || org?.name || orgName;
  const orgAddress = tidy(company?.address || org?.address);
  if (isFallback('address', brand.addressLine1)) {
    brand.addressLine1 = orgAddress || null;
    brand.addressLine = [orgAddress, brand.addressLine2, [brand.city, brand.state].filter(Boolean).join(' '), brand.pincode]
      .filter(Boolean).join(', ');
  }
  if (isFallback('website', brand.website)) brand.website = null;
  if (isFallback('phone', brand.phone)) brand.phone = org?.contact_phone || null;
  if (!brand.email && org?.contact_email) brand.email = org.contact_email;
  brand.contactLine = [brand.website, brand.phone, brand.email].filter(Boolean).join(' · ');

  const name = brand.legalName || brand.brandName || orgName || 'TRUE HR';
  brand.mail = {
    company: tidy(brand.brandName || name),
    legalName: tidy(name),
    address: tidy(brand.addressLine),
    website: tidy(brand.website),
    support: tidy(brand.phone),
    email: tidy(brand.email),
    accent: /^#[0-9a-f]{6}$/i.test(brand.accentColor || '') ? brand.accentColor : '#059669',
  };
  return brand;
}

/** Same, starting from an employee id. */
export async function brandForEmployeeId(employeeId) {
  try {
    const r = (await query(`SELECT company_id, organisation_id FROM employees WHERE id=$1`, [employeeId])).rows[0];
    return await orgBrand({ organisationId: r?.organisation_id || null, companyId: r?.company_id || null });
  } catch { return orgBrand({}); }
}

/** The email-template brand only (what other areas pass to OTP mails etc.). */
export async function emailBrand({ organisationId = null, companyId = null, employeeId = null } = {}) {
  const b = employeeId ? await brandForEmployeeId(employeeId) : await orgBrand({ organisationId, companyId });
  return b.mail;
}

/** Active HR / Super Admin login emails of one organisation (HR notifications). */
export async function orgHrEmails(organisationId) {
  if (!organisationId) return [];
  try {
    const { rows } = await query(
      `SELECT DISTINCT lower(email) AS email FROM user_accounts
        WHERE organisation_id=$1 AND status='ACTIVE' AND role IN ('HR_ADMIN','SUPER_ADMIN')
          AND COALESCE(is_platform_admin,false) = false
        ORDER BY 1 LIMIT 20`, [organisationId]);
    return rows.map((r) => r.email);
  } catch { return []; }
}
