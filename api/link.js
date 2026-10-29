// Uploadlinks en de verzamellink.
// - Daan maakt een persoonlijke uploadlink (beveiligd met ADMIN_PASSWORD).
// - Verzamellink (zelf maken): aanvragen, status bekijken, afsluiten en betalen (€39), en de terugkoppeling van de omzetserver.
import crypto from 'crypto';
import { sign, check, fail, nu, nuIso, logVeilig, logOpdracht, isMail, mail, mailHtml, googleToken, drive, folder, rootMap,
  leesOpdrachten, deel, mollie, soort, FASES, DIASHOW, DOWNLOAD_PRIJS, DIASHOW_PRIJS, OMZET_URL, EXTRA_FILM_VERZAMEL, FILMSUB } from './_lib.js';

const DAAN = () => process.env.CONTACT_EMAIL || 'info@uitvaart-portret.nl';
const SITE = 'https://www.uitvaart-portret.nl';
const kort = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const voornaam = (o) => String(o.Naam || '').replace(/ \(voor .*\)$/, '');

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query && req.query.d) return await voorbeeld(req, res);
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = req.body || {};
  try {
    if (b.zelf || b.actie === 'zelf') return await zelfLink(req, res, b);
    if (b.actie === 'status') return await status(res, b);
    if (b.actie === 'beheerlink') return await stuurBeheerlink(res, b);
    if (b.actie === 'galerij') return await galerij(res, b);
    if (b.actie === 'download') return await downloadInfo(res, b);
    if (b.actie === 'afsluiten') return await afsluiten(res, b);
    if (b.actie === 'token') return await omzetToken(res, b);
    if (b.actie === 'omgezet') return await omgezet(res, b);
    return await linkHandler(req, res, b);
  } catch (e) {
    console.error('link', b.actie, e);
    return fail(res, 500, 'Er ging iets mis. Probeer het later opnieuw of mail info@uitvaart-portret.nl');
  }
}

const maakCode = (naam, prefix = '') => {
  const slug = String(naam || 'klant').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'klant';
  return prefix + slug + '-' + crypto.randomBytes(4).toString('hex');
};
// Korte links voor verzamellinks: /z/<code zonder zelf->.<12 tekens> (familie) en /b/… (aanvrager).
const kortOf = (code) => String(code).startsWith('zelf-') ? String(code).slice(5) : '';
export const uploadLink = (code) => kortOf(code) ? `${SITE}/z/${kortOf(code)}.${sign(code).slice(0, 12)}`
  : `${SITE}/upload.html?c=${encodeURIComponent(code)}&s=${sign(code)}`;
export const kijkLink = (code) => `${SITE}/k/${kortOf(code)}.${sign('kijk:' + code).slice(0, 12)}`;
// Downloadpagina na het omzetten: /d/<code zonder zelf->.<12 tekens>
export const downloadLink = (code) => `${SITE}/d/${kortOf(code)}.${sign('download:' + code).slice(0, 12)}`;
const DOWNLOADS = 'Downloads'; // map in de klantmap met één zip per film (gemaakt door de omzetserver)
const zipUrl = (id) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
export const beheerLink = (code) => `${SITE}/b/${kortOf(code)}.${sign('beheer:' + code).slice(0, 12)}`;
const knop = (href, tekst) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0"><tr><td style="border-radius:26px;background:#4B5A48"><a href="${href}" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">${tekst}</a></td></tr></table>`;
const html = (delen) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#25292A;max-width:560px">${delen.join('')}</div>`;
const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;

async function linkHandler(req, res, { wachtwoord, naam }) {
  const ok = typeof wachtwoord === 'string' && process.env.ADMIN_PASSWORD &&
    wachtwoord.length === process.env.ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(wachtwoord), Buffer.from(process.env.ADMIN_PASSWORD));
  if (!ok) return fail(res, 401, 'Onjuist wachtwoord');
  const code = maakCode(naam);
  const link = uploadLink(code);
  await logVeilig(code, { Naam: String(naam || ''), Aanvraag: nu() + ' (link handmatig)', Uploadlink: link });
  res.json({ code, link });
}

// ---- 1. Verzamellink aanvragen ----
async function zelfLink(req, res, b) {
  if (b.website) return res.json({ ok: true }); // honeypot: bots vullen dit veld in
  try { await maakConsumentlink(b); return res.json({ ok: true }); }
  catch (e) { return fail(res, e.status || 500, e.message); }
}

