// Maakt (of vindt) de klantmap met vier fasemappen in Drive en geeft ondertekende map-id's terug.
import { ROOT_NAME, rootMap, FASES, sign, check, googleToken, folder, fail, leesOpdrachten, filmMapNaam, filmMappen } from './_lib.js';

export default async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const { c, s, film, naam } = req.body || {};
  if (!check(c, s)) return fail(res, 403, 'Ongeldige link');
  try {
    const t = await googleToken();
    const root = await rootMap(t);
    const klant = await folder(t, c, root);
    const bestaand = await filmMappen(t, klant);
    // Film 2+: eigen submap 'Film n – naam' met dezelfde vakken.
    let ouder = klant;
    const nr = parseInt(film, 10) || 1;
    if (nr >= 2 && nr <= 6) {
      const al = bestaand.find((f) => f.nr === nr);
      ouder = al ? al.id : await folder(t, filmMapNaam(nr, naam), klant);
    }
    const folders = [];
    for (const name of FASES) {
      const id = await folder(t, name, ouder);
      folders.push({ id, sig: sign(c + ':' + id) });
    }
    if (nr >= 2) return res.json({ folders });
    // Heeft iemand van deze familie al eerder muziek en akkoord doorgegeven? Dan hoeft een volgende uploader dat niet opnieuw.
    let eerder = { muziek: '', akkoord: false };
    const films = bestaand.map((f) => ({ nr: f.nr, naam: f.naam, muziek: '' }));
    try {
      const o = (await leesOpdrachten(t)).find((r) => r.Code === c);
      if (o) {
        // Films-kolom: 'Familie | Vrienden | Werk' (positie = filmnummer). Muziek van film 2+ staat als 'Film n: …'.
        const namen = String(o.Films || '').split(' | ');
        const n1 = (namen[0] || '').trim();
        const m = String(o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '').split(' | ').filter(Boolean);
        const van = (nr) => m.filter((x) => nr === 1 ? !/^Film \d+: /.test(x) : x.startsWith(`Film ${nr}: `)).map((x) => x.replace(/^Film \d+: /, '')).join(' | ');
        films.unshift({ nr: 1, naam: /^Film 1$/.test(n1) ? '' : n1, muziek: van(1) });
        films.forEach((f) => { if (f.nr > 1) f.muziek = van(f.nr); });
      }
      if (o) eerder = { muziek: o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '', akkoord: !!o['Akkoord voorwaarden'] && o['Akkoord voorwaarden'] !== 'NIET',
        gesloten: /^(Betaald|Omzetten|Geleverd)/.test(o.Download || ''), partner: o.Partner || '' };
    } catch (e) { console.error('Status opdracht', e); }
    res.json({ folders, eerder, films });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Opslag niet bereikbaar');
  }
};
