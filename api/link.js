// Uploadlinks en de verzamellink.
// - Daan maakt een persoonlijke uploadlink (beveiligd met ADMIN_PASSWORD).
// - Verzamellink (zelf maken): aanvragen, status bekijken, afsluiten en betalen (€29), en de terugkoppeling van de omzetserver.
import crypto from 'crypto';
import { sign, check, fail, nu, nuIso, logVeilig, logOpdracht, isMail, mail, mailHtml, googleToken, drive, folder, rootMap,
  leesOpdrachten, deel, mollie, FASES, DIASHOW, DOWNLOAD_PRIJS, OMZET_URL } from './_lib.js';

const DAAN = () => process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl';
const SITE = 'https://www.uitvaart-portret.nl';
const kort = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const voornaam = (o) => String(o.Naam || '').replace(/ \(voor .*\)$/, '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = req.body || {};
  try {
    if (b.zelf || b.actie === 'zelf') return await zelfLink(req, res, b);
    if (b.actie === 'status') return await status(res, b);
    if (b.actie === 'afsluiten') return await afsluiten(res, b);
    if (b.actie === 'token') return await omzetToken(res, b);
    if (b.actie === 'omgezet') return await omgezet(res, b);
    return await linkHandler(req, res, b);
  } catch (e) {
    console.error('link', b.actie, e);
    return fail(res, 500, 'Er ging iets mis. Probeer het later opnieuw of mail info@uitvaart-portret.nl');
  }
}

const maakCode = (naam, prefix = '') => {
  const slug = String(naam || 'klant').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'klant';
  return prefix + slug + '-' + crypto.randomBytes(4).toString('hex');
};
const uploadLink = (code) => `${SITE}/upload.html?c=${encodeURIComponent(code)}&s=${sign(code)}`;
export const beheerLink = (code) => `${SITE}/verzamel.html?c=${encodeURIComponent(code)}&b=${sign('beheer:' + code)}`;

async function linkHandler(req, res, { wachtwoord, naam }) {
  const ok = typeof wachtwoord === 'string' && process.env.ADMIN_PASSWORD &&
    wachtwoord.length === process.env.ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(wachtwoord), Buffer.from(process.env.ADMIN_PASSWORD));
  if (!ok) return fail(res, 401, 'Onjuist wachtwoord');
  const code = maakCode(naam);
  const link = uploadLink(code);
  await logVeilig(code, { Naam: String(naam || ''), Aanvraag: nu() + ' (link handmatig)', Uploadlink: link });
  res.json({ code, link });
}

