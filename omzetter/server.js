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
import sharp from 'sharp';
import exifr from 'exifr';

const run = promisify(execFile);
const W = 1920, H = 1080;
const NR = [1, 2, 3, 4, 6, 9]; // prefix per vak: Jeugd, Jong volwassen, Gezin en werk, Later, Hobby en typisch, Weet ik niet
const LATER = 3;

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
export async function verwerk(o) {
  const d = drive(o);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'omzet-'));
  const fouten = [];
  let aantal = 0;
  try {
    for (const f of await d.lijst(o.diashow)) await d.weg(f.id); // opnieuw proberen: map eerst leeg
    // 1. Alles ophalen en dateren
    const perFase = [];
    const muziek = [];
    for (let fi = 0; fi < o.fases.length; fi++) {
      const files = (await d.lijst(o.fases[fi].id)).sort((a, b) => a.name.localeCompare(b.name, 'nl', { numeric: true }) || a.createdTime.localeCompare(b.createdTime));
      const lijst = [];
      for (const f of files) {
        if (f.mimeType.startsWith('audio/') || /^MUZIEK/.test(f.name)) muziek.push(f);
        else if (/^(image|video)\//.test(f.mimeType) || isHeic(f)) lijst.push({ f, fase: fi });
      }
      perFase.push(lijst);
    }
    const alles = perFase.flat();
    await pool(alles, 3, async (x, k) => {
      x.bestand = path.join(tmp, 'in' + k + path.extname(x.f.name).toLowerCase());
      try { await d.haal(x.f.id, x.bestand); x.datum = await datum(x.f, x.bestand, x.fase); }
      catch (e) { x.mis = true; fouten.push(x.f.name); console.error('Ophalen', x.f.name, e.message); }
    });
    // 2. Volgorde: portret eerst, dan per vak op datum (zonder datum: eigen plek)
    const portret = alles.filter((x) => !x.mis && /PORTRET/.test(x.f.name));
    const rest = perFase.map((l) => sorteer(l.filter((x) => !x.mis && !/PORTRET/.test(x.f.name))));
    let nr = 0;
    const plan = [...portret.map((x) => ({ x, naam: '0-000 portret' })),
      ...rest.flatMap((l, fi) => l.map((x) => ({ x, naam: NR[fi] + '-' + String(++nr).padStart(3, '0') })))];
    // 3. Omzetten en terugzetten (foto's 3 tegelijk, video's 1 tegelijk)
    const doe = async ({ x, naam }) => {
      const vid = x.f.mimeType.startsWith('video/');
      const uit = path.join(tmp, naam.replace(/\W+/g, '_') + (vid ? '.mp4' : '.jpg'));
      try {
        if (vid) await video(x.bestand, uit); else await foto(x.bestand, uit, isHeic(x.f));
        await d.zet(o.diashow, naam + (vid ? '.mp4' : '.jpg'), vid ? 'video/mp4' : 'image/jpeg', uit);
        aantal++;
      } catch (e) { fouten.push(x.f.name); console.error('Omzetten', x.f.name, e.message); }
      await fs.rm(uit, { force: true }); await fs.rm(x.bestand, { force: true });
    };
    await pool(plan.filter((p) => !p.x.f.mimeType.startsWith('video/')), 3, doe);
    await pool(plan.filter((p) => p.x.f.mimeType.startsWith('video/')), 1, doe);
    // 4. Muziek en MUZIEK.txt erbij (kopie in Drive, zonder downloaden)
    for (const [k, f] of muziek.entries()) {
      try { await d.kopieer(f.id, o.diashow, 'muziek ' + (k + 1) + ' - ' + f.name.replace(/^MUZIEK \d+ - /, '')); } catch (e) { fouten.push(f.name); }
    }
    for (const f of (await d.lijst(o.klant)).filter((x) => x.name === 'MUZIEK.txt')) { try { await d.kopieer(f.id, o.diashow, 'MUZIEK.txt'); } catch (e) {} }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  const r = await fetch(o.terug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'omgezet', job: o.job, aantal, fouten }) });
  console.log('Klaar', o.code, aantal, 'omgezet,', fouten.length, 'fouten, terugmelding', r.status);
}

// ---------- Webserver ----------
const TOEGESTAAN = /^https:\/\/(www\.)?uitvaart-portret\.nl\/api\/link$/;
if (!process.env.OMZET_TEST) http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/omzetten') {
    let body = '';
    for await (const stuk of req) { body += stuk; if (body.length > 1e5) break; }
    let o;
    try { o = JSON.parse(body); } catch (e) { res.writeHead(400).end('Ongeldig'); return; }
    if (!o.job || !TOEGESTAAN.test(o.terug || '') || !o.diashow || !Array.isArray(o.fases)) { res.writeHead(400).end('Ongeldig'); return; }
    res.writeHead(202).end('Bezig');
    verwerk(o).catch((e) => console.error('Opdracht mislukt', o.code, e));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Omzetserver uitvaart-portret.nl');
}).listen(process.env.PORT || 8080, () => console.log('Omzetserver luistert'));
