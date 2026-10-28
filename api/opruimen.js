// Dagelijkse taak (Vercel Cron):
// 1. Vangnet: betalingen die de webhook gemist heeft alsnog verwerken (levering).
// 2. Reviewverzoek 7 dagen na levering (als GOOGLE_REVIEW_URL is ingesteld en er een e-mailadres is).
// 3. Aangeleverde foto's 30 dagen na upload, en de film 90 dagen na levering, naar de prullenbak van Drive.
// De akkoordverklaring en het opdrachtenoverzicht blijven bewaard. Drive leegt de prullenbak zelf na 30 dagen.
import { ROOT_NAME, rootMap, FASES, DIASHOW, googleToken, drive, folder, fail, logVeilig, nu, nuIso, leesOpdrachten, lever, mollie, mail, mailHtml, isMail, filmMap, logOpdracht } from './_lib.js';
import { leads, volgende } from './partners.js';

const DAGEN = 30;

export default async function handler(req, res) {
  const geheim = process.env.CRON_SECRET;
  if (geheim ? req.headers.authorization !== `Bearer ${geheim}` : !String(req.headers['user-agent']).includes('vercel-cron')) {
    return fail(res, 401, 'Niet toegestaan');
  }
  const grens = new Date(Date.now() - DAGEN * 864e5).toISOString();
  const t = await googleToken();
  const root = await rootMap(t);
  const lijst = async (q) => (await drive(t, 'files?pageSize=1000&fields=files(id,name,createdTime)&q=' + encodeURIComponent(q))).files;
  const klanten = await lijst(`'${root}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const opgeruimd = [];
  for (const k of klanten) {
    const fases = await lijst(`'${k.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const oud = fases.filter((f) => (FASES.includes(f.name) || f.name === DIASHOW) && f.createdTime < grens);
    for (const f of oud) {
      await drive(t, `files/${f.id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
    }
    if (oud.length) {
      opgeruimd.push(k.name);
      await logVeilig(k.name, { Notities: `Foto's opgeruimd ${nu()}` });
    }
  }
  // --- Betalingen, reviews en films ---
  const dagenGeleden = (iso) => (Date.now() - Date.parse(String(iso).replace(' ', 'T') + ':00+02:00')) / 864e5;
  const gedaan = { geleverd: [], review: [], films: [] };
  for (const o of await leesOpdrachten(t)) {
    try {
      if (o.Betaallink && !o.Betaald && process.env.MOLLIE_API_KEY) {
        const pl = await mollie('payment-links/' + o.Betaallink);
        if (pl.paidAt) { await lever(t, o); gedaan.geleverd.push(o.Code); continue; }
      }
      if (o.Geleverd && !o['Review gevraagd'] && process.env.GOOGLE_REVIEW_URL && isMail(o.Contact) && dagenGeleden(o.Geleverd) >= 7) {
        const tekst = `Beste ${o.Naam || ''},

Een week geleden ontving u de fotofilm. Ik hoop dat hij heeft bijgedragen aan een mooi afscheid.

Zou u in een paar zinnen willen vertellen hoe u het samenwerken heeft ervaren? Dat helpt andere families die voor dezelfde keuze staan. Het kan hier:
${process.env.GOOGLE_REVIEW_URL}

Natuurlijk alleen als u daar ruimte voor heeft. Hoe dan ook: veel sterkte in deze periode.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
        await mail({ to: o.Contact.trim(), subject: 'Hoe heeft u het ervaren?', text: tekst, html: mailHtml(tekst) });
        await logOpdracht(t, o.Code, { 'Review gevraagd': nuIso() });
        gedaan.review.push(o.Code);
      }
      if (o.Geleverd && dagenGeleden(o.Geleverd) >= 90 && !/Film opgeruimd/.test(o.Notities)) {
        const map = await filmMap(t, o.Code);
        await drive(t, `files/${map}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
        await logOpdracht(t, o.Code, { Notities: `${o.Notities ? o.Notities + '; ' : ''}Film opgeruimd ${nu()}` });
        gedaan.films.push(o.Code);
      }
    } catch (e) { console.error('Dagtaak', o.Code, e); }
  }
  // --- Partnerfunnel: herinnering als er follow-ups klaarstaan ---
  try {
    const klaar = (await leads(t)).rijen.filter((l) => volgende(l) >= 2);
    if (klaar.length) {
      const tekst = `Er staan ${klaar.length} follow-up(s) aan uitvaartondernemers klaar:\n${klaar.map((l) => '- ' + l.Bedrijf + ' (mail ' + volgende(l) + ')').join('\n')}\n\nVersturen: https://uitvaart-portret.nl/beheer.html (tab Partners)`;
      await mail({ to: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl', subject: `${klaar.length} follow-up(s) klaar om te versturen`, text: tekst, html: mailHtml(tekst) });
      gedaan.followups = klaar.length;
    }
  } catch (e) { console.error('Partnerherinnering', e); }
  console.log('Opgeruimd:', opgeruimd, gedaan);
  res.json({ ok: true, opgeruimd, ...gedaan });
}