// Ook bruikbaar vanuit beheer (iemand appt of belt Daan): dan geen melding aan Daan zelf.
export async function maakConsumentlink(b, { vanuitBeheer = false } = {}) {
  const fout = (m, status) => Object.assign(new Error(m), { status });
  const naam = kort(b.naam, 80), email = kort(b.email, 120).toLowerCase(), datum = kort(b.datum, 40), voor = kort(b.voor, 80);
  if (!naam || !isMail(email)) throw fout('Vul de naam en een geldig e-mailadres in', 400);
  const code = maakCode(voor || naam, 'zelf-');
  const link = uploadLink(code), beheer = beheerLink(code);
  const tekst = `Beste ${naam},

Uw verzamellink${voor ? ' voor de foto’s van ' + voor : ''} staat klaar. Begin op uw eigen verzamelpagina:
${beheer}

Daar deelt u de link met familie en vrienden, voegt u zelf foto’s toe en ziet u wat er binnen is. Is iedereen klaar? Dan rondt u daar af en downloadt u alles in één keer: foto’s en filmpjes in breedbeeld, rechtgezet en op volgorde genummerd (€${DOWNLOAD_PRIJS}, u betaalt pas aan het eind).

Deze pagina is alleen voor u. Stuur familie de deellink, niet deze mail:
${link}

Toch liever dat ik de film voor u maak? Uw foto’s staan dan al klaar. Antwoord gewoon op deze mail, of bel of app 06 18 42 48 58.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  const opmaak = html([
    p(`Beste ${naam},`),
    p(`Uw verzamellink${voor ? ' voor de foto’s van ' + voor : ''} staat klaar. Begin op uw eigen verzamelpagina:`),
    knop(beheer, 'Open uw verzamelpagina'),
    p(`Daar deelt u de link met familie en vrienden, voegt u zelf foto’s toe en ziet u wat er binnen is. Is iedereen klaar? Dan rondt u daar af en downloadt u alles in één keer: foto’s en filmpjes in breedbeeld, rechtgezet en op volgorde genummerd (€${DOWNLOAD_PRIJS}, u betaalt pas aan het eind).`),
    p(`<span style="color:#6A6F6B">Deze pagina is alleen voor u. Stuur familie de deellink, niet deze mail. De deellink is: <a href="${link}" style="color:#4B5A48">${link.replace('https://www.', '')}</a></span>`),
    p('Toch liever dat ik de film voor u maak? Uw foto’s staan dan al klaar. Antwoord gewoon op deze mail, of bel of app 06 18 42 48 58.'),
    p('Met vriendelijke groet,<br>Daan Lubbers<br>uitvaart-portret.nl'),
  ]);
  try {
    await mail({ to: email, subject: 'Uw verzamellink', text: tekst, html: opmaak, replyTo: DAAN() });
  } catch (e) {
    console.error('Verzamellink mail', e);
    throw fout('De mail kon niet verstuurd worden. Probeer het later opnieuw of mail info@uitvaart-portret.nl', 500);
  }
  await logVeilig(code, { Naam: naam + (voor ? ' (voor ' + voor + ')' : ''), Contact: email, 'Datum uitvaart': datum,
    Aanvraag: nu() + (vanuitBeheer ? ' (verzamellink, door Daan)' : ' (verzamellink)'), Uploadlink: link, Pakket: 'Zelf maken' });
  if (!vanuitBeheer) try {
    const t = `Nieuwe verzamellink\n\nNaam: ${naam}\nVoor: ${voor || '-'}\nE-mail: ${email}\nDatum uitvaart: ${datum || '-'}\nCode: ${code}`;
    await mail({ to: DAAN(), subject: `📂 Verzamellink · Aangevraagd: ${naam}`, text: t, html: mailHtml(t), replyTo: email });
  } catch (e) { console.error('Melding verzamellink', e); }
  return { code, link, beheer };
}

// Beheerlink opnieuw sturen (vanaf de uploadpagina). Gaat alleen naar het e-mailadres van de aanvrager.
async function stuurBeheerlink(res, { c, s }) {
  if (!String(c).startsWith('zelf-') || !check(c, s)) return fail(res, 403, 'Ongeldige link');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o || !isMail(o.Contact)) return fail(res, 404, 'Geen e-mailadres bekend');
  const tekst = `Beste ${voornaam(o)},

Hier is nogmaals uw beheerpagina:
${beheerLink(c)}

Daar ziet u wat er binnen is. Is iedereen klaar met aanleveren? Klik dan op 'Iedereen is klaar' om af te ronden en alles te downloaden.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  await mail({ to: o.Contact.trim(), subject: 'Uw beheerpagina voor de verzamellink', text: tekst, html: mailHtml(tekst), replyTo: DAAN() });
  const [naam, domein] = o.Contact.trim().split('@');
  res.json({ ok: true, naar: naam.slice(0, 2) + '…@' + domein });
}

