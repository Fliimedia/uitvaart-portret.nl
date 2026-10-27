// Partnerfunnel uitvaartondernemers: leads uit de Sheet in de Sales-map, mails uit het Google Doc ernaast.
// Daan verstuurt elke mail zelf met een knop in beheer.html. Beveiligd met ADMIN_PASSWORD.
import crypto from 'crypto';
import { fail, googleToken, drive, folder, sign, isMail, nuIso } from './_lib.js';

export const SALES_MAP = '2 Sales – uitvaartondernemers';
export const LEADS = 'Leads uitvaartondernemers';
const DOC = 'Funnel – mails aan uitvaartondernemers';
export const KOP = ['Bedrijf', 'Contactpersoon', 'Plaats', 'E-mail', 'Telefoon', 'Website', 'Bron', 'Status', 'Mail 1', 'Mail 2', 'Mail 3', 'Notities'];
export const WACHT = { 2: 4, 3: 7 }; // dagen na de vorige mail
export const KLAAR = /gereageerd|geen interesse|afgemeld|partner|bellen|niet mailen/i;

const ok = (pw) => typeof pw === 'string' && process.env.ADMIN_PASSWORD && pw.length === process.env.ADMIN_PASSWORD.length &&
  crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(process.env.ADMIN_PASSWORD));

async function sheets(t, path, opts = {}) {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('Sheets ' + r.status + ': ' + (await r.text()));
  return r.json();
}

async function zoek(t, naam, mime) {
  const q = `name='${naam.replace(/'/g, "\\'")}' and mimeType='${mime}' and trashed=false`;
  return (await drive(t, 'files?fields=files(id)&q=' + encodeURIComponent(q))).files[0]?.id || null;
}

