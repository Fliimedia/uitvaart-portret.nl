import { Resend } from 'resend';
import crypto from 'crypto';
import { sign, nu, logVeilig } from './_lib.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Uitvaart portret <info@uitvaart-portret.nl>';

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Maakt een persoonlijke uploadlink voor deze aanvraag (zelfde opbouw als api/link.js).
function uploadLink(naam) {
  const slug = String(naam || 'klant').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'klant';
  const code = slug + '-' + crypto.randomBytes(4).toString('hex');
  return { code, link: `https://uitvaart-portret.nl/upload.html?c=${encodeURIComponent(code)}&s=${sign(code)}` };
}

// Kant-en-klaar antwoord voor Daan; hij leest het na en verstuurt het zelf.
export function antwoord(naam, datum, link) {
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const dagen = datum ? Math.round((Date.parse(datum) - Date.parse(vandaag)) / 864e5) : null;
  const wanneer = datum && !Number.isNaN(dagen)
    ? ` op ${new Date(datum + 'T12:00:00Z').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
    : '';
  const spoed = dagen !== null && dagen <= 1
    ? '\nOmdat de uitvaart al snel is: ontvangen we de foto’s minstens 24 uur voor de dienst, dan is er geen meerprijs. Bij minder dan 24 uur komt er een spoedtoeslag van €99 bij.\n'
    : '';
  return `Beste ${naam},

Hartelijk dank voor uw bericht, en gecondoleerd met uw verlies.

Graag maak ik de fotofilm voor de uitvaart${wanneer}. De kosten zijn €249 voor een film met alleen foto’s (Klassiek) of €299 met ook filmpjes (Modern), inclusief btw. Daarin zitten 60 foto’s en één correctieronde.
${spoed}
Via deze persoonlijke link kunt u de foto’s aanleveren:
${link}

U deelt de foto’s in vier periodes in en geeft aan welke er zeker in moeten; de volgorde regel ik. Bij het versturen vraagt de pagina u akkoord te geven op mijn voorwaarden, zodat ik direct kan beginnen.

U ontvangt eerst een concept om te bekijken. Pas als u tevreden bent, ontvangt u de betaallink.

Heeft u vragen? Bel of app me gerust op 06 18 42 48 58.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
}

// 06-nummer naar internationaal formaat voor een WhatsApp-link.
function waNummer(contact) {
  let d = String(contact).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '31' + d.slice(1);
  return /^\d{10,15}$/.test(d) ? d : '';
}

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
  const { code, link } = uploadLink(naam);
  await logVeilig(code, { Naam: naam, Contact: contact, 'Datum uitvaart': datum, Aanvraag: nu(), Uploadlink: link });
  const reply = antwoord(naam, /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datum : '', link);
  const wa = isMail ? '' : waNummer(contact);
  const knop = (href, label) => `<a href="${href}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:20px;background:#4B5A48;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:15px">${label}</a>`;
  const verstuurLink = `https://www.uitvaart-portret.nl/api/antwoord?c=${encodeURIComponent(code)}&s=${sign('antwoord:' + code)}`;
  let auto = false;
  if (isMail && process.env.AUTO_ANTWOORD === '1') {
    try {
      await resend.emails.send({ from: 'Daan Lubbers <info@uitvaart-portret.nl>', to: contact, replyTo: 'info@uitvaart-portret.nl',
        subject: 'Uw fotofilm – uitvaart-portret.nl', text: reply });
      await logVeilig(code, { 'Antwoord verstuurd': nu() + ' (automatisch)', 'Antwoord aangepast': 'nee' });
      auto = true;
    } catch (e) { console.error('Automatisch antwoord', e); }
  }
  const knoppen = (isMail && !auto ? knop(verstuurLink, 'Bekijk en verstuur antwoord') : '') + (isMail ? knop(`mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent('Uw fotofilm – uitvaart-portret.nl')}&body=${encodeURIComponent(reply)}`, 'Zelf mailen') : '')
    + (wa ? knop(`https://wa.me/${wa}?text=${encodeURIComponent(reply)}`, 'Antwoord via WhatsApp') : '');
  const rows = [
    ['Naam', naam],
    ['Telefoon of e-mail', contact],
    ['Datum uitvaart', datum || '–'],
    ['Bericht', bericht || '–'],
    ['Verstuurd vanaf', pagina || '–'],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nUploadlink: ${link}\n\n--- Voorstel voor je antwoord ---\n${reply}`;
  const html = `<table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${esc(v)}</td></tr>`)
    .join('')}</table>`
    + `<p style="font-family:Arial,sans-serif;font-size:15px;margin:20px 0 8px"><strong>Uploadlink voor deze klant:</strong><br><a href="${link}">${esc(link)}</a></p>`
    + (knoppen ? `<p style="margin:12px 0">${knoppen}</p>` : '')
    + (auto ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#2F3D2C"><strong>✓ Dit antwoord is automatisch verstuurd.</strong></p>` : '')
    + `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;margin:16px 0 4px">Voorstel voor je antwoord (lees na, pas aan waar nodig):</p>`
    + `<pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap;background:#F3EEE6;padding:14px;border-radius:10px">${esc(reply)}</pre>`;

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl',
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
