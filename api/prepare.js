// Maakt (of vindt) de klantmap met vier fasemappen in Drive en geeft ondertekende map-id's terug.
const { ROOT_NAME, FASES, sign, check, googleToken, folder, fail } = require('./_lib');

module.exports = async (req, res) => {
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
    res.json({ folders });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Opslag niet bereikbaar');
  }
};
