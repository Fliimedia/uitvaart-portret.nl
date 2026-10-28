// Gedeelde helpers voor de uploadfuncties. Bestanden met _ worden door Vercel niet als functie gepubliceerd.
import crypto from 'crypto';

// De klantmap heette eerst 'Uitvaart-portret uploads'. We zoeken eerst op de nieuwe naam, dan op de oude.
const ROOT_NAME = "1 Klanten – foto's en films";
const ROOT_OUD = 'Uitvaart-portret uploads';
const DIASHOW = 'Klaar voor diashow'; // alleen bij de gratis verzamellink (zelf-…)
const FASES = ['1 Jeugd', '2 Jong volwassen', '3 Gezin en werk', '4 Later', '6 Hobby en typisch', '9 Weet ik niet']; // volgorde = vakken op upload.html

function sign(value) {
  return crypto.createHmac('sha256', process.env.UPLOAD_SECRET).update(value).digest('hex').slice(0, 24);
}

function check(value, sig) {
  // Volledig (24) of verkort (minimaal 12 tekens, voor korte links zoals /z/… en /b/…).
  if (typeof value !== 'string' || typeof sig !== 'string' || sig.length < 12 || sig.length > 24) return false;
  return crypto.timingSafeEqual(Buffer.from(sign(value).slice(0, sig.length)), Buffer.from(sig));
}

async function googleToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google-token mislukt: ' + JSON.stringify(j));
  return j.access_token;
}

async function drive(token, path, opts = {}) {
  const r = await fetch('https://www.googleapis.com/drive/v3/' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('Drive ' + r.status + ': ' + (await r.text()));
  return r.json();
}

// Zoekt een map op naam (binnen parent) of maakt hem aan.
async function folder(token, name, parent) {
  const esc = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parent) q += ` and '${parent}' in parents`;
  // Oudste eerst: ontstaat er ooit een dubbele map (twee verzoeken tegelijk), dan kiest iedereen dezelfde.
  const list = await drive(token, 'files?orderBy=createdTime&fields=files(id)&q=' + encodeURIComponent(q));
  if (list.files.length) return list.files[0].id;
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parent) body.parents = [parent];
  const f = await drive(token, 'files?fields=id', { method: 'POST', body: JSON.stringify(body) });
  return f.id;
}

async function rootMap(token) {
  for (const naam of [ROOT_NAME, ROOT_OUD]) {
    const esc = naam.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const l = await drive(token, 'files?fields=files(id)&q=' + encodeURIComponent(q));
    if (l.files.length) return l.files[0].id;
  }
  return folder(token, ROOT_NAME);
}

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

// ---- Opdrachtenoverzicht (Google Sheet in de uploadmap) ----
const SHEET_NAME = 'Opdrachtenoverzicht';
const KOLOMMEN = ['Code', 'Naam', 'Contact', 'Datum uitvaart', 'Aanvraag', 'Uploadlink', 'Upload ontvangen',
  "Aantal foto's", "Extra foto's (boven 60)", 'Akkoord voorwaarden', 'Drive-map', 'Concept', 'Betaald', 'Geleverd', 'Notities',
  'Pakket', 'Bedrag', 'Betaallink', 'Film', 'Review gevraagd', 'Muziek', 'Download', 'Partner', 'Films'];

// Verzamellink (zelf maken): prijs van de download en adres van de omzetserver (Google Cloud Run, geen geheim).
const DOWNLOAD_PRIJS = 39; // consument, incl. 21% btw (partner: €24,99 excl. btw, zie beheer.html)
const EXTRA_FILM_VERZAMEL = 12.99; // per extra film bij de verzamellink, consument incl. btw (partner: €9,99 excl. btw)

