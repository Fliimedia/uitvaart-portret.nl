// Daan maakt hiermee een persoonlijke uploadlink. Beveiligd met ADMIN_PASSWORD.
import crypto from 'crypto';
import { sign, fail } from './_lib.js';

export default function handler(req, res) {
  return linkHandler(req, res);
}

const linkHandler = (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const { wachtwoord, naam } = req.body || {};
  const ok = typeof wachtwoord === 'string' && process.env.ADMIN_PASSWORD &&
    wachtwoord.length === process.env.ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(wachtwoord), Buffer.from(process.env.ADMIN_PASSWORD));
  if (!ok) return fail(res, 401, 'Onjuist wachtwoord');

  const slug = String(naam || 'klant').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'klant';
  const code = slug + '-' + crypto.randomBytes(4).toString('hex');
  const link = `https://${req.headers.host}/upload.html?c=${encodeURIComponent(code)}&s=${sign(code)}`;
  res.json({ code, link });
};
