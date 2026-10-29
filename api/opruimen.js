// Dagelijkse taak (Vercel Cron):
// 1. Vangnet: betalingen die de webhook gemist heeft alsnog verwerken (levering).
// 2. Reviewverzoek 7 dagen na levering (als GOOGLE_REVIEW_URL is ingesteld en er een e-mailadres is).
// 3. Aangeleverde foto's 30 dagen na upload, en de film 90 dagen na levering, naar de prullenbak van Drive.
// De akkoordverklaring en het opdrachtenoverzicht blijven bewaard. Drive leegt de prullenbak zelf na 30 dagen.
import { ROOT_NAME, rootMap, FASES, DIASHOW, googleToken, drive, folder, fail, logVeilig, nu, nuIso, leesOpdrachten, lever, mollie, mail, mailHtml, isMail, filmMap, logOpdracht } from './_lib.js';
import { leads, volgende } from './partners.js';
import { startOmzetten, beheerLink } from './link.js';

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
    // ook extra films ('Film 2 – …') en de zips voor de downloadpagina ('Downloads')
    const oud = fases.filter((f) => (FASES.includes(f.name) || f.name === DIASHOW || f.name === 'Downloads' || /^Film \d+ – /.test(f.name)) && f.createdTime < grens);
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
      // Verzamellink: vangnet voor de omzetserver, en een herinnering de dag voor de uitvaart.
      if (String(o.Code).startsWith('zelf-')) {
        const d = o.Download || '';
        const vast = /^Omzetten \d{4}-/.test(d) && dagenGeleden(d.slice(9, 25)) > 0.125;
        if ((/^Betaald/.test(d) && !/ontbreekt/.test(d)) || vast) {
          if (vast) await mail({ to: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl', subject: `${o.Partner ? '🤝 Partner ' + o.Partner : '📂 Verzamellink'} · Omzetten lijkt vast te zitten: ${o.Code}`,
            text: `De download van ${o.Code} is betaald maar nog niet geleverd. Ik probeer het opnieuw; kijk anders in Google Cloud Run.`, html: mailHtml(`De download van ${o.Code} is betaald maar nog niet geleverd. Ik probeer het opnieuw; kijk anders in Google Cloud Run.`) });
          await startOmzetten(t, o); gedaan.omzet = (gedaan.omzet || 0) + 1;
        }
        // Twee dagen na de aanvraag nog niets binnen: de aanvrager eraan herinneren de link te delen (één keer).
        const aanv = /^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(o.Aanvraag || '');
        const oud = aanv ? (Date.now() - Date.UTC(+aanv[3], +aanv[2] - 1, +aanv[1])) / 864e5 : 0;
        if (!d && aanv && oud >= 2 && oud < 10 && !o['Upload ontvangen'] && isMail(o.Contact) && !/Herinnering delen/.test(o.Notities || '')) {
          const tekst = `${o.Partner ? 'Hallo,' : 'Beste ' + String(o.Naam || '').replace(/ \(voor .*\)$/, '') + ','}

Er zijn via de verzamellink${o.Partner ? ' van ' + o.Naam : ''} nog geen foto’s binnengekomen. Dat kan natuurlijk kloppen, er komt veel op je af.

Het helpt om de link één keer in de familie-app te zetten: iedereen kan dan vanaf de eigen telefoon foto’s toevoegen, ook papieren foto’s (die fotografeer je met de telefoon). Deel de link vanaf uw beheerpagina:
${beheerLink(o.Code)}

Lukt het niet, of heeft u vragen? Bel of app 06 18 42 48 58.

Hartelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
          await mail({ to: o.Contact.trim(), subject: 'Nog geen foto’s binnen via de verzamellink', text: tekst, html: mailHtml(tekst) });
          await logOpdracht(t, o.Code, { Notities: `${o.Notities ? o.Notities + '; ' : ''}Herinnering delen ${nu()}` });
          o.Notities = `${o.Notities ? o.Notities + '; ' : ''}Herinnering delen ${nu()}`;
        }
        const morgen = new Date(Date.now() + 864e5).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 10);
        if (!d && o['Datum uitvaart'] === morgen && isMail(o.Contact) && !/Herinnering afronden/.test(o.Notities || '')) {
          const tekst = `${o.Partner ? 'Hallo,' : 'Beste ' + String(o.Naam || '').replace(/ \(voor .*\)$/, '') + ','}

Morgen is de uitvaart${o.Partner ? ' van ' + o.Naam : ''}. Is iedereen klaar met het aanleveren van de foto’s? Dan kunt u het verzamelen afronden op uw beheerpagina:
${beheerLink(o.Code)}

Daarna zetten wij alles om naar hetzelfde formaat, op volgorde genummerd, en krijgt u één downloadlink.

Wordt het toch te veel? Bel of app 06 18 42 48 58, dan kijk ik of ik de film nog voor u kan maken.

Veel sterkte,
Daan Lubbers
uitvaart-portret.nl`;
          await mail({ to: o.Contact.trim(), subject: 'Morgen de uitvaart: is iedereen klaar met de foto’s?', text: tekst, html: mailHtml(tekst) });
          await logOpdracht(t, o.Code, { Notities: `${o.Notities ? o.Notities + '; ' : ''}Herinnering afronden ${nu()}` });
        }
      }
    } catch (e) { console.error('Dagtaak', o.Code, e); }
  }
  // --- Partnerfunnel: herinnering als er follow-ups klaarstaan ---
  try {
    const klaar = (await leads(t)).rijen.filter((l) => volgende(l) >= 2);
    if (klaar.length) {
      const tekst = `Er staan ${klaar.length} follow-up(s) aan uitvaartondernemers klaar:\n${klaar.map((l) => '- ' + l.Bedrijf + ' (mail ' + volgende(l) + ')').join('\n')}\n\nVersturen: https://uitvaart-portret.nl/beheer.html (tab Partners)`;
      await mail({ to: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl', subject: `📣 Sales funnel · ${klaar.length} follow-up(s) klaar om te versturen`, text: tekst, html: mailHtml(tekst) });
      gedaan.followups = klaar.length;
    }
  } catch (e) { console.error('Partnerherinnering', e); }
  console.log('Opgeruimd:', opgeruimd, gedaan);
  res.json({ ok: true, opgeruimd, ...gedaan });
}
