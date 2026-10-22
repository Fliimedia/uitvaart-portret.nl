// Stuurt Daan een mail zodra een familie foto's heeft verstuurd, met een link naar de Drive-map.
import { Resend } from 'resend';
import { ROOT_NAME, FASES, check, googleToken, folder, fail } from './_lib.js';

const FROM = 'Uitvaart portret <info@uitvaart-portret.nl>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { c, s } = b;
  if (!check(c, s)) return fail(res, 403, 'Ongeldige link');

  const perFase = Array.isArray(b.perFase) ? b.perFase.slice(0, 4).map((n) => Math.max(0, parseInt(n, 10) || 0)) : [0, 0, 0, 0];
  const totaal = perFase.reduce((a, n) => a + n, 0);
  const ster = Math.max(0, parseInt(b.ster, 10) || 0);
  const mislukt = Math.max(0, parseInt(b.mislukt, 10) || 0);

  let map = '';
  try {
    const t = await googleToken();
    const id = await folder(t, c, await folder(t, ROOT_NAME));
    map = 'https://drive.google.com/drive/folders/' + id;
  } catch (e) {
    console.error('Drive-map niet gevonden', e);
  }

  const rows = [
    ['Klant', c],
    ['Totaal', `${totaal} foto's/video's` + (totaal > 60 ? ` (${totaal - 60} boven de 60)` : '')],
    ...FASES.map((f, i) => [f.replace(/^\d /, ''), String(perFase[i] || 0)]),
    ['Met ster', String(ster)],
    ['Portretfoto', b.portret ? 'ja' : 'nee'],
    ...(mislukt ? [['Niet aangekomen', `${mislukt} (familie kan opnieuw proberen)`]] : []),
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (map ? `\n\nOpen de map: ${map}` : '');
  const html = `<table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:5px 16px 5px 0;color:#666">${esc(k)}</td><td style="padding:5px 0">${esc(v)}</td></tr>`)
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
