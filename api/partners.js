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
  1: { onderwerp: 'Fotofilms voor jullie families: de eerste is op mijn kosten', tekst: `{aanhef}

Ik ben Daan Lubbers, televisiemaker uit Amsterdam. Naast mijn werk voor tv maak ik fotofilms voor uitvaarten, onder de naam uitvaart-portret.nl. Ik kwam jullie website tegen en wilde me graag even voorstellen.

Ik merk dat veel families het maken van een fotopresentatie zwaar vinden, juist in die drukke dagen. Daar help ik graag bij: de familie zet de foto's en muziek via een persoonlijke link klaar, en ik maak er een rustige, verzorgde film van die gewoon afspeelt op de locatie. Twee voorbeelden: https://uitvaart-portret.nl/voorbeelden.html

Lijkt het je wat? Dan maak ik de eerste film voor een van jullie families kosteloos, zodat je zonder risico kunt zien of het past. Daarna werk ik met een vast partnertarief van €179 excl. btw per film, op één factuur per maand. Wat je de familie rekent, bepaal je zelf. Meer uitleg: https://uitvaart-portret.nl/fotofilm-uitvaartverzorger.html

Zal ik je een persoonlijke link sturen, zodat je hem bij de eerstvolgende familie meteen kunt gebruiken? Een kort "ja" is genoeg. Bellen of appen mag ook: 06 18 42 48 58.

Hartelijke groet,
Daan Lubbers` },
  2: { onderwerp: 'Nog even: fotofilms voor jullie families', tekst: `{aanhef}

Ik weet hoe druk jullie het hebben, dus geen enkele haast. Ik wilde alleen even checken of mijn vorige berichtje goed is aangekomen.

Werken jullie al met een systeem waarin families zelf een presentatie maken? Dan ben ik er voor de keren dat het niet lukt en jullie team het anders zelf moet doen. Ik lever een mp4 die zo in elk systeem past.

Het aanbod staat nog: de eerste film voor een van jullie families maak ik kosteloos. Zal ik je een link sturen? Kennismaken bij een kop koffie of even bellen kan natuurlijk ook.

Hartelijke groet,
Daan Lubbers
06 18 42 48 58` },
  3: { onderwerp: 'Laatste berichtje van mij', tekst: `{aanhef}

Ik wil je niet blijven mailen, dus dit is mijn laatste berichtje.

Vraagt een familie ooit naar een fotofilm of fotopresentatie, dan ben je altijd welkom om me te bellen: 06 18 42 48 58. Ook als het snel moet, en de eerste film blijft kosteloos.

Dank voor het lezen, en veel goeds gewenst.
Daan Lubbers` },
};

const UITLEG = `FUNNEL UITVAARTONDERNEMERS

Pas de teksten hieronder gerust aan; beheer.html (tab Partners) leest ze uit dit document. Laat de regels met === MAIL en Onderwerp: staan.
Je kunt deze woorden gebruiken: {aanhef} (wordt "Hoi Babette," of "Hoi,"), {voornaam}, {bedrijf}, {plaats}. Je adres en de afmeldlink komen er automatisch onder.

Volgorde: mail 1, dan mail 2 na 4 dagen, dan mail 3 na 7 dagen, alleen zolang de Status in de leadlijst leeg is. Zet de Status op Gereageerd, Partner, Geen interesse of Bellen om de reeks te stoppen.

Aanbod: eerste film kosteloos. Daarna €179 excl. btw (Klassiek) of €219 excl. btw (Modern), één factuur per maand. Spoed onder 24 uur +€99. Strippenkaart pas later, voor partners met 3+ films.
Zegt iemand ja: maak via link.html een uploadlink met de naam van de familie. Eerste film: geen betaallink sturen, zet in Notities "Partner [bedrijf] – gratis kennismaking".
`;

// Maakt het Doc met de standaardteksten aan (de site mag alleen bestanden lezen die hij zelf heeft gemaakt).
async function maakDoc(t) {
  const tekst = UITLEG + [1, 2, 3].map((n) => `\n=== MAIL ${n} ===\nOnderwerp: ${STANDAARD[n].onderwerp}\n${STANDAARD[n].tekst}\n`).join('');
  const map = await folder(t, SALES_MAP);
  const grens = 'grens' + crypto.randomBytes(6).toString('hex');
  const body = `--${grens}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DOC, mimeType: 'application/vnd.google-apps.document', parents: [map] })}\r\n--${grens}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${tekst}\r\n--${grens}--`;
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'multipart/related; boundary=' + grens }, body });
  if (!r.ok) console.error('Doc aanmaken', r.status, await r.text());
}

// Leest de teksten uit het Google Doc. Opbouw: per mail een regel "=== MAIL 1 ===", dan "Onderwerp: …", dan de tekst.
async function teksten(t) {
  const id = await zoek(t, DOC, 'application/vnd.google-apps.document');
  if (!id) { await maakDoc(t); return { bron: 'standaardteksten (Doc is nu aangemaakt in Drive)', mails: STANDAARD }; }
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
    if (b.actie === 'test') {
      const naar = process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl';
      const { Resend } = await import('resend');
      const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: 'Daan Lubbers <info@uitvaart-portret.nl>', to: naar, replyTo: 'info@uitvaart-portret.nl',
        subject: '[TEST] ' + String(b.onderwerp || '').slice(0, 200), text: String(b.tekst || '').slice(0, 8000) + voet(naar),
      });
      if (error) throw new Error('Resend: ' + JSON.stringify(error));
      return res.json({ ok: true, naar });
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
