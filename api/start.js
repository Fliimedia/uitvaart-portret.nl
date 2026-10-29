// Start een resumable upload naar Drive. De browser stuurt het bestand daarna zelf rechtstreeks naar Google.
import { check, googleToken, fail } from './_lib.js';

export default async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const { c, s, folder, fsig, name, mime, size, duur } = req.body || {};
  if (!check(c, s) || !check(c + ':' + folder, fsig)) return fail(res, 403, 'Ongeldige link');
  if (!/^(image|video|audio)\//.test(String(mime))) return fail(res, 400, 'Alleen foto\'s, video\'s en muziek');
  if (!(size > 0 && size < 2e9)) return fail(res, 400, 'Bestand te groot');
  const safeName = String(name).replace(/[\/\\\u0000-\u001f]/g, '_').slice(0, 150);
  try {
    const t = await googleToken();
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + t,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size),
        // Met de Origin van de site mag de browser daarna rechtstreeks naar deze upload-URL sturen (CORS).
        Origin: req.headers.origin || 'https://' + req.headers.host,
      },
      // Muziek: lengte in seconden (gemeten in de browser) als eigenschap, voor de diashow-check op de verzamelpagina.
      body: JSON.stringify({ name: safeName, parents: [folder], ...(/^audio\//.test(mime) && +duur > 0 ? { appProperties: { duur: String(Math.round(+duur)) } } : {}) }),
    });
    const url = r.headers.get('location');
    if (!r.ok || !url) throw new Error('Drive ' + r.status + ': ' + (await r.text()));
    res.json({ url });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Upload kon niet starten');
  }
};