// ---- 2. Beheerpagina: wat is er binnen? ----
async function zoek(t, c) { return (await leesOpdrachten(t)).find((o) => o.Code === c) || null; }

// Film 1 = de vakken in de klantmap; film 2+ = submappen 'Film n – naam'. Bij meer films krijgt elke film
// in 'Klaar voor diashow' een eigen map. fases/diashow blijven die van film 1 (voor oude aanroepen).
// maak = false (status, voorbeelden): alleen kijken, niets aanmaken; de pagina vraagt status en voorbeelden tegelijk op,
// en aanmaken in twee verzoeken tegelijk gaf dubbele mappen. maak = true (omzetten): ontbrekende mappen aanmaken en
// eventuele dubbele vakmappen samenvoegen in de oudste. Elk vak: { naam, id (oudste), ids (alle) }.
const MAP = 'application/vnd.google-apps.folder';
async function submappen(t, ouder) {
  const q = `'${ouder}' in parents and mimeType='${MAP}' and trashed=false`;
  const lijst = (await drive(t, 'files?pageSize=200&orderBy=createdTime&fields=files(id,name)&q=' + encodeURIComponent(q))).files;
  const per = {};
  for (const f of lijst) (per[f.name] = per[f.name] || []).push(f.id);
  return per;
}
async function voegSamen(t, ids) {
  for (const dub of ids.slice(1)) {
    const q = `'${dub}' in parents and trashed=false`;
    for (const f of (await drive(t, 'files?pageSize=1000&fields=files(id)&q=' + encodeURIComponent(q))).files) {
      await drive(t, `files/${f.id}?addParents=${ids[0]}&removeParents=${dub}&fields=id`, { method: 'PATCH', body: '{}' });
    }
    await drive(t, `files/${dub}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
  }
  return ids.slice(0, 1);
}
async function mappen(t, c, o, { maak = false } = {}) {
  const klant = await folder(t, c, await rootMap(t));
  const binnen = await submappen(t, klant);
  const pak = async (per, naam, ouder) => {
    let ids = per[naam] || [];
    if (!ids.length && maak) ids = [await folder(t, naam, ouder)];
    if (ids.length > 1 && maak) ids = await voegSamen(t, ids);
    return ids;
  };
  const vakken = async (ouder, per) => { const r = []; for (const naam of FASES) { const ids = await pak(per, naam, ouder); r.push({ naam, id: ids[0] || null, ids }); } return r; };
  const fases = await vakken(klant, binnen);
  const diashow = (await pak(binnen, DIASHOW, klant))[0] || null;
  const n1 = String((o && o.Films) || '').split(' | ')[0].trim();
  const films = [{ nr: 1, naam: /^Film \d+$/.test(n1) ? '' : n1, map: klant, fases }];
  const extra = Object.entries(binnen).map(([naam, ids]) => { const m = FILMSUB.exec(naam); return m && +m[1] >= 2 ? { nr: +m[1], naam: m[2], id: ids[0] } : null; })
    .filter(Boolean).sort((a, b) => a.nr - b.nr);
  for (const f of extra) films.push({ nr: f.nr, naam: f.naam, map: f.id, fases: await vakken(f.id, await submappen(t, f.id)) });
  if (maak && films.length > 1) for (const f of films) f.diashow = await folder(t, `Film ${f.nr}` + (f.naam ? ' – ' + f.naam : ''), diashow);
  else films[0].diashow = diashow;
  return { klant, fases, diashow, films };
}
// Bestanden in een vak (alle dubbele mappen samen).
async function inVak(t, vak, velden) {
  const uit = [];
  for (const id of vak.ids) uit.push(...(await drive(t, `files?pageSize=1000&orderBy=name&fields=files(${velden})&q=` + encodeURIComponent(`'${id}' in parents and trashed=false`))).files);
  return uit.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'nl', { numeric: true }));
}
const filmLabel = (f) => f.naam || 'Film ' + f.nr;
// Download bij de verzamellink: €39, plus €12,99 per extra film.
const downloadPrijs = (n) => Math.round((DOWNLOAD_PRIJS + EXTRA_FILM_VERZAMEL * Math.max(0, n - 1)) * 100) / 100;
const euro = (x) => '€' + (Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ','));

async function status(res, { c, b }) {
  if (!String(c).startsWith('zelf-') || !check('beheer:' + c, b)) return fail(res, 403, 'Deze beheerlink klopt niet');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o) return fail(res, 404, 'Deze verzamellink bestaat niet meer');
  const m = await mappen(t, c, o);
  const perFase = FASES.map((naam) => ({ naam: naam.replace(/^\d+\s*/, ''), fotos: 0, videos: 0 }));
  const films = [];
  let muziekBestanden = 0;
  // Muziek per film uit de sheet: regels van film 2+ beginnen met 'Film n: '.
  const regels = String(o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '').split(' | ').filter(Boolean);
  const muziekVan = (nr) => regels.filter((x) => (nr === 1 ? !/^Film \d+: /.test(x) : x.startsWith(`Film ${nr}: `))).map((x) => x.replace(/^Film \d+: /, ''));
  for (const film of m.films) {
    const tel = { naam: filmLabel(film), fotos: 0, videos: 0, muziekBestanden: 0, perFase: [] };
    for (const [k, f] of film.fases.entries()) {
      const files = await inVak(t, f, 'name,mimeType');
      const au = files.filter((x) => x.mimeType.startsWith('audio/')).length;
      const fo = files.filter((x) => x.mimeType.startsWith('image/')).length, vi = files.filter((x) => x.mimeType.startsWith('video/')).length;
      muziekBestanden += au; tel.muziekBestanden += au;
      perFase[k].fotos += fo; perFase[k].videos += vi; tel.fotos += fo; tel.videos += vi;
      tel.perFase.push({ naam: perFase[k].naam, fotos: fo, videos: vi });
    }
    tel.muziek = muziekVan(film.nr).join(' · ');
    films.push(tel);
  }
  const prijs = downloadPrijs(films.length);
  res.json({ naam: voornaam(o), partner: o.Partner || '', datum: o['Datum uitvaart'] || '', uploadlink: o.Uploadlink || uploadLink(c), perFase, films,
    muziek: o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '', muziekBestanden, download: o.Download || '', prijs, prijsTekst: euro(prijs),
    diashow: o.Diashow || '', diashowPrijs: DIASHOW_PRIJS * films.length, diashowTekst: euro(DIASHOW_PRIJS * films.length), kijklink: kijkLink(c), downloadlink: /^Geleverd/.test(o.Download || '') ? downloadLink(c) : '' });
}

// ---- 3. Afsluiten en betalen ----
async function afsluiten(res, { c, b, akkoord, diashow }) {
  if (!String(c).startsWith('zelf-') || !check('beheer:' + c, b)) return fail(res, 403, 'Deze beheerlink klopt niet');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o) return fail(res, 404, 'Deze verzamellink bestaat niet meer');
  if (/^(Betaald|Omzetten|Geleverd)/.test(o.Download || '')) return res.json({ status: o.Download });
  // Partnerlink: geen betaling; Daan factureert per maand.
  if (o.Partner) {
    await logOpdracht(t, c, { Download: 'Betaald ' + nu() + ' (partner, op factuur)', Diashow: diashow ? 'Ja' : '' });
    await startOmzetten(t, { ...o, Download: 'Betaald', Diashow: diashow ? 'Ja' : '' });
    return res.json({ status: 'Omzetten' });
  }
  if (!akkoord) return fail(res, 400, 'Vink eerst het akkoord aan');
  if (!process.env.MOLLIE_API_KEY) return fail(res, 500, 'Betalen is even niet mogelijk. Mail info@uitvaart-portret.nl');
  const terug = beheerLink(c) + '?terug=1';
  const nFilms = (await mappen(t, c, o)).films.length;
  const bedrag = Math.round((downloadPrijs(nFilms) + (diashow ? DIASHOW_PRIJS * nFilms : 0)) * 100) / 100;
  const p = await mollie('payments', { method: 'POST', body: JSON.stringify({
    amount: { currency: 'EUR', value: bedrag.toFixed(2) },
    description: `Download foto's ${voornaam(o)}${nFilms > 1 ? ' (' + nFilms + ' films)' : ''}${diashow ? ' + diashow' : ''} [${c}]`.slice(0, 255),
    redirectUrl: terug, webhookUrl: SITE + '/api/mollie', metadata: { code: c, soort: 'download' },
  }) });
  const wanneer = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'long', timeStyle: 'short' });
  await logOpdracht(t, c, { Download: 'Betaling gestart ' + nu() + ' (' + p.id + ')',
    'Akkoord voorwaarden': `ja, ${wanneer} (download verzamellink; herroepingsrecht vervalt bij levering)`, Bedrag: euro(bedrag), Diashow: diashow ? 'Ja' : '' });
  res.json({ checkout: p._links.checkout.href });
}

