// Stuurt Daan een mail zodra een familie foto's heeft verstuurd, met een link naar de Drive-map.
import { Resend } from 'resend';
import { ROOT_NAME, rootMap, FASES, check, googleToken, folder, fail, nu, logVeilig, leesOpdrachten, isMail, mail as stuurMail, mailHtml, filmMappen } from './_lib.js';

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

  const telFases = (v) => (Array.isArray(v) ? v.slice(0, FASES.length).map((n) => Math.max(0, parseInt(n, 10) || 0)) : FASES.map(() => 0));
  const kort = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\|/g, '/').trim().slice(0, n);
  const leesMuziek = (f) => {
    const muziek = (Array.isArray(f.muziek) ? f.muziek : []).slice(0, 5)
      .map((m) => ({ titel: kort(m && m.titel, 200), link: kort(m && m.link, 500) }))
      .filter((m) => m.titel || m.link);
    const bestanden = (Array.isArray(f.muziekBestanden) ? f.muziekBestanden : []).slice(0, 5).map((n) => kort(n, 150));
    return muziek.map((m, i) => `${i + 1}. ${m.titel || '(geen titel)'}${m.link ? ' — ' + m.link : ''}`).concat(bestanden.map((n) => 'Bestand: ' + n));
  };
  // Meerdere films: per film foto's per vak, naam en muziek. Oude pagina's sturen één film zonder 'films'.
  const films = (Array.isArray(b.films) && b.films.length ? b.films : [{ nr: 1, naam: '', perFase: b.perFase, muziek: b.muziek, muziekBestanden: b.muziekBestanden }])
    .slice(0, 6).map((f) => ({ nr: Math.min(6, Math.max(1, parseInt(f.nr, 10) || 1)), naam: kort(f.naam, 40), perFase: telFases(f.perFase), regels: leesMuziek(f) }));
  const meer = films.some((f) => f.nr > 1) || (parseInt(b.aantalFilms, 10) || 1) > 1;
  const perFase = FASES.map((_, k) => films.reduce((a, f) => a + f.perFase[k], 0));
  const totaal = perFase.reduce((a, n) => a + n, 0);
  const ster = Math.max(0, parseInt(b.ster, 10) || 0);
  const mislukt = Math.max(0, parseInt(b.mislukt, 10) || 0);

  // Muziek: titel/artiest + optionele link, en eventuele meegestuurde bestanden (per film).
  const filmLabel = (f) => f.naam || 'Film ' + f.nr;
  const muziekRegels = films.flatMap((f) => (meer ? f.regels.map((x) => `${filmLabel(f)}: ${x}`) : f.regels));
  const muziekTekst = muziekRegels.length ? muziekRegels.join('\n') : 'NIET opgegeven';

  // Tijdstip van akkoord (vinkje op de uploadpagina), weergegeven in Nederlandse tijd.
  const t0 = Date.parse(b.akkoord);
  const akkoord = Number.isFinite(t0)
    ? new Date(t0).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'long', timeStyle: 'short' })
    : '';

  const zelf = c.startsWith('zelf-');
  let map = '';
  try {
    const t = await googleToken();
    const id = await folder(t, c, await rootMap(t));
    map = 'https://drive.google.com/drive/folders/' + id;
    if (akkoord) await bewijs(t, id, c, akkoord);
    const sub = films.some((f) => f.nr > 1) ? await filmMappen(t, id) : [];
    for (const f of films) {
      if (!f.regels.length) continue;
      const doel = f.nr === 1 ? id : (sub.find((x) => x.nr === f.nr) || {}).id;
      if (doel) await tekstbestand(t, doel, 'MUZIEK.txt', `Klant/opdracht: ${c}${meer ? '\nFilm: ' + filmLabel(f) : ''}\n\nMuziek:\n${f.regels.join('\n')}\n`);
    }
  } catch (e) {
    console.error('Drive-map of akkoordbestand mislukt', e);
  }

  // Eerdere gegevens van deze opdracht (er kunnen meerdere familieleden uploaden).
  let o = null;
  try { o = (await leesOpdrachten(await googleToken())).find((r) => r.Code === c) || null; } catch (e) { console.error('Opdracht lezen', e); }
  const eerderAantal = o ? parseInt(o["Aantal foto's"], 10) || 0 : 0;
  const nieuwTotaal = eerderAantal + totaal;

  // Bevestiging aan de familie (contactpersoon van de aanvraag), zwart op wit.
  try {
    // Verzamellink: geen mail per upload; de aanvrager ziet alles op de beheerpagina en sluit zelf af.
    if (!zelf && o && isMail(o.Contact) && totaal > 0) {
      const naamF = o.Naam || '';
      const muziekZin = muziekRegels.length ? `\n\nMuziek:\n${muziekRegels.join('\n')}` : '';
      const tekstF = `Beste ${naamF},

We hebben ${totaal} ${totaal === 1 ? 'foto' : "foto's"} ontvangen voor de fotofilm.${muziekZin}

U hoeft verder niets te doen. Willen familieleden nog foto's toevoegen? Dat kan via dezelfde link. U hoort van mij zodra het concept klaar is.

Met vriendelijke groet,
Daan Lubbers
uitvaart-portret.nl`;
      await stuurMail({ to: o.Contact.trim(), subject: "Uw foto's zijn ontvangen", text: tekstF, html: mailHtml(tekstF) });
    }
  } catch (e) { console.error('Bevestiging familie mislukt', e); }

  // Optellen bij eerdere uploads; eerder doorgegeven muziek en akkoord niet overschrijven.
  // In de sheet: muziek van film 2+ met 'Film n: ' ervoor (prepare.js leest dat terug per film).
  const muziekNieuw = films.flatMap((f) => f.regels.map((x) => (f.nr > 1 ? `Film ${f.nr}: ` : '') + x));
  const muziekLog = [o && o.Muziek && o.Muziek !== 'NIET' ? o.Muziek : '', muziekNieuw.join(' | ')].filter(Boolean).join(' | ');
  // Films-kolom: namen op positie (film 1 | film 2 | …); bestaande namen blijven staan.
  let filmsKolom = (o && o.Films) || '';
  if (meer || films.some((f) => f.naam)) {
    const namen = filmsKolom ? filmsKolom.split(' | ') : [];
    films.forEach((f) => { namen[f.nr - 1] = (namen[f.nr - 1] && !/^Film \d+$/.test(namen[f.nr - 1]) ? namen[f.nr - 1] : '') || f.naam || 'Film ' + f.nr; });
    for (let k = 0; k < namen.length; k++) namen[k] = namen[k] || 'Film ' + (k + 1);
    filmsKolom = namen.join(' | ');
  }
  const nFilms = filmsKolom ? filmsKolom.split(' | ').length : 1; // 60 foto's per film inbegrepen
  await logVeilig(c, { 'Upload ontvangen': nu(), "Aantal foto's": nieuwTotaal, "Extra foto's (boven 60)": Math.max(0, nieuwTotaal - 60 * nFilms),
    'Akkoord voorwaarden': akkoord || (o && o['Akkoord voorwaarden']) || (zelf ? 'n.v.t. (zelf maken)' : 'NIET'), 'Drive-map': map, Muziek: muziekLog || 'NIET', ...(filmsKolom ? { Films: filmsKolom } : {}) });

  const rows = [
    ['Klant', c],
    ['Totaal', `${totaal} foto's/video's` + (totaal > 60 ? ` (${totaal - 60} boven de 60)` : '')],
    ...(meer ? films.map((f) => [filmLabel(f), `${f.perFase.reduce((a, n) => a + n, 0)} foto's/video's`]) : []),
    ...(filmsKolom.includes(' | ') ? [['Films in deze opdracht', filmsKolom]] : []),
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
      subject: `${zelf ? 'Verzamellink (zelf maken)' : "Foto's ontvangen"}: ${c} (${totaal})`,
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
