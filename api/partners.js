// Partnerfunnel uitvaartondernemers: leads uit de Sheet in de Sales-map, mails uit het Google Doc ernaast.
// Daan verstuurt elke mail zelf met een knop in beheer.html. Beveiligd met ADMIN_PASSWORD.
import crypto from 'crypto';
import { fail, googleToken, drive, folder, sign, isMail, nuIso } from './_lib.js';

export const SALES_MAP = '2 Sales – uitvaartondernemers';
export const LEADS = 'Leads uitvaartondernemers';
const DOC = 'Funnel – mails aan uitvaartondernemers';
export const KOP = ['Bedrijf', 'Contactpersoon', 'Plaats', 'E-mail', 'Telefoon', 'Website', 'Bron', 'Status', 'Mail 1', 'Mail 2', 'Mail 3', 'Notities'];
export const WACHT = { 2: 4, 3: 7 }; // dagen na de vorige mail
export const VL_BLAD = 'Vlaanderen'; // tab met Vlaamse leads; die krijgen de VL-mails
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
// Zonder naam: het eerste tabblad (Nederland). Met naam (bijv. VL_BLAD): dat tabblad, of null als het niet bestaat.
export async function leads(t, naam) {
  let id = await zoek(t, LEADS, 'application/vnd.google-apps.spreadsheet');
  if (!id) {
    const map = await folder(t, SALES_MAP);
    id = (await drive(t, 'files?fields=id', { method: 'POST', body: JSON.stringify({
      name: LEADS, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [map] }) })).id;
  }
  const titels = (await sheets(t, `${id}?fields=sheets.properties.title`)).sheets.map((x) => x.properties.title);
  if (naam && !titels.includes(naam)) return null;
  const blad = naam || titels[0];
  const v = (await sheets(t, `${id}/values/${encodeURIComponent(`'${blad}'!A:Z`)}`)).values || [];
  if (!v.length) {
    await sheets(t, `${id}/values/${encodeURIComponent(`'${blad}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [KOP] }) });
    v.push(KOP);
  }
  const kop = v[0];
  const rijen = v.slice(1).map((r, i) => ({ rij: i + 2, ...Object.fromEntries(kop.map((k, j) => [k, r[j] || ''])) }));
  return { id, blad, kop, rijen };
}

// Alle leadlijsten: Nederland en (als het tabblad bestaat) Vlaanderen. Elke rij krijgt land 'NL' of 'VL'.
export async function alleLeads(t) {
  const nl = await leads(t);
  const vl = await leads(t, VL_BLAD);
  nl.rijen.forEach((l) => { l.land = 'NL'; });
  if (vl) vl.rijen.forEach((l) => { l.land = 'VL'; });
  return vl ? [nl, vl] : [nl];
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

Ik ben Daan Lubbers, televisiemaker uit Amsterdam: van crimeprogramma's voor het productiehuis van John van den Heuvel tot Renze en Shownieuws. Naast mijn werk voor tv maak ik fotofilms voor uitvaarten, onder de naam uitvaart-portret.nl. Ik kwam jullie website tegen en wilde me graag even voorstellen.

Veel families willen graag een fotopresentatie bij het afscheid, maar het lukt ze niet altijd: te weinig tijd, alleen papieren foto's, of foto's verspreid over de hele familie. Dan komt het vaak bij jullie terecht. Dat werk neem ik graag over. De familie zet de foto's en muziek via een persoonlijke link klaar, en ik maak er een rustig gemonteerde film van.

Werken jullie met een systeem zoals een online ceremonie? Dan lever ik een mp4 die je daar zo in zet. In de film staat geen logo van mij; jullie blijven het aanspreekpunt voor de familie. Twee voorbeelden: https://uitvaart-portret.nl/voorbeelden.html

Lijkt het je wat? Dan maak ik de eerste film voor een van jullie families kosteloos, zodat je zonder risico kunt zien of het past. Daarna werk ik met een vast partnertarief van €179 excl. btw per film, op één factuur per maand. Wat je de familie rekent, bepaal je zelf. Meer uitleg: https://uitvaart-portret.nl/fotofilm-uitvaartverzorger.html

Zal ik je een persoonlijke link sturen, zodat je hem bij de eerstvolgende familie meteen kunt gebruiken? Bellen of appen mag ook: 06 18 42 48 58.

Hartelijke groet,
Daan Lubbers` },
  2: { onderwerp: 'Nog even: fotofilms voor jullie families', tekst: `{aanhef}

Ik weet hoe druk jullie het hebben, dus geen enkele haast. Ik wilde alleen even checken of mijn vorige berichtje goed is aangekomen.

Werken jullie al met een systeem waarin families zelf een presentatie maken? Dan ben ik er voor de keren dat het niet lukt en jullie team het anders zelf moet doen. Ik lever een mp4 die zo in elk systeem past.

Het aanbod staat nog: de eerste film voor een van jullie families maak ik kosteloos. Zal ik je een link sturen? Kennismaken bij een kop koffie of even bellen kan natuurlijk ook.

Hartelijke groet,
Daan Lubbers
06 18 42 48 58` },
  3: { onderwerp: 'Voor de families die iets meer willen dan een diashow', tekst: `{aanhef}

Dit is mijn laatste berichtje, beloofd.

Van collega's van jullie hoor ik dat een gewone diashow prima lukt: foto's op muziek, klaar. Daar heb je mij ook niet voor nodig.

Maar soms wil een familie iets meer. Oude filmpjes en telefoonvideo's tussen de foto's, een film met een verhaal en opbouw, gemonteerd op de muziek. Dat is precies mijn vak als televisiemaker. De familie stuurt alles vanaf de telefoon via een persoonlijke link; voor de muziek is een titel genoeg. Ik lever een mp4 op tijd voor de deadline van de locatie, zodat jullie hem zelf in het systeem van de locatie zetten. Jullie blijven het aanspreekpunt.

Komt zo'n familie langs? Bel of app me gerust: 06 18 42 48 58. De eerste film blijft kosteloos.

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

// Leest de teksten uit het Google Doc. Opbouw: per mail een kopregel, dan "Onderwerp: …", dan de tekst.
// Kopregels: "=== MAIL 1 ===" (Nederland), "=== MAIL 2 EERDER ===" (oudere NL-reeks), "=== VL MAIL 1 ===" (Vlaanderen).
async function teksten(t) {
  const id = await zoek(t, DOC, 'application/vnd.google-apps.document');
  if (!id) { await maakDoc(t); return { bron: 'standaardteksten (Doc is nu aangemaakt in Drive)', mails: STANDAARD }; }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`, { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) return { bron: 'standaardteksten (Doc niet leesbaar)', mails: STANDAARD };
  const doc = (await r.text()).replace(/^\uFEFF/, '').replace(/\r/g, '').replace(/[ \t\u00A0]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  const koppen = [...doc.matchAll(/^=+\s*(VL\s+)?MAIL\s+(\d+)(\s+EERDER)?[^\n]*$/gmi)];
  const mails = {};
  koppen.forEach((k, i) => {
    const n = +k[2];
    const deel = doc.slice(k.index + k[0].length, i + 1 < koppen.length ? koppen[i + 1].index : doc.length);
    const regels = deel.split('\n');
    const o = regels.findIndex((l) => /^\s*Onderwerp:/i.test(l));
    if (!(n >= 1 && n <= 3) || o < 0) return;
    const tekst = regels.slice(o + 1).join('\n').trim();
    const sleutel = k[1] ? 'vl' + n : k[3] ? n + 'e' : String(n);
    if (tekst) mails[sleutel] = { onderwerp: regels[o].replace(/^\s*Onderwerp:\s*/i, '').trim(), tekst };
  });
  return [1, 2, 3].every((n) => mails[n]) ? { bron: 'Google Doc', mails } : { bron: 'standaardteksten (Doc onvolledig)', mails: STANDAARD };
}

// Welke tekst hoort bij deze lead en stap? Vlaanderen: VL MAIL n; oudere NL-reeks: MAIL n EERDER; anders MAIL n.
export const sleutel = (l, n) => l.land === 'VL' ? 'vl' + n : eerder(l) && n > 1 ? n + 'e' : String(n);

const dagen = (iso) => (Date.now() - Date.parse(String(iso).replace(' ', 'T') + ':00+01:00')) / 864e5;

// Leads die hun eerste mail vóór 29-10-2026 kregen (andere eerste mail) volgen een eigen reeks: MAIL 2 EERDER, MAIL 3 EERDER.
export const EERDER_VOOR = '2026-10-29';
export const eerder = (l) => !!l['Mail 1'] && String(l['Mail 1']) < EERDER_VOOR;
// Welke mail is nu aan de beurt voor deze lead? 0 = geen.
export function volgende(l) {
  if (KLAAR.test(l.Status) || !isMail(l['E-mail'])) return 0;
  if (!l['Mail 1']) return 1;
  if (!l['Mail 2']) return dagen(l['Mail 1']) >= (eerder(l) ? 0 : WACHT[2]) ? 2 : 0; // eerdere reeks: mail 2 direct aan de beurt
  if (!l['Mail 3']) return dagen(l['Mail 2']) >= WACHT[3] ? 3 : 0;
  return 0;
}

function vul(s, l) {
  const contact = String(l.Contactpersoon || '').trim();
  const voornaam = contact.split(/\s+/)[0];
  const aanhef = l.land === 'VL' ? (contact ? `Beste ${contact},` : 'Beste,') : (voornaam ? `Hoi ${voornaam},` : 'Hoi,');
  return s.replace(/\{aanhef\}/g, aanhef)
    .replace(/\{voornaam\}/g, voornaam).replace(/\{bedrijf\}/g, l.Bedrijf || 'jullie').replace(/\{plaats\}/g, l.Plaats || '');
}

export const afmeldLink = (mail) => `https://uitvaart-portret.nl/api/afmelden?e=${encodeURIComponent(mail)}&s=${sign('afmeld:' + mail.toLowerCase())}`;
const voet = (mail) => `\n\n--\nuitvaart-portret.nl · Goosebump Media · Land van Cocagneplein 28, 1093 NB Amsterdam\nGeen berichten meer van mij ontvangen? Antwoord met "stop" of klik: ${afmeldLink(mail)}`;

// Beelden in een mail: een regel [beeld: bestand.jpg | bijschrift] wordt een plaatje uit assets/mail/ (alleen in de HTML-versie; de tekstversie laat de regel weg).
const BEELD = /^\[beeld:\s*([\w.-]+)\s*(?:\|\s*(.*?))?\s*\]$/;
export const platte = (tekst) => tekst.split('\n').filter((r) => !BEELD.test(r.trim())).join('\n').replace(/\n{3,}/g, '\n\n');
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const link = (x) => esc(x).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#4B5A48">${u}</a>`);
export function htmlVan(tekst, mail) {
  const blokken = tekst.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const m = BEELD.exec(b);
    if (m) return `<p style="margin:18px 0"><img src="https://uitvaart-portret.nl/assets/mail/${m[1]}" alt="${esc(m[2] || '')}" width="520" style="max-width:100%;height:auto;border:1px solid #E2D9CC;border-radius:10px;display:block">${m[2] ? `<span style="font-size:13px;color:#6A6F6B">${esc(m[2])}</span>` : ''}</p>`;
    return `<p style="margin:0 0 14px">${link(b).replace(/\n/g, '<br>')}</p>`;
  }).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#222;max-width:560px">${blokken}<p style="margin:26px 0 0;font-size:12px;color:#6A6F6B">uitvaart-portret.nl · Goosebump Media · Land van Cocagneplein 28, 1093 NB Amsterdam<br>Geen berichten meer van mij ontvangen? Antwoord met "stop" of <a href="${afmeldLink(mail)}" style="color:#6A6F6B">meld je af</a>.</p></div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = req.body || {};
  if (!ok(b.wachtwoord)) return fail(res, 401, 'Onjuist wachtwoord');
  try {
    const t = await googleToken();
    const lijsten = await alleLeads(t);
    if (b.actie === 'lijst') {
      const { bron, mails } = await teksten(t);
      const lijst = lijsten.flatMap((L) => L.rijen).filter((l) => l.Bedrijf || l['E-mail']).map((l) => {
        let n = volgende(l);
        const m = n && mails[sleutel(l, n)];
        if (!m) n = 0; // geen tekst voor deze reeks: niets aanbieden
        return { ...l, stap: n, onderwerp: n ? vul(m.onderwerp, l) : '', tekst: n ? vul(m.tekst, l) : '' };
      });
      return res.json({ lijst, bron, sheet: `https://docs.google.com/spreadsheets/d/${lijsten[0].id}/edit` });
    }
    const L = lijsten[b.land === 'VL' ? 1 : 0];
    if (!L) return fail(res, 404, 'Tabblad Vlaanderen niet gevonden');
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
        subject: '[TEST] ' + String(b.onderwerp || '').slice(0, 200), text: platte(String(b.tekst || '').slice(0, 8000)) + voet(naar), html: htmlVan(String(b.tekst || '').slice(0, 8000), naar),
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
        subject: onderwerp, text: platte(tekst) + voet(naar), html: htmlVan(tekst, naar),
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