// Na betaling (vanuit de Mollie-webhook) of als vangnet (dagelijkse taak): de omzetserver aan het werk zetten.
export async function startOmzetten(t, o, { opnieuw = false } = {}) {
  const c = o.Code;
  // Niet dubbel starten: loopt er al een omzetting van minder dan 20 minuten oud, dan niets doen.
  const bezig = /^Omzetten (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(o.Download || '');
  const muur = (x) => Date.parse(x.replace(' ', 'T') + ':00Z'); // beide in Nederlandse tijd, dus het verschil klopt
  if (bezig && !opnieuw && muur(nuIso()) - muur(bezig[1]) < 20 * 60e3) return true;
  if (!OMZET_URL) {
    await logOpdracht(t, c, { Download: 'Betaald ' + nu() + ' – omzetserver nog niet ingesteld' });
    await mail({ to: DAAN(), subject: `${soort(o)} · Download betaald, maar omzetserver ontbreekt: ${c}`, text: `Zet de foto's van ${c} handmatig klaar, of stel de omzetserver in.`,
      html: mailHtml(`Zet de foto's van ${c} handmatig klaar, of stel de omzetserver in.`) });
    return false;
  }
  const m = await mappen(t, c, o, { maak: true });
  const exp = Date.now() + 12 * 3600e3;
  const job = `${c}.${exp}.${sign('omzet:' + c + ':' + exp)}`;
  await logOpdracht(t, c, { Download: 'Omzetten ' + nuIso() });
  const r = await fetch(OMZET_URL.replace(/\/$/, '') + '/omzetten', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ job, code: c, naam: voornaam(o), ...m, downloads: await folder(t, DOWNLOADS, m.klant), diashow: !!o.Diashow, terug: SITE + '/api/link' }),
  }).catch((e) => {
    // Opstarten van de server kan even duren; de opdracht is dan meestal wel aangekomen. Het vangnet van de dagtaak pakt het anders op.
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return { ok: true, traag: true };
    throw e;
  });
  if (!r.ok) throw new Error('Omzetserver ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return true;
}

