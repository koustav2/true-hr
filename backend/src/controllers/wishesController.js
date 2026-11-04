// Wishes — upcoming birthdays and work anniversaries, sending greetings, and
// the organisation's automatic-greeting settings.
//
// A work anniversary counts from the first COMPLETED year: the joining date
// itself is not an anniversary (it used to show "Work anniversary · 0 yr" on
// the day someone joined). "Today" is the date in India, not the server's UTC.
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { activeEmployeeSql } from '../utils/people.js';
import { validator } from '../utils/validate.js';
import {
  istToday, sendWish, renderWish, DEFAULT_WISH_MESSAGES,
} from '../services/notificationScheduler.js';

const isoOf = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Next occurrence (on or after today) of a yyyy-mm-dd anniversary, all in UTC date arithmetic. */
function nextOccurrence(iso, todayIso) {
  if (!iso) return null;
  const [oy, om, od] = iso.split('-').map(Number);
  const [ty] = todayIso.split('-').map(Number);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  let year = ty;
  let next = Date.UTC(year, om - 1, od);
  if (next < today) { year += 1; next = Date.UTC(year, om - 1, od); }
  return { date: new Date(next).toISOString().slice(0, 10), inDays: Math.round((next - today) / 86400000), year, origYear: oy };
}

export async function upcoming(req, res) {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const rows = (await query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.dob, e.date_of_joining, e.official_email
       FROM employees e
      WHERE ${activeEmployeeSql('e')} AND ($1::bigint IS NULL OR e.organisation_id=$1)`,
    [req.orgId || null])).rows;
  const today = istToday();
  const sent = new Set((await query(
    `SELECT employee_id, occasion FROM wishes_sent
      WHERE sent_on=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [today, req.orgId || null])).rows
    .map((r) => `${r.employee_id}:${r.occasion}`));
  const out = [];
  for (const e of rows) {
    const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
    const base = { employeeId: Number(e.id), name, code: e.employee_code, email: e.official_email };
    const b = nextOccurrence(isoOf(e.dob), today);
    if (b && b.inDays <= days) {
      out.push({ ...base, type: 'Birthday', occasion: 'BIRTHDAY', inDays: b.inDays, date: b.date,
        sentToday: sent.has(`${e.id}:BIRTHDAY`) });
    }
    const a = nextOccurrence(isoOf(e.date_of_joining), today);
    // Only from the first completed year: joining day itself (0 years) is not one.
    if (a && a.inDays <= days && a.year - a.origYear >= 1) {
      out.push({ ...base, type: 'Work anniversary', occasion: 'ANNIVERSARY', inDays: a.inDays, date: a.date,
        years: a.year - a.origYear, sentToday: sent.has(`${e.id}:ANNIVERSARY`) });
    }
  }
  out.sort((x, y) => x.inDays - y.inDays || x.name.localeCompare(y.name));
  res.json({ days, wishes: out });
}

async function settingsRow(orgId) {
  const r = (await query(`SELECT * FROM wishes_settings WHERE organisation_id=$1`, [orgId])).rows[0];
  return {
    autoBirthday: !!r?.auto_birthday,
    autoAnniversary: !!r?.auto_anniversary,
    sendHour: r?.send_hour ?? 9,
    sendEmail: r ? r.send_email : true,
    birthdayMessage: r?.birthday_message || DEFAULT_WISH_MESSAGES.BIRTHDAY,
    anniversaryMessage: r?.anniversary_message || DEFAULT_WISH_MESSAGES.ANNIVERSARY,
    placeholders: ['{name}', '{years}', '{company}'],
  };
}

// GET /admin/wishes/settings  (v2)
export async function getSettings(req, res) {
  if (!req.orgId) return res.status(400).json({ error: 'No organisation in scope.' });
  res.json(await settingsRow(req.orgId));
}

const PLACEHOLDER = /\{([a-z]+)\}/gi;
const KNOWN = new Set(['name', 'years', 'company', 's']);
function badPlaceholders(text) {
  return [...String(text || '').matchAll(PLACEHOLDER)].map((m) => m[1]).filter((p) => !KNOWN.has(p.toLowerCase()));
}

