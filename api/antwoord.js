// Eerste antwoord aan een familie: Daan opent de link uit de aanvraagmail, leest na en verstuurt met één knop.
// Telt hoe vaak het voorstel ongewijzigd is verstuurd; bij 100 kan AUTO_ANTWOORD=1 in Vercel (dan gaat het vanzelf).
import { check, googleToken, leesOpdrachten, logOpdracht, mail, isMail, nu } from './_lib.js';
import { antwoord } from './contact.js';

const DOEL = 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pagina = (inhoud) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Antwoord versturen – Uitvaart portret</title></head>
<body style="margin:0;background:#F3EEE6;font-family:Arial,sans-serif;color:#25292A"><main style="max-width:680px;margin:6vh auto;padding:0 16px 60px">${inhoud}</main></body></html>`;
const knop = 'font:inherit;font-weight:600;height:46px;padding:0 24px;border:0;border-radius:23px;background:#4B5A48;color:#fff;cursor:pointer';

function teller(lijst) {
  const n = lijst.filter((o) => o['Antwoord aangepast'] === 'nee').length;
  return `<p style="font-size:14px;color:#4A4F4C;margin:24px 0 0">Ongewijzigd verstuurd: <strong>${n} van ${DOEL}</strong>${n >= DOEL ? ' — je kunt het automatisch laten versturen (AUTO_ANTWOORD=1 in Vercel).' : '.'}</p>`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const c = String(req.query.c || '');
  if (!c || !check('antwoord:' + c, String(req.query.s || ''))) return res.status(400).send(pagina('<p>Deze link klopt niet.</p>'));
  try {
    const t = await googleToken();
    const lijst = await leesOpdrachten(t);
    const o = lijst.find((x) => x.Code === c);
    if (!o) return res.status(404).send(pagina('<p>Deze aanvraag staat niet (meer) in het opdrachtenoverzicht.</p>'));
    if (!isMail(o.Contact)) return res.send(pagina(`<p>${esc(o.Naam)} heeft geen e-mailadres opgegeven (${esc(o.Contact)}). Gebruik de WhatsApp-knop in de aanvraagmail.</p>`));
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(o['Datum uitvaart']) ? o['Datum uitvaart'] : '';
    const voorstel = antwoord(o.Naam, datum, o.Uploadlink);
    const onderwerpStd = 'Uw fotofilm – uitvaart-portret.nl';
    if (o['Antwoord verstuurd']) {
      return res.send(pagina(`<h1 style="font-family:Georgia,serif;font-weight:400">Al verstuurd</h1><p>Het antwoord aan ${esc(o.Naam)} is verstuurd op ${esc(o['Antwoord verstuurd'])}.</p>${teller(lijst)}`));
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
      const tekst = String(b.tekst || '').replace(/\r/g, '').trim().slice(0, 8000);
      const onderwerp = String(b.onderwerp || onderwerpStd).trim().slice(0, 200);
      if (!tekst) return res.status(400).send(pagina('<p>De tekst is leeg.</p>'));
      await mail({ to: o.Contact.trim(), subject: onderwerp, text: tekst, replyTo: 'info@uitvaart-portret.nl' });
      const aangepast = tekst !== voorstel.trim() || onderwerp !== onderwerpStd ? 'ja' : 'nee';
      await logOpdracht(t, c, { 'Antwoord verstuurd': nu(), 'Antwoord aangepast': aangepast });
      o['Antwoord aangepast'] = aangepast;
      return res.send(pagina(`<h1 style="font-family:Georgia,serif;font-weight:400">✓ Verstuurd</h1><p>Het antwoord is gemaild naar ${esc(o.Contact)}.${aangepast === 'ja' ? ' Je had de tekst aangepast; vertel Claude wat je veranderde, dan wordt het voorstel beter.' : ''}</p>${teller(lijst)}`));
    }
    return res.send(pagina(`<h1 style="font-family:Georgia,serif;font-weight:400;margin:0 0 6px">Antwoord aan ${esc(o.Naam)}</h1>
<p style="color:#4A4F4C;margin:0 0 18px">Naar ${esc(o.Contact)}${o['Datum uitvaart'] ? ' · uitvaart ' + esc(o['Datum uitvaart']) : ''}. Lees na, pas aan waar nodig en verstuur.</p>
<form method="post">
<input name="onderwerp" value="${esc(onderwerpStd)}" style="width:100%;font:inherit;padding:10px 12px;border:1px solid #CFC4B4;border-radius:10px;margin-bottom:10px;box-sizing:border-box">
<textarea name="tekst" style="width:100%;min-height:420px;font:inherit;font-size:15px;line-height:1.5;padding:12px;border:1px solid #CFC4B4;border-radius:10px;box-sizing:border-box">${esc(voorstel)}</textarea>
<p style="margin:14px 0 0"><button style="${knop}" onclick="this.disabled=true;this.textContent='Bezig…';this.form.submit()">Verstuur naar ${esc(o.Naam)}</button></p>
</form>${teller(lijst)}`));
  } catch (e) {
    console.error('Antwoord', e);
    return res.status(500).send(pagina('<p>Er ging iets mis. Gebruik de knop "Zelf mailen" in de aanvraagmail.</p>'));
  }
}