function checkJob(job) {
  const [c, exp, sig] = String(job || '').split('.');
  if (!c || !(+exp > Date.now()) || !check('omzet:' + c + ':' + exp, sig)) return '';
  return c;
}

// De omzetserver haalt hiermee een kortlevende Google-toegang op (alleen met een geldige, verlopende opdracht).
async function omzetToken(res, { job }) {
  if (!checkJob(job)) return fail(res, 403, 'Ongeldige opdracht');
  res.json({ token: await googleToken() });
}

// De omzetserver is klaar: map delen en de downloadlink mailen.
async function omgezet(res, { job, aantal, fouten, zips, diashows }) {
  const c = checkJob(job);
  if (!c) return fail(res, 403, 'Ongeldige opdracht');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o) return fail(res, 404, 'Onbekend');
  if (/^Geleverd/.test(o.Download || '')) return res.json({ ok: true });
  const m = await mappen(t, c, o);
  // Alleen 'Klaar voor diashow' delen (iedereen met de link mag bekijken): geen originelen, en de zip blijft half zo groot.
  const deelMap = m.diashow || m.klant;
  await drive(t, `files/${deelMap}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
  const drivelink = 'https://drive.google.com/drive/folders/' + deelMap;
  // Zips (één per film) delen; lukt dat, dan gaat de mail naar de downloadpagina, anders naar Drive.
  // Zips in de eigen opslag (pad op de omzetserver) of, als terugval, als Drive-bestand.
  let zipsOk = 0;
  const lijst = [];
  for (const z of (Array.isArray(zips) ? zips : []).slice(0, 6)) {
    if (!z) continue;
    const film = m.films.find((f) => f.nr === +z.nr) || { nr: +z.nr || 1, naam: z.naam || '' };
    const naam = m.films.length > 1 ? `Film ${film.nr}` + (film.naam ? ' – ' + film.naam : '') : 'Alle foto’s en filmpjes';
    if (/^\/zip\/[0-9a-f]{24}\/[^/?#]+\.zip$/.test(String(z.pad || ''))) { lijst.push({ naam, mb: Math.max(1, Math.round((+z.size || 0) / 1e6)), url: OMZET_URL.replace(/\/$/, '') + z.pad }); zipsOk++; continue; }
    if (!/^[\w-]{10,}$/.test(String(z.id || ''))) continue;
    try { await drive(t, `files/${z.id}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) }); zipsOk++; }
    catch (e) { console.error('Zip delen', c, e); }
  }
  // Links voor de downloadpagina bewaren in de map Downloads (wordt na 30 dagen opgeruimd).
  if (lijst.length) try {
    const map = await folder(t, DOWNLOADS, m.klant);
    const grens = 'dl' + Date.now();
    const body = `--${grens}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` + JSON.stringify({ name: 'links.json', parents: [map] }) +
      `\r\n--${grens}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(lijst)}\r\n--${grens}--`;
    const rr = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'multipart/related; boundary=' + grens }, body });
    if (!rr.ok) throw new Error('links.json ' + rr.status);
  } catch (e) { console.error('Downloadlinks bewaren', c, e); zipsOk -= lijst.length; }
  const link = zipsOk ? downloadLink(c) : drivelink;
  const n = Math.max(0, parseInt(aantal, 10) || 0), mis = (Array.isArray(fouten) ? fouten : []).slice(0, 20).map((x) => kort(x, 150));
  const partner = o.Partner || '';
  // Optie diashow: per film klaar (in de zip) of handwerk voor Daan (geen muziekbestand, of het lukte niet).
  const ds = (Array.isArray(diashows) ? diashows : []).slice(0, 6).filter(Boolean);
  const dsOk = ds.filter((x) => x.status === 'ok'), dsHand = ds.filter((x) => x.status !== 'ok');
  const fl = (nr) => { const f = m.films.find((x) => x.nr === +nr); return m.films.length > 1 && f ? ' (' + filmLabel(f) + ')' : ''; };
  const minSec = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const dsTekst = !ds.length ? '' : '\n\n' + [
    dsOk.length ? `De diashow staat er ook bij, als mp4: ${dsOk.map((x) => 'Diashow' + fl(x.nr) + ', ' + minSec(x.duur) + ' minuten').join('; ')}. Eerst de portretfoto, dan de foto’s op de muziek, met zachte overgangen. Hij speelt af op elke computer en past in de systemen van crematoria en uitvaartcentra.` +
      (dsOk.some((x) => x.teKort) ? ' Er waren veel foto’s voor de lengte van de muziek; daarom loopt de diashow na de muziek nog even stil door.' : '') : '',
    dsHand.length ? `De diashow${dsHand.length > 1 || m.films.length > 1 ? 's' + dsHand.map((x) => fl(x.nr)).join('') : ''} maak ik met de hand, met de muziek die is opgegeven. U krijgt hem apart van mij, op tijd voor de uitvaart.` : '',
  ].filter(Boolean).join('\n\n');
  const tekst = `${partner ? 'Hallo,' : 'Beste ' + voornaam(o) + ','}

${partner ? 'De foto’s van ' + voornaam(o) + ' staan klaar om te downloaden:' : 'Dank u wel. Alles staat klaar om te downloaden:'}
${link}

${zipsOk ? (m.films.length > 1 ? 'Per film is er één knop om te downloaden.' : 'Met één knop downloadt u alles in één keer.') + ' Het werkt het makkelijkst op een computer.' : "Klik rechtsboven op 'Alles downloaden'; Google maakt er een zip van."}

${m.films.length > 1 ? `Voor elke film is er een eigen map (${m.films.map(filmLabel).join(', ')}). Samen ${n} foto’s en filmpjes` : `Er staan ${n} foto’s en filmpjes klaar`} in breedbeeld (1920x1080), rechtgezet en op volgorde genummerd: eerst de portretfoto, dan de periodes van het leven, daarna de hobbyfoto’s en de foto’s waarvan de familie twijfelde. Sleep ze in één keer in uw programma, zoals PowerPoint of Photostage. De muziek zit erbij${m.films.length > 1 ? ', per film' : ''}.${dsTekst}${mis.length ? `\n\nDeze bestanden konden we niet omzetten (de originelen staan er wel):\n${mis.join('\n')}` : ''}

Download alles op tijd: na 30 dagen worden de bestanden automatisch verwijderd.

${partner ? 'Deze keer liever dat ik de film maak, bijvoorbeeld als het druk is of de familie iets meer wil dan een diashow? Alles staat al klaar. Antwoord op deze mail, of bel of app 06 18 42 48 58.' : `Merkt u toch dat het maken u te veel wordt, of wilt u net iets meer dan een diashow? Dan maak ik de film. Wat u voor de download betaalde (${o.Bedrag || euro(DOWNLOAD_PRIJS)}) gaat eraf. Antwoord op deze mail, of bel of app 06 18 42 48 58.`}

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  if (isMail(o.Contact)) await mail({ to: o.Contact.trim(), subject: partner ? `Foto’s ${voornaam(o)} staan klaar om te downloaden` : 'Uw foto’s staan klaar om te downloaden', text: tekst, html: mailHtml(tekst), replyTo: DAAN() });
  await logOpdracht(t, c, { Download: 'Geleverd ' + nu() + ` (${n} bestanden${mis.length ? ', ' + mis.length + ' niet omgezet' : ''})`,
    ...(ds.length ? { Diashow: dsHand.length ? 'Handwerk ' + nu() + ' (' + dsHand.map((x) => 'film ' + x.nr + ': ' + x.status).join(', ') + ')' : 'Geleverd ' + nu() } : {}),
    'Drive-map': 'https://drive.google.com/drive/folders/' + m.klant });
  try {
    const hand = dsHand.map((x) => `\nDIASHOW MET DE HAND, film ${x.nr}${fl(x.nr)}: ${x.status === 'geen muziek' ? 'geen muziekbestand' + (x.muziek && x.muziek.length ? '; opgegeven: ' + x.muziek.slice(0, 5).join(' / ') : '') + '. Zet een mp3 in de muziekmap en klik in beheer op Omzetten, of maak hem zelf.' : x.status}`).join('');
    const d = `Download geleverd: ${c}\n${n} bestanden omgezet${ds.length ? '\nDiashow: ' + dsOk.length + ' klaar' + (dsHand.length ? ', ' + dsHand.length + ' handwerk' : '') : ''}${hand}${mis.length ? '\nNiet omgezet:\n' + mis.join('\n') : ''}\n\nMap: https://drive.google.com/drive/folders/${m.klant}`;
    await mail({ to: DAAN(), subject: `${soort(o)} · ${dsHand.length ? 'Diashow met de hand nodig' : 'Download geleverd'}: ${voornaam(o) || c}`, text: d, html: mailHtml(d) });
  } catch (e) { console.error('Melding download', e); }
  res.json({ ok: true });
}

