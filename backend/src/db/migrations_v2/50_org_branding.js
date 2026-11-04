// Document branding (QA C29): the branding editor used to pre-fill a new
// organisation's profile with the DEPLOYMENT's identity (True HR Pvt Ltd,
// Noida address, phone, website), and saving it stored those values — so the
// tenant's offer letters and emails went out as another company.
//
// For every organisation except the deployment's own (the first one), a
// profile value that is exactly the deployment's default is replaced with the
// organisation's own detail (or cleared, so it inherits). Idempotent: a second
// run finds nothing equal to the deployment defaults.
import { config } from '../../config/index.js';

export async function run(pool) {
  const home = (await pool.query(`SELECT MIN(id) AS id FROM organisations`)).rows[0]?.id;
  if (!home) return;
  const name = [config.companyName, 'True HR Pvt Ltd', 'TRUE HR PVT LTD'];
  const addr = [config.companyAddress, 'A-11, Sector-67, Noida, U.P. 201301'];
  const phone = [config.supportPhone, '+91-7370067005'];
  const web = [config.companyWebsite, 'www.truekindfoundation.org'];
  const lower = (a) => [...new Set(a.filter(Boolean).map((x) => String(x).trim().toLowerCase()))];

  await pool.query(
    `UPDATE document_profiles p SET
        legal_name    = CASE WHEN lower(trim(p.legal_name))    = ANY($2) THEN COALESCE(NULLIF(o.legal_name,''), o.name) ELSE p.legal_name END,
        brand_name    = CASE WHEN lower(trim(p.brand_name))    = ANY($2) THEN NULL ELSE p.brand_name END,
        address_line1 = CASE WHEN lower(trim(p.address_line1)) = ANY($3) THEN o.address ELSE p.address_line1 END,
        phone         = CASE WHEN lower(trim(p.phone))         = ANY($4) THEN o.contact_phone ELSE p.phone END,
        website       = CASE WHEN lower(trim(p.website))       = ANY($5) THEN NULL ELSE p.website END,
        updated_at    = now()
       FROM organisations o
      WHERE o.id = p.organisation_id AND p.organisation_id <> $1
        AND (lower(trim(p.legal_name)) = ANY($2) OR lower(trim(p.brand_name)) = ANY($2)
          OR lower(trim(p.address_line1)) = ANY($3) OR lower(trim(p.phone)) = ANY($4)
          OR lower(trim(p.website)) = ANY($5))`,
    [home, lower(name), lower(addr), lower(phone), lower(web)]);
}
