// Omzetserver voor de verzamellink van uitvaart-portret.nl (draait op Google Cloud Run, regio EU).
// Na betaling stuurt de website een opdracht. De server haalt de bestanden uit Google Drive, zet ze om naar
// hetzelfde formaat (JPEG en mp4, 1920x1080, rechtgezet, doorgenummerd) en zet ze in de map 'Klaar voor diashow'.
// Geen geheimen nodig: de toegang tot Drive komt per opdracht van de website, met een verlopende, ondertekende opdracht.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import exifr from 'exifr';

const run = promisify(execFile);
const W = 1920, H = 1080;
const NR = [1, 2, 3, 4, 6, 9]; // prefix per vak: Jeugd, Jong volwassen, Gezin en werk, Later, Hobby en typisch, Weet ik niet
const LATER = 3;
const LABEL = ['Jeugd', 'Jong volwassen', 'Gezin en werk', 'Later', 'Hobby', 'Periode onbekend']; // in de bestandsnamen
// Zips voor de downloadpagina in Google Cloud Storage (privé). De server geeft ze zelf door via /zip/<sleutel>/<naam>.zip;
// de sleutel is lang en willekeurig. De bucket wist alles na 31 dagen (lifecycle).
const BUCKET = process.env.ZIP_BUCKET || 'up-downloads-783697177718';
async function gcsToken() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('Geen GCS-token ' + r.status);
  return (await r.json()).access_token;
}
async function naarBucket(pad, object) {
  const { size } = await fs.stat(pad);
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(object)}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + (await gcsToken()), 'Content-Type': 'application/zip', 'Content-Length': String(size) },
    body: createReadStream(pad), duplex: 'half' });
  if (!r.ok) throw new Error('Bucket ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return size;
}

// ---------- Omzetten ----------
const isHeic = (f) => /^image\/hei[cf]/.test(f.mimeType) || /\.(heic|heif)$/i.test(f.name);
const vult = (r) => r >= 1.45 && r <= 1.95; // liggend ~3:2 tot 16:9: bijsnijden; anders heel laten met wazige achtergrond

export async function foto(invoer, uit, heic) {
  let bron = invoer;
  if (heic) { bron = invoer + '.jpg'; await run('heif-convert', ['-q', '95', invoer, bron]); }
  const meta = await sharp(bron).metadata();
  const draai = (meta.orientation || 1) >= 5;
  const r = draai ? meta.height / meta.width : meta.width / meta.height;
  const basis = () => sharp(bron, { failOn: 'none' }).rotate();
  if (vult(r)) {
    await basis().resize(W, H, { fit: 'cover' }).jpeg({ quality: 90, mozjpeg: true }).toFile(uit);
  } else {
    const achter = await basis().resize(W, H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.75 }).toBuffer();
    const voor = await basis().resize(W, H, { fit: 'inside' }).toBuffer();
    await sharp(achter).composite([{ input: voor, gravity: 'center' }]).jpeg({ quality: 90, mozjpeg: true }).toFile(uit);
  }
  if (bron !== invoer) await fs.rm(bron, { force: true });
}

async function probe(invoer) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,color_transfer:stream_side_data=rotation:stream_tags=rotate,creation_time:format_tags=creation_time',
    '-of', 'json', invoer]);
  const j = JSON.parse(stdout), s = (j.streams || [])[0] || {};
  const rot = Math.abs(+((s.side_data_list || []).find((x) => 'rotation' in x)?.rotation ?? (s.tags || {}).rotate ?? 0));
  const draai = rot === 90 || rot === 270;
  const datum = Date.parse((s.tags || {}).creation_time || ((j.format || {}).tags || {}).creation_time || '') || 0;
  return { w: draai ? s.height : s.width, h: draai ? s.width : s.height, hdr: /arib-std-b67|smpte2084/.test(s.color_transfer || ''), datum };
}

