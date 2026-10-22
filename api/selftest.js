// TIJDELIJK: test de Google Drive-keten in de preview. Wordt na de test verwijderd.
import { ROOT_NAME, googleToken, drive, folder } from './_lib.js';

export default async (req, res) => {
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).end();
  const out = { env: {} };
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'UPLOAD_SECRET', 'ADMIN_PASSWORD'])
    out.env[k] = !!process.env[k];
  try {
    const t = await googleToken();
    out.token = 'ok';
    const info = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + t).then((r) => r.json());
    out.scope = info.scope;
    const root = await folder(t, ROOT_NAME);
    const test = await folder(t, '_selftest', root);
    out.folders = 'ok';
    const origin = 'https://' + req.headers.host;
    const body = 'test';
    const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'image/jpeg', 'X-Upload-Content-Length': String(body.length), Origin: origin },
      body: JSON.stringify({ name: 'selftest.jpg', parents: [test] }),
    });
    const url = init.headers.get('location');
    out.resumable = init.ok && url ? 'ok' : 'fout ' + init.status + ' ' + (await init.text()).slice(0, 200);
    if (url) {
      const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
      out.cors = { status: pre.status, allowOrigin: pre.headers.get('access-control-allow-origin'), allowMethods: pre.headers.get('access-control-allow-methods') };
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Origin: origin }, body });
      const pj = await put.json().catch(() => ({}));
      out.put = put.ok ? 'ok' : 'fout ' + put.status;
      out.putAllowOrigin = put.headers.get('access-control-allow-origin');
      if (pj.id) await drive(t, 'files/' + pj.id, { method: 'DELETE' }).catch(() => fetch('https://www.googleapis.com/drive/v3/files/' + pj.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }));
    }
    await fetch('https://www.googleapis.com/drive/v3/files/' + test, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
    out.opgeruimd = 'ok';
  } catch (e) {
    out.fout = String(e.message || e).slice(0, 400);
  }
  res.json(out);
};
