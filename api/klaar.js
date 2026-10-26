// Stuurt Daan een mail zodra een familie foto's heeft verstuurd, met een link naar de Drive-map.
import { Resend } from 'resend';
import { ROOT_NAME, FASES, check, googleToken, folder, fail, nu, logVeilig } from './_lib.js';

const FROM = 'Uitvaart portret <info@uitvaart-portret.nl>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Legt het akkoord vast als tekstbestand in de klantmap (bewijs naast de e-mail).
async function bewijs(token, folderId, code, wanneer) {
  const tekst = `Klant/opdracht: ${code}\nAkkoord gegeven op: ${wanneer}\n\nAangevinkt op de uploadpagina:\n"Ik ga akkoord met de algemene voorwaarden en wil dat Daan direct begint. Ik begrijp dat mijn herroepingsrecht vervalt zodra de film is geleverd."\n`;
  const grens = 'akkoord' + Date.now();
  const body = `--${grens}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: 'AKKOORD voorwaarden.txt', parents: [folderId] }) +
    `\r\n--${grens}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${tekst}\r\n--${grens}--`;
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + grens },
    body,
  });
  if (!r.ok) throw new Error('Akkoordbestand ' + r.status + ': ' + (await r.text()));
}

// Schrijft een tekstbestand in de klantmap.
async function tekstbestand(token, folderId, naam, tekst) {
  const grens = 'txt' + Date.now();
  const body = `--${grens}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: naam, parents: [folderId] }) +
    `\r\n--${grens}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${tekst}\r\n--${grens}--`;
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + grens }, body,
  });
  if (!r.ok) throw new Error(naam + ' ' + r.status + ': ' + (await r.text()));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { c, s } = b;
  if (!check(c, s)) return fail(res, 403, 'Ongeldige link');

  const perFase = Array.isArray(b.perFase) ? b.perFase.slice(0, 4).map((n) => Math.max(0, parseInt(n, 10) || 0)) : [0, 0, 0, 0];
  const totaal = perFase.reduce((a, n) => a + n, 0);
  const ster = Math.max(0, parseInt(b.ster, 10) || 0);
  const mislukt = Math.max(0, parseInt(b.mislukt, 10) || 0);

  // Muziek: titel/artiest + optionele link, en eventuele meegestuurde bestanden.
  const kort = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const muziek = (Array.isArray(b.muziek) ? b.muziek : []).slice(0, 5)
    .map((m) => ({ titel: kort(m && m.titel, 200), link: kort(m && m.link, 500) }))
    .filter((m) => m.titel || m.link);
  const muziekBestanden = (Array.isArray(b.muziekBestanden) ? b.muziekBestanden : []).slice(0, 5).map((n) => kort(n, 150));
  const muziekRegels = muziek.map((m, i) => `${i + 1}. ${m.titel || '(geen titel)'}${m.link ? ' — ' + m.link : ''}`)
    .concat(muziekBestanden.map((n) => 'Bestand: ' + n));
  const muziekTekst = muziekRegels.length ? muziekRegels.join('\n') : 'NIET opgegeven';

  // Tijdstip van akkoord (vinkje op de uploadpagina), weergegeven in Nederlandse tijd.
  const t0 = Date.parse(b.akkoord);
  const akkoord = Number.isFinite(t0)
    ? new Date(t0).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'long', timeStyle: 'short' })
    : '';

  let map = '';
  try {
    const t = await googleToken();
    const id = await folder(t, c, await folder(t, ROOT_NAME));
    map = 'https://drive.google.com/drive/folders/' + id;
    if (akkoord) await bewijs(t, id, c, akkoord);
    await tekstbestand(t, id, 'MUZIEK.txt', `Klant/opdracht: ${c}\n\nMuziek:\n${muziekTekst}\n`);
  } catch (e) {
    console.error('Drive-map of akkoordbestand mislukt', e);
  }

  await logVeilig(c, { 'Upload ontvangen': nu(), "Aantal foto's": totaal, "Extra foto's (boven 60)": Math.max(0, totaal - 60),
    'Akkoord voorwaarden': akkoord || 'NIET', 'Drive-map': map, Muziek: muziekRegels.join(' | ') || 'NIET' });

  const rows = [
    ['Klant', c],
    ['Totaal', `${totaal} foto's/video's` + (totaal > 60 ? ` (${totaal - 60} boven de 60)` : '')],
    ...FASES.map((f, i) => [f.replace(/^\d /, ''), String(perFase[i] || 0)]),
    ['Met ster', String(ster)],
    ['Portretfoto', b.portret ? 'ja' : 'nee'],
    ['Muziek', muziekTekst],
    ['Akkoord voorwaarden', akkoord ? `ja, ${akkoord}` : 'NIET ontvangen'],
    ...(mislukt ? [['Niet aangekomen', `${mislukt} (familie kan opnieuw proberen)`]] : []),
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (map ? `\n\nOpen de map: ${map}` : '');
  const html = `<table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:5px 16px 5px 0;color:#666">${esc(k)}</td><td style="padding:5px 0;white-space:pre-line">${esc(v)}</td></tr>`)
    .join('')}</table>` + (map ? `<p style="font-family:Arial,sans-serif;font-size:15px"><a href="${map}">Open de map in Google Drive</a></p>` : '');

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl',
      subject: `Foto's ontvangen: ${c} (${totaal})`,
      text,
      html,
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('Resend', e);
    fail(res, 500, 'Melding niet verstuurd');
  }
}