// Meerdere films per opdracht: film 1 = de vakmappen in de klantmap; film 2+ = submap 'Film n – naam' met dezelfde vakken.
const FILMSUB = /^Film (\d+) – (.+)$/;
const filmMapNaam = (nr, naam) => `Film ${nr} – ${String(naam || 'Film ' + nr).replace(/[\/\\\u0000-\u001f]/g, ' ').trim().slice(0, 40) || 'Film ' + nr}`;
async function filmMappen(token, klant) {
  const q = `'${klant}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const files = (await drive(token, 'files?pageSize=100&fields=files(id,name)&q=' + encodeURIComponent(q))).files;
  return files.map((f) => { const m = FILMSUB.exec(f.name); return m && +m[1] >= 2 ? { nr: +m[1], naam: m[2], id: f.id } : null; })
    .filter(Boolean).sort((a, b) => a.nr - b.nr);
}
const OMZET_URL = process.env.OMZET_URL || 'https://omzetter-783697177718.europe-west4.run.app';

function nu() {
  return new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short' });
}

async function sheets(token, path, opts = {}) {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error('Sheets ' + r.status + ': ' + (await r.text()));
  return r.json();
}

async function overzicht(token) {
  const root = await rootMap(token);
  const q = `name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and '${root}' in parents`;
  const list = await drive(token, 'files?fields=files(id)&q=' + encodeURIComponent(q));
  if (list.files.length) {
    const id = list.files[0].id;
    const kop = await sheets(token, `${id}/values/1:1`);
    if (((kop.values || [[]])[0] || []).length < KOLOMMEN.length) {
      await sheets(token, `${id}/values/A1?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [KOLOMMEN] }) });
    }
    return id;
  }
  const f = await drive(token, 'files?fields=id', { method: 'POST', body: JSON.stringify({
    name: SHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [root] }) });
  await sheets(token, `${f.id}/values/A1?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [KOLOMMEN] }) });
  return f.id;
}

// Werkt de regel van een opdracht bij (of maakt hem aan). velden: { 'Kolomnaam': waarde }. Lege kolommen blijven ongemoeid.
async function logOpdracht(token, code, velden) {
  const id = await overzicht(token);
  const col = await sheets(token, `${id}/values/A:A`);
  const codes = (col.values || []).map((r) => r[0]);
  const rij = KOLOMMEN.map((k) => (k === 'Code' ? code : (k in velden ? String(velden[k]) : null)));
  const idx = codes.indexOf(code);
  if (idx >= 1) {
    await sheets(token, `${id}/values/A${idx + 1}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [rij] }) });
  } else {
    await sheets(token, `${id}/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: [rij.map((v) => (v === null ? '' : v))] }) });
  }
}

// Nooit de hoofdtaak laten mislukken door het overzicht.
async function logVeilig(code, velden) {
  try { await logOpdracht(await googleToken(), code, velden); } catch (e) { console.error('Opdrachtenoverzicht', e); }
}

// Alle opdrachten als objecten { Kolomnaam: waarde }.
async function leesOpdrachten(token) {
  const id = await overzicht(token);
  const v = (await sheets(token, `${id}/values/A:Z`)).values || [];
  const kop = v[0] || KOLOMMEN;
  return v.slice(1).map((r) => Object.fromEntries(kop.map((k, i) => [k, r[i] || ''])));
}

// Datum als 'JJJJ-MM-DD UU:MM' (Nederlandse tijd), goed te sorteren en te rekenen.
function nuIso() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 16);
}

// ---- Mail (Resend) ----
async function mail({ to, subject, text, html, replyTo }) {
  const { Resend } = await import('resend');
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'Uitvaart portret <info@uitvaart-portret.nl>', to, subject, text, html, ...(replyTo ? { replyTo } : {}),
  });
  if (error) throw new Error('Resend: ' + JSON.stringify(error));
}
const isMail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
function waNummer(contact) {
  let d = String(contact).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '31' + d.slice(1);
  return /^\d{10,15}$/.test(d) ? d : '';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function mailHtml(tekst) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#25292A;max-width:560px">${
    esc(tekst).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</div>`;
}

// ---- Film in Drive ----
const FILMMAP = '5 Film';
async function filmMap(token, code) {
  const klant = await folder(token, code, await rootMap(token));
  return folder(token, FILMMAP, klant);
}
async function nieuwsteFilm(token, code) {
  const map = await filmMap(token, code);
  const q = `'${map}' in parents and mimeType contains 'video/' and trashed=false`;
  const l = await drive(token, 'files?orderBy=createdTime desc&pageSize=1&fields=files(id,name,webViewLink)&q=' + encodeURIComponent(q));
  return l.files[0] || null;
}
// Deelt de film via 'iedereen met de link'. download=false: alleen bekijken (concept).
async function deel(token, fileId, download) {
  await drive(token, `files/${fileId}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
  await drive(token, `files/${fileId}?fields=id`, { method: 'PATCH', body: JSON.stringify({ copyRequiresWriterPermission: !download }) });
  return (await drive(token, `files/${fileId}?fields=webViewLink`)).webViewLink;
}

// ---- Prijs en Mollie ----
const PRIJS = { Klassiek: 249, Modern: 299 };
function berekenBedrag({ pakket, spoed = 0, extraFotos = 0, extraRondes = 0, korteVersie = false, verrekend = 0, extraFilms = 0 }) {
  const regels = [[`Fotofilm ${pakket}`, PRIJS[pakket] || 0]];
  const ef = Math.max(0, Math.min(5, parseInt(extraFilms, 10) || 0));
  if (ef && PRIJS[pakket]) regels.push([`${ef} extra film${ef > 1 ? 's' : ''} (60%)`, ef * Math.round(PRIJS[pakket] * 0.6)]);
  const blokken = Math.ceil(Math.max(0, extraFotos) / 5);
  if (blokken) regels.push([`${blokken * 5} extra foto's`, blokken * 10]);
  if (+spoed === 49 || +spoed === 99) regels.push(['Spoedtoeslag', +spoed]);
  if (extraRondes > 0) regels.push([`${extraRondes} extra correctieronde(s)`, 35 * extraRondes]);
  if (korteVersie) regels.push(['Korte versie om te delen', 39]);
  if (verrekend > 0) regels.push(['Verrekend: betaalde download verzamellink', -verrekend]);
  return { regels, totaal: Math.round(regels.reduce((a, [, b]) => a + b, 0) * 100) / 100 };
}
async function mollie(path, opts = {}) {
  const r = await fetch('https://api.mollie.com/v2/' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + process.env.MOLLIE_API_KEY, 'Content-Type': 'application/json' },
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Mollie ' + r.status + ': ' + JSON.stringify(j));
  return j;
}

// ---- Levering na betaling ----
async function lever(token, order) {
  const code = order.Code;
  const film = await nieuwsteFilm(token, code);
  if (!film) throw new Error('Geen film gevonden voor ' + code);
  const link = await deel(token, film.id, true);
  const naam = order.Naam || '';
  const tekst = `Beste ${naam},

Hartelijk dank voor uw betaling. Via deze link kunt u de film bekijken en downloaden:
${link}

Klik rechtsboven op het downloadicoon om het bestand op te slaan. Zet het voor de uitvaart ook op een usb-stick, dan heeft de uitvaartlocatie altijd een reserve.

De link blijft 90 dagen werken. Bewaar de film dus op een eigen plek.

Ik wens u veel sterkte bij het afscheid.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  if (isMail(order.Contact)) await mail({ to: order.Contact.trim(), subject: 'Uw fotofilm staat klaar', text: tekst, html: mailHtml(tekst) });
  await logOpdracht(token, code, { Betaald: nuIso(), Geleverd: nuIso(), Film: link });
  const wa = waNummer(order.Contact);
  const note = isMail(order.Contact) ? 'De downloadlink is automatisch gemaild.'
    : `Geen e-mailadres bekend: stuur de link zelf via WhatsApp: https://wa.me/${wa}?text=${encodeURIComponent(tekst)}`;
  await mail({ to: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl', subject: `Betaald en geleverd: ${code}`,
    text: `${naam} (${code}) heeft betaald. ${note}\n\nFilm: ${link}`, html: mailHtml(`${naam} (${code}) heeft betaald. ${note}\n\nFilm: ${link}`) });
}

export { ROOT_NAME, rootMap, FASES, DIASHOW, DOWNLOAD_PRIJS, OMZET_URL, EXTRA_FILM_VERZAMEL, FILMSUB, filmMapNaam, filmMappen, sign, check, googleToken, drive, folder, fail, nu, nuIso, logOpdracht, logVeilig, leesOpdrachten,
  mail, mailHtml, isMail, waNummer, filmMap, nieuwsteFilm, deel, berekenBedrag, mollie, lever };
