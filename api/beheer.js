// Beheer voor Daan: overzicht, film uploaden, concept versturen, betaallink versturen. Beveiligd met ADMIN_PASSWORD.
import crypto from 'crypto';
import {
  fail, googleToken, nu, logOpdracht, leesOpdrachten, mail, mailHtml, isMail, waNummer,
  filmMap, nieuwsteFilm, deel, berekenBedrag, mollie, DOWNLOAD_PRIJS,
} from './_lib.js';
import { startOmzetten, beheerLink } from './link.js';

const ok = (pw) => typeof pw === 'string' && process.env.ADMIN_PASSWORD && pw.length === process.env.ADMIN_PASSWORD.length &&
  crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(process.env.ADMIN_PASSWORD));

const groet = '\n\nMet vriendelijke groet,\nDaan Lubbers\nuitvaart-portret.nl';

// Mailt de klant als er een e-mailadres is; anders een WhatsApp-link voor Daan.
async function naarKlant(order, onderwerp, tekst) {
  if (isMail(order.Contact)) {
    await mail({ to: order.Contact.trim(), subject: onderwerp, text: tekst, html: mailHtml(tekst) });
    return { verstuurd: 'mail' };
  }
  const wa = waNummer(order.Contact);
  return { verstuurd: 'nee', wa: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(tekst)}` : '', tekst };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Alleen POST');
  const b = req.body || {};
  if (!ok(b.wachtwoord)) return fail(res, 401, 'Onjuist wachtwoord');
  try {
    const t = await googleToken();
    if (b.actie === 'lijst') {
      const lijst = (await leesOpdrachten(t)).filter((o) => o.Code).reverse()
        .map((o) => (o.Pakket === 'Zelf maken' ? { ...o, Beheerlink: beheerLink(o.Code) } : o));
      return res.json({ lijst });
    }
    const order = (await leesOpdrachten(t)).find((o) => o.Code === b.code);
    if (!order) return fail(res, 404, 'Opdracht niet gevonden');
    const naam = order.Naam || '';
    // Verzamellink wordt een film: naar het tabblad Films (de €29 blijft verrekend via de kolom Download).
    if (b.actie === 'naarFilm') {
      await logOpdracht(t, order.Code, { Pakket: '', Notities: `${order.Notities ? order.Notities + '; ' : ''}Was verzamellink, wordt film ${nu()}` });
      return res.json({ ok: true, melding: 'Verplaatst naar Films.' });
    }
    // Verzamellink: omzetten starten zonder betaling (test, of als gunst/handmatige levering).
    if (b.actie === 'omzet') {
      if (!String(order.Code).startsWith('zelf-')) return fail(res, 400, 'Alleen voor verzamellinks');
      await logOpdracht(t, order.Code, { Download: 'Betaald ' + nu() + ' (handmatig vanuit beheer)' });
      await startOmzetten(t, order, { opnieuw: true }); // bewust gestart vanuit beheer
      return res.json({ ok: true, melding: 'Omzetten gestart. Binnen een paar minuten gaat de downloadmail naar ' + (order.Contact || 'de aanvrager') + '.' });
    }

    if (b.actie === 'filmStart') {
      if (!/^video\//.test(String(b.mime))) return fail(res, 400, 'Alleen videobestanden');
      const map = await filmMap(t, order.Code);
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + t, 'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': b.mime, 'X-Upload-Content-Length': String(b.size),
          Origin: req.headers.origin || 'https://' + req.headers.host,
        },
        body: JSON.stringify({ name: String(b.name).slice(0, 150), parents: [map] }),
      });
      const url = r.headers.get('location');
      if (!r.ok || !url) throw new Error('Drive ' + r.status + ': ' + (await r.text()));
      return res.json({ url });
    }

    if (b.actie === 'concept') {
      const film = await nieuwsteFilm(t, order.Code);
      if (!film) return fail(res, 400, 'Upload eerst de film');
      const link = await deel(t, film.id, false);
      const tekst = `Beste ${naam},

Het concept van de fotofilm staat klaar. U kunt hem hier bekijken:
${link}

Wilt u iets anders zien, zoals een andere volgorde, een foto erbij of eruit, of een tekst aangepast? Laat het me weten door op deze mail te antwoorden. Eén correctieronde is inbegrepen.

Bent u tevreden? Laat het me dan ook even weten. U ontvangt daarna de betaallink, en direct na betaling de film om te downloaden.${groet}`;
      const uit = await naarKlant(order, 'Het concept van uw fotofilm', tekst);
      await logOpdracht(t, order.Code, { Concept: nu() + (uit.verstuurd === 'mail' ? ' (gemaild)' : ' (zelf sturen)'), Film: link });
      return res.json({ link, ...uit });
    }

    if (b.actie === 'betaal') {
      if (!process.env.MOLLIE_API_KEY) return fail(res, 500, 'MOLLIE_API_KEY ontbreekt in Vercel');
      const extraFotos = parseInt(order["Extra foto's (boven 60)"], 10) || 0;
      const { regels, totaal } = berekenBedrag({ pakket: b.pakket, spoed: b.spoed, extraFotos,
        extraRondes: parseInt(b.extraRondes, 10) || 0, korteVersie: !!b.korteVersie,
        verrekend: /^(Betaald|Omzetten|Geleverd)/.test(order.Download || '') ? DOWNLOAD_PRIJS : 0 });
      if (!totaal) return fail(res, 400, 'Kies een pakket');
      const pl = await mollie('payment-links', { method: 'POST', body: JSON.stringify({
        description: `Fotofilm ${naam} [${order.Code}]`.slice(0, 255),
        amount: { currency: 'EUR', value: totaal.toFixed(2) },
        redirectUrl: 'https://uitvaart-portret.nl/bedankt.html',
        webhookUrl: 'https://uitvaart-portret.nl/api/mollie',
      }) });
      const href = pl._links && pl._links.paymentLink && pl._links.paymentLink.href;
      if (!href) throw new Error('Geen betaallink van Mollie: ' + JSON.stringify(pl));
      const spec = regels.map(([k, v]) => `- ${k}: €${v}`).join('\n');
      const tekst = `Beste ${naam},

Fijn dat u tevreden bent met de film. U kunt betalen via deze link:
${href}

${spec}
Totaal: €${totaal} (inclusief btw)

Direct na de betaling ontvangt u automatisch een e-mail met de link om de film te downloaden.${groet}`;
      const uit = await naarKlant(order, 'Betaling van uw fotofilm', tekst);
      await logOpdracht(t, order.Code, { Pakket: b.pakket, Bedrag: `€${totaal}`, Betaallink: pl.id });
      return res.json({ href, totaal, regels, ...uit });
    }
    return fail(res, 400, 'Onbekende actie');
  } catch (e) {
    console.error('Beheer', e);
    return fail(res, 500, String(e.message || e).slice(0, 300));
  }
}
