// Afmelden voor de partnermails. GET toont een knop (zodat virusscanners die links openen niemand afmelden),
// POST meldt af (ook de één-klik-afmelding uit Gmail en Outlook).
import { check, googleToken, nuIso } from './_lib.js';
import { leads, zet } from './partners.js';

const pagina = (tekst, knop = '') => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Afmelden – Uitvaart portret</title></head>
<body style="margin:0;background:#F3EEE6;font-family:Arial,sans-serif;color:#25292A"><main style="max-width:520px;margin:12vh auto;padding:0 16px">
<h1 style="font-family:Georgia,serif;font-weight:400">Afmelden</h1><p style="font-size:17px;line-height:1.6">${tekst}</p>${knop}</main></body></html>`;

export default async function handler(req, res) {
  const e = String(req.query.e || '').trim().toLowerCase();
  const s = String(req.query.s || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!e || !check('afmeld:' + e, s)) return res.status(400).send(pagina('Deze afmeldlink klopt niet. Mail gerust naar info@uitvaart-portret.nl, dan meld ik u handmatig af.'));
  if (req.method !== 'POST') {
    return res.send(pagina(`Wilt u geen berichten meer ontvangen op ${e.replace(/[<>&"]/g, '')}?`,
      `<form method="post"><button style="font:inherit;font-weight:600;height:44px;padding:0 22px;border:0;border-radius:22px;background:#4B5A48;color:#fff;cursor:pointer">Ja, meld mij af</button></form>`));
  }
  try {
    const t = await googleToken();
    const L = await leads(t);
    for (const l of L.rijen.filter((x) => x['E-mail'].trim().toLowerCase() === e)) {
      await zet(t, L, l.rij, { Status: 'Afgemeld', Notities: `${l.Notities ? l.Notities + '; ' : ''}Afgemeld ${nuIso()}` });
    }
    return res.send(pagina('U bent afgemeld. U ontvangt geen berichten meer van mij. Excuses voor het storen.'));
  } catch (err) {
    console.error('Afmelden', err);
    return res.status(500).send(pagina('Dat lukte even niet. Mail naar info@uitvaart-portret.nl, dan meld ik u direct handmatig af.'));
  }
}