export async function video(invoer, uit) {
  const p = await probe(invoer);
  const tm = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,';
  const graaf = (hdr) => {
    const v = '[0:v]' + (hdr ? tm : '');
    return vult(p.w / p.h)
      ? `${v}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v]`
      : `${v}split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:2,eq=brightness=-0.08[bg];` +
        `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`;
  };
  const args = (hdr) => ['-y', '-v', 'error', '-i', invoer, '-filter_complex', graaf(hdr), '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '25',
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', uit];
  try { await run('ffmpeg', args(p.hdr), { maxBuffer: 1e8 }); }
  catch (e) { if (!p.hdr) throw e; await run('ffmpeg', args(false), { maxBuffer: 1e8 }); } // tonemapping niet gelukt: zonder
}

// ---------- Automatische diashow (optie bij de verzamellink) ----------
// Vorm (Daan, 29-10): eerste foto 5 s zonder muziek, bij de tweede foto begint de muziek; de foto's daarna delen
// precies de lengte van de muziek (minimaal 5 s per foto). Zachte overgangen tussen alle foto's, geen fade van of
// naar zwart. De laatste foto vloeit naar zwart-wit en blijft zo staan. Alleen foto's (filmpjes niet).
const KOP = 5, OVER = 1, MIN = 5, LANG = 12;
async function duur(bestand) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', bestand]);
  return parseFloat(stdout) || 0;
}
// Ook gebruikt door de site (zelfde regels): te veel foto's = minder dan 5 s per foto; te lang = meer dan 12 s per foto.
export function diashowPlan(nFotos, muziekDuur) {
  if (nFotos < 2 || !(muziekDuur > 0)) return null;
  const rest = nFotos - 1, exact = muziekDuur / rest;
  const per = Math.max(MIN, exact);
  return { duren: [KOP, ...Array(rest).fill(per)], totaal: KOP + rest * per, perFoto: per, muziekDuur,
    teKort: exact < MIN, teLang: exact > LANG, maxFotos: 1 + Math.floor(muziekDuur / MIN) };
}
export async function diashow(fotos, muziek, uit, tmp) {
  const lengtes = []; for (const m of muziek) lengtes.push(await duur(m));
  const p = diashowPlan(fotos.length, lengtes.reduce((a, b) => a + b, 0));
  if (!p) throw new Error('Te weinig foto\'s of geen muziek');
  const n = fotos.length, args = ['-y', '-v', 'error'];
  fotos.forEach((f, i) => args.push('-loop', '1', '-framerate', '25', '-t', String(p.duren[i] + (i < n - 1 ? OVER : 0)), '-i', f));
  muziek.forEach((m) => args.push('-i', m));
  const g = [];
  fotos.forEach((f, i) => {
    let v = `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
    // Laatste foto: verzadiging van 1 naar 0 in 2 s (nooit boven 1, anders gaan de kleuren raar doen), dan zwart-wit blijven staan.
    if (i === n - 1) { const d = p.duren[i], a = Math.max(OVER, d - 4.5); v += `,hue=s='clip(1-(t-${a.toFixed(2)})/2,0,1)'`; }
    g.push(v + `[v${i}]`);
  });
  let laatste = 'v0', offset = 0;
  for (let i = 1; i < n; i++) {
    offset += p.duren[i - 1];
    g.push(`[${laatste}][v${i}]xfade=transition=fade:duration=${OVER}:offset=${offset.toFixed(3)}[x${i}]`);
    laatste = 'x' + i;
  }
  const a = muziek.map((_, k) => `[${n + k}:a]`).join('');
  g.push(`${a}concat=n=${muziek.length}:v=0:a=1,aresample=48000,adelay=${KOP * 1000}:all=1,apad,atrim=0:${p.totaal.toFixed(3)}[a]`);
  const script = path.join(tmp, 'diashow-' + crypto.randomBytes(4).toString('hex') + '.txt');
  await fs.writeFile(script, g.join(';\n'));
  try {
    await run('ffmpeg', [...args, '-filter_complex_script', script, '-map', `[${laatste}]`, '-map', '[a]', '-t', p.totaal.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', uit], { maxBuffer: 1e8 });
  } finally { await fs.rm(script, { force: true }); }
  return p;
}

// Opnamedatum. Gefotografeerde afdrukken (AFDRUK) en datums van de laatste 7 dagen (behalve in 'Later') tellen niet.
async function datum(f, bestand, fase) {
  if (/AFDRUK/.test(f.name)) return 0;
  let t = 0;
  try {
    if (f.mimeType.startsWith('video/')) t = (await probe(bestand)).datum;
    else { const e = await exifr.parse(bestand); const d = e && (e.DateTimeOriginal || e.CreateDate); t = d instanceof Date ? d.getTime() : 0; }
  } catch (e) { t = 0; }
  if (!t || t < Date.UTC(1900, 0, 1)) return 0;
  if (fase !== LATER && t > Date.now() - 7 * 864e5) return 0;
  return t;
}

// Foto's met een datum wisselen onderling van plek; foto's zonder datum houden hun plek.
export function sorteer(lijst) {
  const plek = [], met = [];
  lijst.forEach((x, k) => { if (x.datum) { plek.push(k); met.push(x); } });
  met.sort((a, b) => a.datum - b.datum);
  const uit = lijst.slice();
  plek.forEach((k, n) => { uit[k] = met[n]; });
  return uit;
}

// ---------- Google Drive ----------
function drive(opdracht) {
  let token = '', tot = 0;
  const geefToken = async () => {
    if (token && Date.now() < tot) return token;
    const r = await fetch(opdracht.terug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'token', job: opdracht.job }) });
    if (!r.ok) throw new Error('Geen toegang: ' + r.status);
    token = (await r.json()).token; tot = Date.now() + 40 * 60e3; return token;
  };
  const api = async (pad, opts = {}) => {
    const r = await fetch('https://www.googleapis.com/drive/v3/' + pad, { ...opts, headers: { Authorization: 'Bearer ' + (await geefToken()), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('Drive ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return r.status === 204 ? {} : r.json();
  };
  return {
    async lijst(map) {
      const uit = []; let pagina = '';
      do {
        const j = await api('files?pageSize=1000&fields=nextPageToken,files(id,name,mimeType,size,createdTime)&q=' +
          encodeURIComponent(`'${map}' in parents and trashed=false`) + (pagina ? '&pageToken=' + pagina : ''));
        uit.push(...j.files); pagina = j.nextPageToken || '';
      } while (pagina);
      return uit;
    },
    async haal(id, naar) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: 'Bearer ' + (await geefToken()) } });
      if (!r.ok) throw new Error('Download ' + r.status);
      const fh = await fs.open(naar, 'w');
      try { for await (const stuk of r.body) await fh.write(stuk); } finally { await fh.close(); }
    },
    async zet(map, naam, mime, bestand) {
      const { size } = await fs.stat(bestand);
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'POST', headers: { Authorization: 'Bearer ' + (await geefToken()), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
        body: JSON.stringify({ name: naam, parents: [map] }) });
      const url = r.headers.get('location');
      if (!r.ok || !url) throw new Error('Upload start ' + r.status);
      const u = await fetch(url, { method: 'PUT', headers: { 'Content-Length': String(size), 'Content-Type': mime }, body: createReadStream(bestand), duplex: 'half' });
      if (!u.ok) throw new Error('Upload ' + u.status);
      return ((await u.json().catch(() => ({}))) || {}).id || '';
    },
    kopieer: (id, map, naam) => api(`files/${id}/copy?fields=id`, { method: 'POST', body: JSON.stringify({ name: naam, parents: [map] }) }),
    weg: (id) => api(`files/${id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) }),
  };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// ---------- De opdracht ----------
