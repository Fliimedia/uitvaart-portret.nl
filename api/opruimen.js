// Dagelijkse opruimtaak (Vercel Cron): verplaatst aangeleverde foto's 30 dagen na upload naar de prullenbak van Drive.
// De akkoordverklaring en het opdrachtenoverzicht blijven bewaard. Drive leegt de prullenbak zelf na 30 dagen.
import { ROOT_NAME, FASES, googleToken, drive, folder, fail, logVeilig, nu } from './_lib.js';

const DAGEN = 30;

export default async function handler(req, res) {
  const geheim = process.env.CRON_SECRET;
  if (geheim ? req.headers.authorization !== `Bearer ${geheim}` : !String(req.headers['user-agent']).includes('vercel-cron')) {
    return fail(res, 401, 'Niet toegestaan');
  }
  const grens = new Date(Date.now() - DAGEN * 864e5).toISOString();
  const t = await googleToken();
  const root = await folder(t, ROOT_NAME);
  const lijst = async (q) => (await drive(t, 'files?pageSize=1000&fields=files(id,name,createdTime)&q=' + encodeURIComponent(q))).files;
  const klanten = await lijst(`'${root}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const opgeruimd = [];
  for (const k of klanten) {
    const fases = await lijst(`'${k.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const oud = fases.filter((f) => FASES.includes(f.name) && f.createdTime < grens);
    for (const f of oud) {
      await drive(t, `files/${f.id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
    }
    if (oud.length) {
      opgeruimd.push(k.name);
      await logVeilig(k.name, { Notities: `Foto's opgeruimd ${nu()}` });
    }
  }
  console.log('Opgeruimd:', opgeruimd);
  res.json({ ok: true, opgeruimd });
}
