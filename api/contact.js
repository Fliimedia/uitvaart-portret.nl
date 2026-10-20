import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Uitvaart portret <info@uitvaart-portret.nl>';

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (b.website) return res.status(200).json({ ok: true }); // spamval

  const naam = clean(b.naam, 120);
  const contact = clean(b.contact, 200);
  const datum = clean(b.datum, 20);
  const bericht = clean(b.bericht, 5000);
  const pagina = clean(b.pagina, 200);
  if (!naam || !contact) return res.status(400).json({ ok: false, error: 'Vul uw naam en telefoon of e-mail in.' });

  const isMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  const rows = [
    ['Naam', naam],
    ['Telefoon of e-mail', contact],
    ['Datum uitvaart', datum || '–'],
    ['Bericht', bericht || '–'],
    ['Verstuurd vanaf', pagina || '–'],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html = `<table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${esc(v)}</td></tr>`)
    .join('')}</table>`;

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: process.env.CONTACT_EMAIL,
      subject: `Nieuwe aanvraag van ${naam}`,
      text,
      html,
      ...(isMail ? { replyTo: contact } : {}),
    });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Resend', e);
    return res.status(500).json({ ok: false });
  }
}
