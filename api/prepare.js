// Maakt (of vindt) de klantmap met vier fasemappen in Drive en geeft ondertekende map-id's terug.
import { ROOT_NAME, FASES, sign, check, googleToken, folder, fail, leesOpdrachten } from './_lib.js';

export default async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const { c, s } = req.body || {};
  if (!check(c, s)) return fail(res, 403, 'Ongeldige link');
  try {
    const t = await googleToken();
    const root = await folder(t, ROOT_NAME);
    const klant = await folder(t, c, root);
    const folders = [];
    for (const name of FASES) {
      const id = await folder(t, name, klant);
      folders.push({ id, sig: sign(c + ':' + id) });
    }
    // Heeft iemand van deze familie al eerder muziek en akkoord doorgegeven? Dan hoeft een volgende uploader dat niet opnieuw.
    let eerder = { muziek: '', akkoord: false };
    try {
      const o = (await leesOpdrachten(t)).find((r) => r.Code === c);
      if (o) eerder = { muziek: o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '', akkoord: !!o['Akkoord voorwaarden'] && o['Akkoord voorwaarden'] !== 'NIET' };
    } catch (e) { console.error('Status opdracht', e); }
    res.json({ folders, eerder });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Opslag niet bereikbaar');
  }
};
