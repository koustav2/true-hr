'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { fmtDate } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Button, Field, Select, Textarea, Modal, Spinner, Empty, ErrorSummary, useConfirm,
} from '@/components/ui.jsx';

const occasionLabel = (w) => (w.occasion === 'ANNIVERSARY'
  ? `Work anniversary · ${w.years} year${w.years === 1 ? '' : 's'}` : 'Birthday');
const whenLabel = (w) => (w.inDays === 0 ? 'Today' : w.inDays === 1 ? 'Tomorrow' : `in ${w.inDays} days`);

export default function WishesPage() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState('30');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sendFor, setSendFor] = useState(null);
  const [sendMsg, setSendMsg] = useState('');
  const [sendErr, setSendErr] = useState({});
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [setErrs, setSetErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();

  const load = () => api.get(`/admin/wishes?days=${days}`).then((r) => setData(r.wishes || [])).catch((e) => { setErr(e.message); setData([]); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);
  useEffect(() => { api.get('/admin/wishes/settings').then((s) => { setSettings(s); setSaved(s); }).catch(() => {}); }, []);

  function openSend(w) {
    setSendFor(w); setSendErr({});
    setSendMsg(settings ? (w.occasion === 'BIRTHDAY' ? saved.birthdayMessage : saved.anniversaryMessage) : '');
  }
  async function send() {
    const v = validator();
    v.text('message', sendMsg, 'Message', { required: true, max: 1000 });
    setSendErr(v.fields);
    if (!v.ok) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/wishes/send', { employeeId: sendFor.employeeId, occasion: sendFor.occasion, message: sendMsg.trim() });
      setMsg(`Wishes sent to ${sendFor.name}${r.emailed ? ' (app notification and email)' : ' (app notification)'}.`);
      setSendFor(null); load();
    } catch (e) { setSendErr(e.fields || { _: e.message }); } finally { setBusy(false); }
  }

  const dirty = settings && saved && JSON.stringify(settings) !== JSON.stringify(saved);
  async function saveSettings() {
    const v = validator();
    v.number('sendHour', settings.sendHour, 'Send hour', { required: true, min: 0, max: 23, integer: true });
    v.text('birthdayMessage', settings.birthdayMessage, 'Birthday message', { required: true, max: 1000 });
    v.text('anniversaryMessage', settings.anniversaryMessage, 'Anniversary message', { required: true, max: 1000 });
    setSetErrs(v.fields);
    if (!v.ok) return;
    if ((settings.autoBirthday || settings.autoAnniversary) && !(saved.autoBirthday || saved.autoAnniversary)) {
      if (!(await confirm({ title: 'Turn on automatic greetings?', body: 'Employees will get a greeting by app notification and email on their birthday / work anniversary every year.', confirmLabel: 'Turn on' }))) return;
    }
    setBusy(true);
    try { const s = await api.put('/admin/wishes/settings', settings); setSettings(s); setSaved(s); setMsg('Greeting settings saved.'); setSetErrs({}); }
    catch (e) { setSetErrs(e.fields || { _: e.message }); } finally { setBusy(false); }
  }
  const setS = (k, val) => { setSettings((s) => ({ ...s, [k]: val })); setSetErrs((e) => ({ ...e, [k]: undefined })); };

  return (
    <div className="space-y-5">
      {confirmUi}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-ink">Wishes &amp; Reminders</h1>
          <p className="text-ink-faint text-sm mt-0.5">Upcoming birthdays and work anniversaries (from the first completed year). Send greetings, or switch on automatic ones below.</p>
        </div>
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-40">
          {['7', '15', '30', '60', '90'].map((d) => <option key={d} value={d}>Next {d} days</option>)}
        </Select>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}

      <Card className="overflow-x-auto">
        {data === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : data.length === 0 ? <Empty title="Nothing coming up" subtitle="No birthdays or work anniversaries in this window." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['When', 'Occasion', 'Employee', 'Date', 'Email', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((w) => (
                <tr key={`${w.employeeId}-${w.occasion}`} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${w.inDays === 0 ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-soft'}`}>{whenLabel(w)}</span></td>
                  <td className="px-4 py-3">{occasionLabel(w)}</td>
                  <td className="px-4 py-3">{w.name} <span className="text-ink-faint">({w.code})</span></td>
                  <td className="px-4 py-3 text-ink-faint">{fmtDate(w.date)}</td>
                  <td className="px-4 py-3 text-ink-faint">{w.email || '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {w.inDays !== 0 ? <span className="text-xs text-ink-faint">On the day</span>
                      : w.sentToday ? <span className="text-xs text-brand-700">✓ Sent today</span>
                      : <button onClick={() => openSend(w)} className="text-brand-700 font-medium">Send wishes</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {settings && (
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Automatic greetings</h2>
            <p className="text-ink-faint text-sm">Sent once on the day, by app notification{settings.sendEmail ? ' and email' : ''}, after the hour you choose (IST). Placeholders: {'{name}'}, {'{years}'}, {'{company}'}.</p>
          </div>
          <ErrorSummary errors={setErrs} />
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.autoBirthday} onChange={(e) => setS('autoBirthday', e.target.checked)} /> Birthdays</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.autoAnniversary} onChange={(e) => setS('autoAnniversary', e.target.checked)} /> Work anniversaries</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.sendEmail} onChange={(e) => setS('sendEmail', e.target.checked)} /> Also email</label>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Send from (IST)" error={setErrs.sendHour}>
              <Select value={settings.sendHour} onChange={(e) => setS('sendHour', Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Birthday message" required error={setErrs.birthdayMessage}><Textarea rows={3} maxLength={1000} value={settings.birthdayMessage} onChange={(e) => setS('birthdayMessage', e.target.value)} /></Field>
            <Field label="Anniversary message" required error={setErrs.anniversaryMessage}><Textarea rows={3} maxLength={1000} value={settings.anniversaryMessage} onChange={(e) => setS('anniversaryMessage', e.target.value)} /></Field>
          </div>
          <div className="flex gap-2 justify-end">
            {dirty && <Button variant="ghost" onClick={() => { setSettings(saved); setSetErrs({}); }}>Discard</Button>}
            <Button onClick={saveSettings} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save settings'}</Button>
          </div>
        </Card>
      )}

      <Modal open={!!sendFor} onClose={() => setSendFor(null)} title={sendFor ? `Send wishes to ${sendFor.name}` : ''}
        actions={<><Button variant="ghost" onClick={() => setSendFor(null)}>Cancel</Button><Button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button></>}>
        <div className="space-y-3">
          <ErrorSummary errors={sendErr} />
          <p className="text-sm">{sendFor && occasionLabel(sendFor)} — sent as an app notification and an email.</p>
          <Field label="Message" required error={sendErr.message} hint="{name}, {years} and {company} are filled in when it is sent"><Textarea rows={4} maxLength={1000} value={sendMsg} onChange={(e) => { setSendMsg(e.target.value); setSendErr({}); }} /></Field>
        </div>
      </Modal>
    </div>
  );
}
