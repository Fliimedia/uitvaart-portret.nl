// Uploadlinks maken.
// 1. Daan maakt een persoonlijke uploadlink (beveiligd met ADMIN_PASSWORD).
// 2. Iedereen kan een gratis verzamellink aanvragen ({ zelf: true }); de link gaat alleen per mail naar het opgegeven adres.
import crypto from 'crypto';
import { sign, fail, nu, logVeilig, isMail, mail, mailHtml } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = req.body || {};
  return b.zelf ? zelfLink(req, res, b) : linkHandler(req, res, b);
}

const maakCode = (naam, prefix = '') => {
  const slug = String(naam || 'klant').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'klant';
  return prefix + slug + '-' + crypto.randomBytes(4).toString('hex');
};
const linkVoor = (req, code) => `https://${req.headers.host}/upload.html?c=${encodeURIComponent(code)}&s=${sign(code)}`;

const linkHandler = async (req, res, { wachtwoord, naam }) => {
  const ok = typeof wachtwoord === 'string' && process.env.ADMIN_PASSWORD &&
    wachtwoord.length === process.env.ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(wachtwoord), Buffer.from(process.env.ADMIN_PASSWORD));
  if (!ok) return fail(res, 401, 'Onjuist wachtwoord');
  const code = maakCode(naam);
  const link = linkVoor(req, code);
  await logVeilig(code, { Naam: String(naam || ''), Aanvraag: nu() + ' (link handmatig)', Uploadlink: link });
  res.json({ code, link });
};

// Gratis verzamellink voor wie de film zelf maakt.
async function zelfLink(req, res, b) {
  if (b.website) return res.json({ ok: true }); // honeypot: bots vullen dit veld in
  const kort = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
  const naam = kort(b.naam, 80), email = kort(b.email, 120).toLowerCase(), datum = kort(b.datum, 40), voor = kort(b.voor, 80);
  if (!naam || !isMail(email)) return fail(res, 400, 'Vul uw naam en een geldig e-mailadres in');
  const code = maakCode(voor || naam, 'zelf-');
  const link = linkVoor(req, code);
  const tekst = `Beste ${naam},

Hier is uw gratis verzamellink${voor ? ' voor de foto’s van ' + voor : ''}:
${link}

Zo werkt het:
- Deel de link met familie en vrienden. Iedereen kan foto’s en filmpjes toevoegen, vanaf elke telefoon of computer.
- Zet de foto’s in de periode waar ze bij horen. Zo staat de volgorde al goed.
- Papieren foto’s? Fotografeer ze met de telefoon, bij daglicht en recht van boven.
- Vul de muziek in: een titel is genoeg, of voeg het bestand toe.

Na elke upload ontvangt u een mail met een link om alles in één keer te downloaden, genummerd en op volgorde. Na 30 dagen worden de foto’s automatisch verwijderd.

Toch liever dat ik de film voor u maak? Uw foto’s staan dan al klaar. Antwoord gewoon op deze mail, of bel of app 06 18 42 48 58.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  try {
    await mail({ to: email, subject: 'Uw gratis verzamellink', text: tekst, html: mailHtml(tekst), replyTo: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl' });
  } catch (e) {
    console.error('Verzamellink mail', e);
    return fail(res, 500, 'De mail kon niet verstuurd worden. Probeer het later opnieuw of mail info@uitvaart-portret.nl');
  }
  await logVeilig(code, { Naam: naam + (voor ? ' (voor ' + voor + ')' : ''), Contact: email, 'Datum uitvaart': datum,
    Aanvraag: nu() + ' (gratis verzamellink)', Uploadlink: link, Pakket: 'Zelf maken' });
  try {
    const t = `Nieuwe gratis verzamellink\n\nNaam: ${naam}\nVoor: ${voor || '-'}\nE-mail: ${email}\nDatum uitvaart: ${datum || '-'}\nCode: ${code}`;
    await mail({ to: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl', subject: `Verzamellink aangevraagd: ${naam}`, text: t, html: mailHtml(t), replyTo: email });
  } catch (e) { console.error('Melding verzamellink', e); }
  res.json({ ok: true });
}