// Eén film: de vakken van die film ophalen, op volgorde zetten, omzetten en in zijn diashowmap zetten.
// zipMap: als die er is, blijven de omgezette bestanden (en de muziek) daar staan voor de zip van deze film.
async function verwerkFilm(d, tmp, film, fouten, zipMap, opdrachtNaam, wilDiashow) {
  let aantal = 0;
  const MAP = 'application/vnd.google-apps.folder';
  for (const f of await d.lijst(film.diashow)) if (f.mimeType !== MAP) await d.weg(f.id); // opnieuw proberen: map eerst leeg
  // 1. Alles ophalen en dateren
  const perFase = [];
  const muziek = [];
  for (let fi = 0; fi < film.fases.length; fi++) {
    const files = (await d.lijst(film.fases[fi].id)).sort((a, b) => a.name.localeCompare(b.name, 'nl', { numeric: true }) || a.createdTime.localeCompare(b.createdTime));
    const lijst = [];
    for (const f of files) {
      if (f.mimeType.startsWith('audio/') || /^MUZIEK/.test(f.name)) muziek.push(f);
      else if (/^(image|video)\//.test(f.mimeType) || isHeic(f)) lijst.push({ f, fase: fi });
    }
    perFase.push(lijst);
  }
  // Map 'Muziek' van deze film (Daan zet hier een mp3 als de familie alleen een titel gaf).
  if (film.muziek) for (const f of (await d.lijst(film.muziek)).sort((a, b) => a.name.localeCompare(b.name, 'nl', { numeric: true })))
    if (f.mimeType.startsWith('audio/')) muziek.push(f);
  const alles = perFase.flat();
  const pre = 'f' + (film.nr || 1) + '-';
  await pool(alles, 3, async (x, k) => {
    x.bestand = path.join(tmp, pre + 'in' + k + path.extname(x.f.name).toLowerCase());
    try { await d.haal(x.f.id, x.bestand); x.datum = await datum(x.f, x.bestand, x.fase); }
    catch (e) { x.mis = true; fouten.push(x.f.name); console.error('Ophalen', x.f.name, e.message); }
  });
  // 2. Volgorde: portret eerst, dan per vak op datum (zonder datum: eigen plek)
  const portret = alles.filter((x) => !x.mis && /PORTRET/.test(x.f.name));
  const rest = perFase.map((l) => sorteer(l.filter((x) => !x.mis && !/PORTRET/.test(x.f.name))));
  let nr = 0;
  // Namen: '001 portret', '002 Jeugd', … doorlopend genummerd, zodat sorteren op naam de volgorde geeft.
  const plan = [...portret.map((x) => ({ x, naam: String(++nr).padStart(3, '0') + ' portret' })),
    ...rest.flatMap((l, fi) => l.map((x) => ({ x, naam: String(++nr).padStart(3, '0') + ' ' + LABEL[fi] })))];
  // 3. Omzetten en terugzetten (foto's 3 tegelijk, video's 1 tegelijk)
  const doe = async ({ x, naam }) => {
    const vid = x.f.mimeType.startsWith('video/');
    const uit = path.join(tmp, pre + naam.replace(/\W+/g, '_') + (vid ? '.mp4' : '.jpg'));
    try {
      if (vid) await video(x.bestand, uit); else await foto(x.bestand, uit, isHeic(x.f));
      await d.zet(film.diashow, naam + (vid ? '.mp4' : '.jpg'), vid ? 'video/mp4' : 'image/jpeg', uit);
      aantal++;
      if (zipMap) { await fs.rename(uit, path.join(zipMap, naam + (vid ? '.mp4' : '.jpg'))); }
    } catch (e) { fouten.push(x.f.name); console.error('Omzetten', x.f.name, e.message); }
    await fs.rm(uit, { force: true }); await fs.rm(x.bestand, { force: true });
  };
  await pool(plan.filter((p) => !p.x.f.mimeType.startsWith('video/')), 3, doe);
  await pool(plan.filter((p) => p.x.f.mimeType.startsWith('video/')), 1, doe);
  // 4. Muziek en MUZIEK.txt erbij (kopie in Drive, zonder downloaden)
  for (const [k, f] of muziek.entries()) {
    const naam = 'muziek ' + (k + 1) + ' - ' + f.name.replace(/^MUZIEK \d+ - /, '');
    try { await d.kopieer(f.id, film.diashow, naam); } catch (e) { fouten.push(f.name); }
    if (zipMap) try { await d.haal(f.id, path.join(zipMap, naam.replace(/[\/\\]/g, '_'))); } catch (e) {}
  }
  // Muziek die de familie alleen als titel of link opgaf: één leesbaar bestand (zonder interne codes).
  const regels = [];
  for (const f of (await d.lijst(film.map)).filter((x) => x.name === 'MUZIEK.txt')) {
    try {
      const p = path.join(tmp, 'muziek-' + f.id + '.txt'); await d.haal(f.id, p);
      const t = (await fs.readFile(p, 'utf8')).split('Muziek:')[1] || ''; await fs.rm(p, { force: true });
      for (const x of t.split('\n').map((y) => y.trim()).filter(Boolean)) if (!/^Bestand: /.test(x) && !regels.includes(x)) regels.push(x);
    } catch (e) {}
  }
  if (regels.length) {
    const p = path.join(zipMap || tmp, 'Muziek – lees dit.txt');
    await fs.writeFile(p, `Muziek voor de film${film.naam ? ' ' + film.naam : ''}${opdrachtNaam ? ' van ' + opdrachtNaam : ''}:\n\n${regels.map((x) => x.replace(/^\d+\.\s*/, '- ')).join('\n')}\n\nStaat er een link bij, dan gaat het om die uitvoering.\n`);
    try { await d.zet(film.diashow, 'Muziek – lees dit.txt', 'text/plain', p); } catch (e) {}
    if (!zipMap) await fs.rm(p, { force: true });
  }
  // 5. Optie: kant-en-klare diashow op de muziek (alleen met een muziekbestand; anders maakt Daan hem met de hand).
  let ds;
  if (wilDiashow && zipMap) {
    const inMap = (await fs.readdir(zipMap)).sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));
    const fotos = inMap.filter((x) => /^\d{3} .*\.jpg$/.test(x)).map((x) => path.join(zipMap, x));
    const audio = inMap.filter((x) => /^muziek \d+ - /.test(x)).map((x) => path.join(zipMap, x));
    if (!audio.length) ds = { nr: film.nr || 1, status: 'geen muziek', muziek: regels };
    else if (fotos.length < 2) ds = { nr: film.nr || 1, status: 'te weinig foto\'s' };
    else try {
      const naam = 'Diashow' + (film.naam ? ' – ' + film.naam.replace(/[\/\\:*?"<>|]/g, ' ') : '') + '.mp4';
      const uit = path.join(zipMap, naam);
      const p = await diashow(fotos, audio, uit, tmp);
      try { await d.zet(film.diashow, naam, 'video/mp4', uit); } catch (e) { console.error('Diashow naar Drive', e.message); }
      ds = { nr: film.nr || 1, status: 'ok', duur: Math.round(p.totaal), perFoto: Math.round(p.perFoto * 10) / 10, teKort: p.teKort, teLang: p.teLang, fotos: fotos.length, maxFotos: p.maxFotos };
    } catch (e) { console.error('Diashow mislukt', film.nr, e.message); ds = { nr: film.nr || 1, status: 'mislukt' }; }
  }
  return { aantal, ds, muziek: muziek.length };
}

// Meerdere films (familie, vrienden, werk): o.films = [{ nr, naam, map, fases, diashow }]. Oude opdrachten: één film.
export async function verwerk(o) {
  const d = drive(o);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'omzet-'));
  const fouten = [];
  let aantal = 0;
  const films = Array.isArray(o.films) && o.films.length ? o.films : [{ nr: 1, map: o.klant, fases: o.fases, diashow: o.diashow }];
  const zips = [], diashows = [];
  let muziekBestanden = 0;
  try {
    if (films.length > 1) for (const f of await d.lijst(o.diashow)) if (f.mimeType !== 'application/vnd.google-apps.folder') await d.weg(f.id); // resten van een eerdere enkele film
    if (o.downloads) for (const f of await d.lijst(o.downloads)) await d.weg(f.id); // oude zips weg
    for (const film of films) {
      // Per film één zip (zonder extra compressie: jpg en mp4 zijn al gecomprimeerd) voor de downloadpagina.
      const label = films.length > 1 ? `Film ${film.nr || 1}` + (film.naam ? ' – ' + film.naam : '') : 'Klaar voor diashow';
      const veilig = label.replace(/[\/\\:*?"<>|]/g, ' ').trim();
      const zipMap = o.downloads ? path.join(tmp, 'zip-' + (film.nr || 1), veilig) : null;
      if (zipMap) await fs.mkdir(zipMap, { recursive: true });
      const r = await verwerkFilm(d, tmp, film, fouten, zipMap, o.naam, !!o.maakDiashow);
      aantal += r.aantal; muziekBestanden += r.muziek || 0; if (r.ds) diashows.push(r.ds);
      if (!zipMap) continue;
      try {
        const zipNaam = ((o.naam ? o.naam + ' – ' : '') + veilig).replace(/[\/\\:*?"<>|]/g, ' ').trim() + '.zip';
        const zipPad = path.join(tmp, 'film-' + (film.nr || 1) + '.zip');
        await run('zip', ['-0', '-r', '-q', zipPad, veilig], { cwd: path.dirname(zipMap), maxBuffer: 1e7 });
        const { size } = await fs.stat(zipPad);
        // Eerst de eigen opslag (geen tussenscherm van Google); lukt dat niet, dan als bestand in Drive.
        try {
          const sleutel = crypto.randomBytes(12).toString('hex');
          await naarBucket(zipPad, sleutel + '/' + zipNaam);
          zips.push({ nr: film.nr || 1, naam: film.naam || '', pad: '/zip/' + sleutel + '/' + encodeURIComponent(zipNaam), size });
        } catch (e) {
          console.error('Bucket mislukt, val terug op Drive', o.code, e.message);
          const id = await d.zet(o.downloads, zipNaam, 'application/zip', zipPad);
          zips.push({ nr: film.nr || 1, naam: film.naam || '', id, size });
        }
        await fs.rm(path.dirname(zipMap), { recursive: true, force: true }); await fs.rm(zipPad, { force: true });
      } catch (e) { console.error('Zip mislukt', o.code, film.nr, e.message); }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  const r = await fetch(o.terug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'omgezet', job: o.job, aantal, fouten, zips, diashows, muziekBestanden }) });
  console.log('Klaar', o.code, films.length, 'film(s),', aantal, 'omgezet,', fouten.length, 'fouten,', diashows.length, 'diashow(s), terugmelding', r.status);
}

// ---------- Webserver ----------
const TOEGESTAAN = /^https:\/\/(www\.)?uitvaart-portret\.nl\/api\/link$/;
const BEZIG = new Map(); // code -> starttijd: dezelfde opdracht nooit twee keer tegelijk
if (!process.env.OMZET_TEST) http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/omzetten') {
    let body = '';
    for await (const stuk of req) { body += stuk; if (body.length > 3e5) break; }
    let o;
    try { o = JSON.parse(body); } catch (e) { res.writeHead(400).end('Ongeldig'); return; }
    if (!o.job || !TOEGESTAAN.test(o.terug || '') || !o.diashow || !Array.isArray(o.fases)) { res.writeHead(400).end('Ongeldig'); return; }
    if (BEZIG.has(o.code) && Date.now() - BEZIG.get(o.code) < 60 * 60e3) { res.writeHead(202).end('Al bezig'); console.log('Dubbele opdracht genegeerd', o.code); return; }
    BEZIG.set(o.code, Date.now());
    res.writeHead(202).end('Bezig');
    verwerk(o).catch((e) => console.error('Opdracht mislukt', o.code, e)).finally(() => BEZIG.delete(o.code));
    return;
  }
  // Download van een zip uit de bucket (doorgeven in stukken: geen limiet op de grootte).
  const z = req.method === 'GET' && /^\/zip\/([0-9a-f]{24})\/([^/?#]+\.zip)$/.exec(req.url || '');
  if (z) {
    try {
      const object = z[1] + '/' + decodeURIComponent(z[2]);
      const g = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(object)}?alt=media`, { headers: { Authorization: 'Bearer ' + (await gcsToken()) } });
      if (!g.ok) {
        res.writeHead(g.status === 404 ? 404 : 502, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;max-width:520px;margin:60px auto;padding:0 16px;line-height:1.5"><h2>Deze download is verlopen</h2><p>De bestanden worden na 30 dagen automatisch verwijderd. Nog nodig? Bel of app 06 18 42 48 58 of mail info@uitvaart-portret.nl.</p>');
        return;
      }
      const naam = decodeURIComponent(z[2]);
      const lengte = +g.headers.get('content-length') || 0;
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${naam.replace(/[^\x20-\x7e]/g, '-').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(naam)}`,
        'Cache-Control': 'private, no-store', ...(lengte && lengte < 30e6 ? { 'Content-Length': String(lengte) } : {}) });
      for await (const stuk of g.body) if (!res.write(stuk)) await new Promise((ok) => res.once('drain', ok));
      res.end();
    } catch (e) { console.error('Download', e.message); if (!res.headersSent) res.writeHead(502).end('Even niet beschikbaar'); else res.end(); }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Omzetserver uitvaart-portret.nl');
}).listen(process.env.PORT || 8080, () => console.log('Omzetserver luistert'));