// PUT /admin/wishes/settings  (v2)
export async function putSettings(req, res) {
  if (!req.orgId) return res.status(400).json({ error: 'No organisation in scope.' });
  const b = req.body || {};
  const v = validator();
  v.number('sendHour', b.sendHour, 'Send hour', { required: true, min: 0, max: 23, integer: true });
  v.text('birthdayMessage', b.birthdayMessage, 'Birthday message', { required: true, max: 1000 });
  v.text('anniversaryMessage', b.anniversaryMessage, 'Anniversary message', { required: true, max: 1000 });
  for (const k of ['birthdayMessage', 'anniversaryMessage']) {
    const bad = badPlaceholders(b[k]);
    if (bad.length) v.add(k, `Unknown placeholder {${bad[0]}} — use {name}, {years} or {company}`);
  }
  v.throwIfAny();
  await query(
    `INSERT INTO wishes_settings (organisation_id, auto_birthday, auto_anniversary, send_hour, send_email,
       birthday_message, anniversary_message, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (organisation_id) DO UPDATE SET auto_birthday=EXCLUDED.auto_birthday,
       auto_anniversary=EXCLUDED.auto_anniversary, send_hour=EXCLUDED.send_hour, send_email=EXCLUDED.send_email,
       birthday_message=EXCLUDED.birthday_message, anniversary_message=EXCLUDED.anniversary_message,
       updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [req.orgId, !!b.autoBirthday, !!b.autoAnniversary, Number(b.sendHour), b.sendEmail !== false,
     String(b.birthdayMessage).trim(), String(b.anniversaryMessage).trim(), req.user.id]);
  await audit(req.user.id, 'WISHES_SETTINGS', 'organisation', req.orgId, { autoBirthday: !!b.autoBirthday, autoAnniversary: !!b.autoAnniversary });
  res.json(await settingsRow(req.orgId));
}

// POST /admin/wishes/send { employeeId, occasion: BIRTHDAY|ANNIVERSARY, message? }  (v2)
export async function send(req, res) {
  const b = req.body || {};
  const v = validator();
  const occasion = String(b.occasion || '').toUpperCase();
  if (!['BIRTHDAY', 'ANNIVERSARY'].includes(occasion)) v.add('occasion', 'Choose the occasion: Birthday or Work anniversary');
  if (b.message != null && String(b.message).trim() !== '') v.text('message', b.message, 'Message', { max: 1000 });
  const empId = parseInt(b.employeeId, 10);
  if (!Number.isFinite(empId)) v.add('employeeId', 'Choose the employee');
  v.throwIfAny();

  const e = (await query(
    `SELECT e.id, e.first_name, e.last_name, e.official_email, e.personal_email, e.date_of_joining,
            COALESCE(NULLIF(o.legal_name,''), o.name) AS org_name, e.organisation_id
       FROM employees e LEFT JOIN organisations o ON o.id=e.organisation_id
      WHERE e.id=$1 AND ${activeEmployeeSql('e')}
        AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [empId, req.orgId || null, req.companyScope || null])).rows[0];
  if (!e) return res.status(404).json({ error: 'Employee not found.' });

  const doj = isoOf(e.date_of_joining);
  const years = doj ? Number(istToday().slice(0, 4)) - Number(doj.slice(0, 4)) : null;
  if (occasion === 'ANNIVERSARY' && !(years >= 1)) {
    return res.status(400).json({ error: 'This employee has not completed a year yet.', fields: { occasion: 'No completed year to celebrate yet' } });
  }
  const settings = await settingsRow(e.organisation_id);
  const tpl = String(b.message || '').trim()
    || (occasion === 'BIRTHDAY' ? settings.birthdayMessage : settings.anniversaryMessage);
  const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
  const message = renderWish(tpl, { name, years, company: e.org_name });
  const ok = await sendWish({
    orgId: e.organisation_id, employee: e, occasion, years: occasion === 'ANNIVERSARY' ? years : null,
    message, sentBy: req.user.id, sendEmail: settings.sendEmail,
  });
  if (!ok) return res.status(409).json({ error: `Wishes were already sent to ${name} today.` });
  await audit(req.user.id, 'WISHES_SENT', 'employee', e.id, { occasion });
  res.status(201).json({ ok: true, message, emailed: !!(settings.sendEmail && (e.official_email || e.personal_email)) });
}
