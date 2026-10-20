// Gedeelde helpers voor de uploadfuncties. Bestanden met _ worden door Vercel niet als functie gepubliceerd.
const crypto = require('crypto');

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

module.exports = { ROOT_NAME, FASES, sign, check, googleToken, drive, folder, fail };
