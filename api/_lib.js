// Gedeelde helpers voor de uploadfuncties. Bestanden met _ worden door Vercel niet als functie gepubliceerd.
import crypto from 'crypto';

const ROOT_NAME = 'Uitvaart-portret uploads';
const FASES = ['1 Jeugd', '2 Jong volwassen', '3 Gezin en werk', '4 Later'];

function sign(value) {
  return crypto.createHmac('sha256', process.env.UPLOAD_SECRET).update(value).digest('hex').slice(0, 24);
}

function check(value, sig) {
  if (typeof value !== 'string' || typeof sig !== 'string' || sig.length !== 24) return false;
  return crypto.timingSafeEqual(Buffer.from(sign(value)), Buffer.from(sig));
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
  const list = await drive(token, 'files?fields=files(id)&q=' + encodeURIComponent(q));
  if (list.files.length) return list.files[0].id;
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parent) body.parents = [parent];
  const f = await drive(token, 'files?fields=id', { method: 'POST', body: JSON.stringify(body) });
  return f.id;
}

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

// ---- Opdrachtenoverzicht (Google Sheet in de uploadmap) ----
const SHEET_NAME = 'Opdrachtenoverzicht';
const KOLOMMEN = ['Code', 'Naam', 'Contact', 'Datum uitvaart', 'Aanvraag', 'Uploadlink', 'Upload ontvangen',
  "Aantal foto's", "Extra foto's (boven 60)", 'Akkoord voorwaarden', 'Drive-map', 'Concept', 'Betaald', 'Geleverd', 'Notities'];

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
  const root = await folder(token, ROOT_NAME);
  const q = `name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and '${root}' in parents`;
  const list = await drive(token, 'files?fields=files(id)&q=' + encodeURIComponent(q));
  if (list.files.length) return list.files[0].id;
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

export { ROOT_NAME, FASES, sign, check, googleToken, drive, folder, fail, nu, logOpdracht, logVeilig };