// ---- 4. Partnerlink (vanuit beheer): voor een uitvaartondernemer, per familie, zonder betaalstap ----
export async function maakPartnerlink({ partner, email, familie, datum }) {
  partner = kort(partner, 80); email = kort(email, 120).toLowerCase(); familie = kort(familie, 80); datum = kort(datum, 40);
  if (!partner || !isMail(email) || !familie) throw new Error('Vul partner, e-mailadres en familie in');
  const code = maakCode(familie, 'zelf-');
  const link = uploadLink(code), beheer = beheerLink(code);
  const bericht = `Via deze link kunnen jullie de foto’s, filmpjes en muziek voor de uitvaart klaarzetten. Iedereen in de familie kan meedoen, vanaf elke telefoon of computer. Zet de foto’s in de periode waar ze bij horen; papieren foto’s kun je met de telefoon fotograferen. Voor de muziek is een titel genoeg.\n${link}`;
  const wa = 'https://wa.me/?text=' + encodeURIComponent(bericht);
  const tekst = `Hallo,

De verzamellink voor ${familie} staat klaar.

Stuur de familie dit bericht (kopiëren en plakken in WhatsApp of mail):

${bericht}

Uw verzamelpagina voor deze familie (alleen voor u):
${beheer}
Daar ziet u wat er binnen is. Is iedereen klaar? Klik dan op 'Iedereen is klaar'. Binnen een paar minuten krijgt u een mail met alles in jpg en mp4 (1920x1080), rechtgezet en op volgorde genummerd, ook de iPhone-foto’s.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
  const opmaak = html([
    p('Hallo,'), p(`De verzamellink voor <b>${familie}</b> staat klaar.`),
    p('Stuur de familie dit bericht (kopiëren en plakken in WhatsApp of mail):'),
    `<div style="border-left:3px solid #4B5A48;padding:4px 0 4px 14px;margin:0 0 14px;color:#4A4F4C">${bericht.replace('\n', '<br>').replace(link, `<a href="${link}" style="color:#4B5A48">${link}</a>`)}</div>`,
    knop(wa, 'Stuur via WhatsApp'),
    p('Uw verzamelpagina voor deze familie (alleen voor u). Daar ziet u wat er binnen is, en klikt u op ‘Iedereen is klaar’ zodra de familie klaar is:'),
    knop(beheer, 'Open de verzamelpagina'),
    p('Binnen een paar minuten krijgt u dan een mail met alles in jpg en mp4 (1920x1080), rechtgezet en op volgorde genummerd, ook de iPhone-foto’s.'),
    p('Met vriendelijke groet,<br>Daan Lubbers<br>uitvaart-portret.nl'),
  ]);
  await mail({ to: email, subject: `Verzamellink voor ${familie}`, text: tekst, html: opmaak, replyTo: DAAN() });
  await logOpdracht(await googleToken(), code, { Naam: familie, Contact: email, 'Datum uitvaart': datum, Aanvraag: nu() + ' (partnerlink)',
    Uploadlink: link, Pakket: 'Zelf maken', Partner: partner, 'Akkoord voorwaarden': 'n.v.t. (partner)' });
  return { code, link, beheer };
}

// ---- 5. Meekijken: kleine voorbeelden per vak (voor de aanvrager én via een alleen-kijken-link) ----
async function galerij(res, { c, b, k }) {
  const mag = String(c).startsWith('zelf-') && (check('beheer:' + c, b) || check('kijk:' + c, k));
  if (!mag) return fail(res, 403, 'Deze link klopt niet');
  const t = await googleToken();
  const o = await zoek(t, c);
  if (!o) return fail(res, 404, 'Deze verzamellink bestaat niet meer');
  const m = await mappen(t, c, o);
  const films = [];
  for (const film of m.films) {
  const fases = [], muziek = [];
  for (const f of film.fases) {
    const files = await inVak(t, f, 'id,name,mimeType');
    const items = [];
    for (const x of files) {
      if (x.mimeType.startsWith('audio/')) { muziek.push(x.name.replace(/^MUZIEK \d+ - /, '')); continue; }
      if (!/^(image|video)\//.test(x.mimeType)) continue;
      items.push({ src: `/api/link?d=${x.id}&t=${sign('voorbeeld:' + x.id).slice(0, 16)}`, video: x.mimeType.startsWith('video/'), ster: x.name.includes('★'), portret: x.name.includes('PORTRET') });
    }
    fases.push({ naam: f.naam.replace(/^\d+\s*/, ''), items });
  }
  films.push({ naam: filmLabel(film), fases, muziek });
  }
  const { fases, muziek } = films[0];
  res.json({ naam: voornaam(o), partner: o.Partner || '', fases, muziek, films: films.length > 1 ? films : undefined, titels: o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '', gesloten: /^(Betaald|Omzetten|Geleverd)/.test(o.Download || '') });
}

// Downloadpagina: per film een zip; daarna (30 dagen na het omzetten) verlopen.
async function downloadInfo(res, { c, d }) {
  if (!String(c).startsWith('zelf-') || !check('download:' + c, d)) return fail(res, 403, 'Deze downloadlink klopt niet');
  const t = await googleToken();
  const o = await zoek(t, c);
  const verlopen = () => res.json({ verlopen: true, naam: o ? voornaam(o) : '', partner: (o && o.Partner) || '' });
  if (!o || !/^Geleverd/.test(o.Download || '')) return o && /^(Betaald|Omzetten)/.test(o.Download || '') ? res.json({ bezig: true, naam: voornaam(o), partner: o.Partner || '' }) : verlopen();
  const klant = await folder(t, c, await rootMap(t));
  const binnen = await submappen(t, klant);
  const map = (binnen[DOWNLOADS] || [])[0];
  const diashow = (binnen[DIASHOW] || [])[0];
  const alles = map ? (await drive(t, 'files?pageSize=20&orderBy=createdTime desc&fields=files(id,name,size,createdTime)&q=' + encodeURIComponent(`'${map}' in parents and trashed=false`))).files : [];
  const json = alles.find((f) => f.name === 'links.json');
  const zips = alles.filter((f) => /\.zip$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, 'nl', { numeric: true }));
  if (json) {
    // Zips in de eigen opslag: links staan in links.json.
    let films = [];
    try { films = await drive(t, `files/${json.id}?alt=media`); } catch (e) { console.error('links.json lezen', e); }
    const tot = new Date(Date.parse(json.createdTime) + 30 * 864e5).toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long' });
    return res.json({ naam: voornaam(o), partner: o.Partner || '', tot, drive: diashow ? 'https://drive.google.com/drive/folders/' + diashow : '', films: Array.isArray(films) ? films : [] });
  }
  if (!zips.length && !diashow) return verlopen();
  // Zonder zips (oudere leveringen): alleen de Drive-map.
  const tot = zips.length ? new Date(Date.parse(zips[0].createdTime) + 30 * 864e5).toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long' }) : '';
  res.json({ naam: voornaam(o), partner: o.Partner || '', tot, drive: diashow ? 'https://drive.google.com/drive/folders/' + diashow : '',
    films: zips.map((z) => ({ naam: z.name.replace(/\.zip$/i, '').replace(/^.* – (Film \d+)/, '$1').replace(/^.* – Klaar voor diashow$/, 'Alle foto’s en filmpjes'), mb: Math.max(1, Math.round((+z.size || 0) / 1e6)), url: zipUrl(z.id) })) });
}

// Eén voorbeeldplaatje (klein, via Drive-thumbnail). Alleen met een geldige handtekening per bestand.
async function voorbeeld(req, res) {
  const id = String(req.query.d || ''), sig = String(req.query.t || '');
  if (!/^[\w-]{10,}$/.test(id) || sig.length !== 16 || !check('voorbeeld:' + id, sig)) return fail(res, 403, 'Ongeldig');
  try {
    const t = await googleToken();
    const meta = await drive(t, `files/${id}?fields=thumbnailLink`);
    if (!meta.thumbnailLink) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); }
    const r = await fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s400'), { headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok) return res.status(404).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('Voorbeeld', e);
    res.status(404).end();
  }
}