// Leadlijst openen (of aanmaken in de Sales-map). Geeft id, bladnaam en rijen als objecten met rijnummer.
export async function leads(t) {
  let id = await zoek(t, LEADS, 'application/vnd.google-apps.spreadsheet');
  if (!id) {
    const map = await folder(t, SALES_MAP);
    id = (await drive(t, 'files?fields=id', { method: 'POST', body: JSON.stringify({
      name: LEADS, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [map] }) })).id;
  }
  const blad = (await sheets(t, `${id}?fields=sheets.properties.title`)).sheets[0].properties.title;
  const v = (await sheets(t, `${id}/values/${encodeURIComponent(`'${blad}'!A:Z`)}`)).values || [];
  if (!v.length) {
    await sheets(t, `${id}/values/${encodeURIComponent(`'${blad}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [KOP] }) });
    v.push(KOP);
  }
  const kop = v[0];
  const rijen = v.slice(1).map((r, i) => ({ rij: i + 2, ...Object.fromEntries(kop.map((k, j) => [k, r[j] || ''])) }));
  return { id, blad, kop, rijen };
}

export async function zet(t, L, rij, velden) {
  const data = Object.entries(velden).map(([k, waarde]) => {
    const j = L.kop.indexOf(k);
    if (j < 0) throw new Error('Kolom ontbreekt in de leadlijst: ' + k);
    return { range: `'${L.blad}'!${String.fromCharCode(65 + j)}${rij}`, values: [[waarde]] };
  });
  await sheets(t, `${L.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
}

// ---- Mailteksten ----
const STANDAARD = {
  1: { onderwerp: 'Fotofilm voor de families van {bedrijf}: de eerste maak ik gratis', tekst: `{aanhef}

Ik ben Daan Lubbers, televisiemaker uit Amsterdam. Naast mijn tv-werk maak ik fotofilms voor uitvaarten, via uitvaart-portret.nl.

Ik zie vaak dat families het maken van een fotopresentatie onderschatten: tot laat foto's zoeken en scannen, een PowerPoint die op de locatie niet afspeelt, muziek die er net niet onder past. Dat neem ik graag uit handen, en daarmee heb jij ook een zorg minder.

Zo werkt het: de familie (of jij) krijgt een persoonlijke link, zet daar de foto's en de muziek in, en ik maak er een rustige, verzorgde film van in het formaat dat de locatie nodig heeft. Zijn de foto's er minstens 24 uur voor de dienst, dan staat de film op tijd klaar. Twee voorbeelden: https://uitvaart-portret.nl/voorbeelden.html

Om kennis te maken maak ik de eerste film voor {bedrijf} kosteloos. Daarna betaal je als partner €179 excl. btw per film (€219 met filmpjes erin), op één factuur per maand. Wat je de familie rekent, bepaal je zelf.

Zal ik je een link sturen voor de eerstvolgende familie? Bellen of appen kan ook: 06 18 42 48 58.

Hartelijke groet,
Daan Lubbers` },
  2: { onderwerp: 'Re: Fotofilm voor de families van {bedrijf}', tekst: `{aanhef}

Ik stuurde je vorige week een mail over fotofilms voor uitvaarten. In jouw vak schiet zoiets er makkelijk bij in, dus ik stuur het nog één keer kort.

Het aanbod staat: de eerste film maak ik gratis, zodat je zonder risico kunt zien of het bij jouw families past. Een kort antwoord is genoeg, ook als het "nee, dank je" is.

Hartelijke groet,
Daan Lubbers
06 18 42 48 58` },
  3: { onderwerp: 'Laatste berichtje: fotofilm {bedrijf}', tekst: `{aanhef}

Dit is mijn laatste mail hierover, beloofd.

Mocht een familie ooit vragen om een fotopresentatie of film, en je hebt er zelf geen tijd voor: bewaar dan gerust mijn nummer, 06 18 42 48 58. Ook op korte termijn denk ik graag mee, en de eerste film blijft op mijn kosten.

Hartelijke groet,
Daan Lubbers` },
};

// Leest de teksten uit het Google Doc. Opbouw: per mail een regel "=== MAIL 1 ===", dan "Onderwerp: …", dan de tekst.
async function teksten(t) {
  const id = await zoek(t, DOC, 'application/vnd.google-apps.document');
  if (!id) return { bron: 'standaardteksten (Doc niet gevonden)', mails: STANDAARD };
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`, { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) return { bron: 'standaardteksten (Doc niet leesbaar)', mails: STANDAARD };
  const doc = (await r.text()).replace(/^﻿/, '').replace(/\r/g, '').replace(/[ \t ]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  const mails = {};
  for (const deel of doc.split(/^=+\s*MAIL\s+/mi).slice(1)) {
    const n = parseInt(deel, 10);
    const regels = deel.split('\n').slice(1);
    const o = regels.findIndex((l) => /^\s*Onderwerp:/i.test(l));
    if (!(n >= 1 && n <= 3) || o < 0) continue;
    const tekst = regels.slice(o + 1).join('\n').replace(/^=+.*$/gm, '').trim();
    if (tekst) mails[n] = { onderwerp: regels[o].replace(/^\s*Onderwerp:\s*/i, '').trim(), tekst };
  }
  return [1, 2, 3].every((n) => mails[n]) ? { bron: 'Google Doc', mails } : { bron: 'standaardteksten (Doc onvolledig)', mails: STANDAARD };
}

const dagen = (iso) => (Date.now() - Date.parse(String(iso).replace(' ', 'T') + ':00+01:00')) / 864e5;

// Welke mail is nu aan de beurt voor deze lead? 0 = geen.
export function volgende(l) {
  if (KLAAR.test(l.Status) || !isMail(l['E-mail'])) return 0;
  if (!l['Mail 1']) return 1;
  if (!l['Mail 2']) return dagen(l['Mail 1']) >= WACHT[2] ? 2 : 0;
  if (!l['Mail 3']) return dagen(l['Mail 2']) >= WACHT[3] ? 3 : 0;
  return 0;
}

function vul(s, l) {
  const voornaam = String(l.Contactpersoon || '').trim().split(/\s+/)[0];
  return s.replace(/\{aanhef\}/g, voornaam ? `Hoi ${voornaam},` : 'Hoi,')
    .replace(/\{voornaam\}/g, voornaam).replace(/\{bedrijf\}/g, l.Bedrijf || 'jullie').replace(/\{plaats\}/g, l.Plaats || '');
}

export const afmeldLink = (mail) => `https://uitvaart-portret.nl/api/afmelden?e=${encodeURIComponent(mail)}&s=${sign('afmeld:' + mail.toLowerCase())}`;
const voet = (mail) => `\n\n--\nuitvaart-portret.nl · Goosebump Media · Land van Cocagneplein 28, 1093 NB Amsterdam\nGeen berichten meer van mij ontvangen? Antwoord met "stop" of klik: ${afmeldLink(mail)}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = req.body || {};
  if (!ok(b.wachtwoord)) return fail(res, 401, 'Onjuist wachtwoord');
  try {
    const t = await googleToken();
    const L = await leads(t);
    if (b.actie === 'lijst') {
      const { bron, mails } = await teksten(t);
      const lijst = L.rijen.filter((l) => l.Bedrijf || l['E-mail']).map((l) => {
        const n = volgende(l);
        return { ...l, stap: n, onderwerp: n ? vul(mails[n].onderwerp, l) : '', tekst: n ? vul(mails[n].tekst, l) : '' };
      });
      return res.json({ lijst, bron, sheet: `https://docs.google.com/spreadsheets/d/${L.id}/edit` });
    }
    const l = L.rijen.find((x) => x.rij === +b.rij);
    if (!l) return fail(res, 404, 'Lead niet gevonden');
    if (b.actie === 'status') {
      await zet(t, L, l.rij, { Status: String(b.status || '').slice(0, 40) });
      return res.json({ ok: true });
    }
    if (b.actie === 'verstuur') {
      const n = volgende(l);
      if (!n || n !== +b.stap) return fail(res, 409, 'Deze mail is niet (meer) aan de beurt. Ververs de lijst.');
      const naar = l['E-mail'].trim();
      const onderwerp = String(b.onderwerp || '').slice(0, 200);
      const tekst = String(b.tekst || '').slice(0, 8000);
      if (!onderwerp || !tekst) return fail(res, 400, 'Onderwerp en tekst zijn verplicht');
      const { Resend } = await import('resend');
      const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: 'Daan Lubbers <info@uitvaart-portret.nl>', to: naar, replyTo: 'info@uitvaart-portret.nl',
        subject: onderwerp, text: tekst + voet(naar),
        headers: { 'List-Unsubscribe': `<${afmeldLink(naar)}>, <mailto:info@uitvaart-portret.nl?subject=stop>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      if (error) throw new Error('Resend: ' + JSON.stringify(error));
      await zet(t, L, l.rij, { ['Mail ' + n]: nuIso() });
      return res.json({ ok: true, verstuurd: nuIso() });
    }
    return fail(res, 400, 'Onbekende actie');
  } catch (e) {
    console.error('Partners', e);
    return fail(res, 500, String(e.message || e).slice(0, 300));
  }
}