// ---- 1. Verzamellink aanvragen ----
async function zelfLink(req, res, b) {
  if (b.website) return res.json({ ok: true }); // honeypot: bots vullen dit veld in
  const naam = kort(b.naam, 80), email = kort(b.email, 120).toLowerCase(), datum = kort(b.datum, 40), voor = kort(b.voor, 80);
  if (!naam || !isMail(email)) return fail(res, 400, 'Vul uw naam en een geldig e-mailadres in');
  const code = maakCode(voor || naam, 'zelf-');
  const link = uploadLink(code), beheer = beheerLink(code);
  const tekst = `Beste ${naam},

Hier is uw verzamellink${voor ? ' voor de foto’s van ' + voor : ''}. Deel deze link met familie en vrienden:
${link}

Iedereen kan via die link foto’s en filmpjes toevoegen, vanaf elke telefoon of computer. Zet de foto’s in de periode waar ze bij horen, dan staat de volgorde al goed. Papieren foto’s fotografeert u met de telefoon. Voor de muziek is een titel genoeg.

Uw eigen beheerpagina (deel deze niet):
${beheer}
Daar ziet u wat er binnen is. Is iedereen klaar? Klik dan op 'Iedereen is klaar'. Voor €${DOWNLOAD_PRIJS} zetten wij alles om naar hetzelfde formaat: foto’s en filmpjes in breedbeeld (1920x1080), rechtgezet en op volgorde genummerd. Daarna krijgt u één downloadlink.

Toch liever dat ik de film voor u maak? Uw foto’s staan dan al klaar, en een betaalde download wordt verrekend. Antwoord gewoon op deze mail, of bel of app 06 18 42 48 58.

Na 30 dagen worden de foto’s automatisch verwijderd.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  try {
    await mail({ to: email, subject: 'Uw verzamellink', text: tekst, html: mailHtml(tekst), replyTo: DAAN() });
  } catch (e) {
    console.error('Verzamellink mail', e);
    return fail(res, 500, 'De mail kon niet verstuurd worden. Probeer het later opnieuw of mail info@uitvaart-portret.nl');
  }
  await logVeilig(code, { Naam: naam + (voor ? ' (voor ' + voor + ')' : ''), Contact: email, 'Datum uitvaart': datum,
    Aanvraag: nu() + ' (verzamellink)', Uploadlink: link, Pakket: 'Zelf maken' });
  try {
    const t = `Nieuwe verzamellink\n\nNaam: ${naam}\nVoor: ${voor || '-'}\nE-mail: ${email}\nDatum uitvaart: ${datum || '-'}\nCode: ${code}`;
    await mail({ to: DAAN(), subject: `Verzamellink aangevraagd: ${naam}`, text: t, html: mailHtml(t), replyTo: email });
  } catch (e) { console.error('Melding verzamellink', e); }
  res.json({ ok: true });
}

// ---- 2. Beheerpagina: wat is er binnen? ----
async function zoek(t, c) { return (await leesOpdrachten(t)).find((o) => o.Code === c) || null; }

async function mappen(t, c) {
  const klant = await folder(t, c, await rootMap(t));
  const fases = [];
  for (const naam of FASES) fases.push({ naam, id: await folder(t, naam, klant) });
  return { klant, fases, diashow: await folder(t, DIASHOW, klant) };
}

async function status(res, { c, b }) {
  if (!String(c).startsWith('zelf-') || !check('beheer:' + c, b)) return fail(res, 403, 'Deze beheerlink klopt niet');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o) return fail(res, 404, 'Deze verzamellink bestaat niet meer');
  const m = await mappen(t, c);
  const perFase = [];
  let muziekBestanden = 0;
  for (const f of m.fases) {
    const files = (await drive(t, 'files?pageSize=1000&fields=files(mimeType)&q=' + encodeURIComponent(`'${f.id}' in parents and trashed=false`))).files;
    const audio = files.filter((x) => x.mimeType.startsWith('audio/')).length;
    muziekBestanden += audio;
    perFase.push({ naam: f.naam.replace(/^\d+\s*/, ''), fotos: files.filter((x) => x.mimeType.startsWith('image/')).length,
      videos: files.filter((x) => x.mimeType.startsWith('video/')).length });
  }
  res.json({ naam: voornaam(o), datum: o['Datum uitvaart'] || '', uploadlink: o.Uploadlink || uploadLink(c), perFase,
    muziek: o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '', muziekBestanden, download: o.Download || '', prijs: DOWNLOAD_PRIJS });
}

// ---- 3. Afsluiten en betalen ----
async function afsluiten(res, { c, b, akkoord }) {
  if (!String(c).startsWith('zelf-') || !check('beheer:' + c, b)) return fail(res, 403, 'Deze beheerlink klopt niet');
  if (!akkoord) return fail(res, 400, 'Vink eerst het akkoord aan');
  if (!process.env.MOLLIE_API_KEY) return fail(res, 500, 'Betalen is even niet mogelijk. Mail info@uitvaart-portret.nl');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o) return fail(res, 404, 'Deze verzamellink bestaat niet meer');
  if (/^(Betaald|Omzetten|Geleverd)/.test(o.Download || '')) return res.json({ status: o.Download });
  const terug = beheerLink(c) + '&terug=1';
  const p = await mollie('payments', { method: 'POST', body: JSON.stringify({
    amount: { currency: 'EUR', value: DOWNLOAD_PRIJS.toFixed(2) },
    description: `Download foto's ${voornaam(o)} [${c}]`.slice(0, 255),
    redirectUrl: terug, webhookUrl: SITE + '/api/mollie', metadata: { code: c, soort: 'download' },
  }) });
  const wanneer = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'long', timeStyle: 'short' });
  await logOpdracht(t, c, { Download: 'Betaling gestart ' + nu() + ' (' + p.id + ')',
    'Akkoord voorwaarden': `ja, ${wanneer} (download verzamellink; herroepingsrecht vervalt bij levering)`, Bedrag: `€${DOWNLOAD_PRIJS}` });
  res.json({ checkout: p._links.checkout.href });
}

// Na betaling (vanuit de Mollie-webhook) of als vangnet (dagelijkse taak): de omzetserver aan het werk zetten.
export async function startOmzetten(t, o) {
  const c = o.Code;
  if (!OMZET_URL) {
    await logOpdracht(t, c, { Download: 'Betaald ' + nu() + ' – omzetserver nog niet ingesteld' });
    await mail({ to: DAAN(), subject: `Download betaald, maar omzetserver ontbreekt: ${c}`, text: `Zet de foto's van ${c} handmatig klaar, of stel de omzetserver in.`,
      html: mailHtml(`Zet de foto's van ${c} handmatig klaar, of stel de omzetserver in.`) });
    return false;
  }
  const m = await mappen(t, c);
  const exp = Date.now() + 12 * 3600e3;
  const job = `${c}.${exp}.${sign('omzet:' + c + ':' + exp)}`;
  await logOpdracht(t, c, { Download: 'Omzetten ' + nuIso() });
  const r = await fetch(OMZET_URL.replace(/\/$/, '') + '/omzetten', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ job, code: c, ...m, terug: SITE + '/api/link' }),
  });
  if (!r.ok) throw new Error('Omzetserver ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return true;
}

function checkJob(job) {
  const [c, exp, sig] = String(job || '').split('.');
  if (!c || !(+exp > Date.now()) || !check('omzet:' + c + ':' + exp, sig)) return '';
  return c;
}

// De omzetserver haalt hiermee een kortlevende Google-toegang op (alleen met een geldige, verlopende opdracht).
async function omzetToken(res, { job }) {
  if (!checkJob(job)) return fail(res, 403, 'Ongeldige opdracht');
  res.json({ token: await googleToken() });
}

// De omzetserver is klaar: map delen en de downloadlink mailen.
async function omgezet(res, { job, aantal, fouten }) {
  const c = checkJob(job);
  if (!c) return fail(res, 403, 'Ongeldige opdracht');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o) return fail(res, 404, 'Onbekend');
  if (/^Geleverd/.test(o.Download || '')) return res.json({ ok: true });
  const m = await mappen(t, c);
  const link = await deel(t, m.klant, true);
  const n = Math.max(0, parseInt(aantal, 10) || 0), mis = (Array.isArray(fouten) ? fouten : []).slice(0, 20).map((x) => kort(x, 150));
  const tekst = `Beste ${voornaam(o)},

Dank u wel. Alles staat klaar om te downloaden:
${link}

Klik rechtsboven op 'Alles downloaden'; Google maakt er een zip van.

In de map 'Klaar voor diashow' staan ${n} foto’s en filmpjes in breedbeeld (1920x1080), rechtgezet en op volgorde genummerd: eerst de portretfoto, dan de periodes van het leven, daarna de hobbyfoto’s en de foto’s waarvan de familie twijfelde. Sleep ze in één keer in uw programma, zoals PowerPoint of Photostage. De muziek staat in dezelfde map. De originelen staan per periode in de andere mappen.${mis.length ? `\n\nDeze bestanden konden we niet omzetten (de originelen staan er wel):\n${mis.join('\n')}` : ''}

Download alles op tijd: na 30 dagen worden de bestanden automatisch verwijderd.

Merkt u toch dat het maken u te veel wordt, of wilt u net iets meer dan een diashow? Dan maak ik de film. De €${DOWNLOAD_PRIJS} van de download gaat eraf. Antwoord op deze mail, of bel of app 06 18 42 48 58.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  if (isMail(o.Contact)) await mail({ to: o.Contact.trim(), subject: 'Uw foto’s staan klaar om te downloaden', text: tekst, html: mailHtml(tekst), replyTo: DAAN() });
  await logOpdracht(t, c, { Download: 'Geleverd ' + nu() + ` (${n} bestanden${mis.length ? ', ' + mis.length + ' niet omgezet' : ''})`,
    'Drive-map': 'https://drive.google.com/drive/folders/' + m.klant });
  try {
    const d = `Download geleverd: ${c}\n${n} bestanden omgezet${mis.length ? '\nNiet omgezet:\n' + mis.join('\n') : ''}\n\nMap: https://drive.google.com/drive/folders/${m.klant}`;
    await mail({ to: DAAN(), subject: `Download geleverd: ${c}`, text: d, html: mailHtml(d) });
  } catch (e) { console.error('Melding download', e); }
  res.json({ ok: true });
}
