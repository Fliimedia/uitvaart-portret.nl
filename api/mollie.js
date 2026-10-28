// Mollie-webhook: bij betaling wordt de film automatisch geleverd. Mollie stuurt alleen een id; we halen de status zelf op.
import { googleToken, leesOpdrachten, lever, mollie, logOpdracht, nu } from './_lib.js';
import { startOmzetten } from './link.js';

export default async function handler(req, res) {
  const id = String((req.body && req.body.id) || (req.query && req.query.id) || '');
  try {
    let betaald = false;
    let omschrijving = '';
    if (id.startsWith('pl_')) {
      const pl = await mollie('payment-links/' + id);
      betaald = !!pl.paidAt;
      omschrijving = pl.description || '';
    } else if (id.startsWith('tr_')) {
      const p = await mollie('payments/' + id);
      betaald = p.status === 'paid';
      omschrijving = p.description || '';
      // Download van de verzamellink: na betaling de omzetserver starten.
      if (p.metadata && p.metadata.soort === 'download') {
        if (betaald) {
          const t = await googleToken();
          const o = (await leesOpdrachten(t)).find((x) => x.Code === p.metadata.code);
          if (o && !/^(Omzetten|Geleverd)/.test(o.Download || '')) {
            await logOpdracht(t, o.Code, { Download: 'Betaald ' + nu() + ' (' + id + ')' });
            await startOmzetten(t, { ...o, Download: 'Betaald' });
          }
        }
        return res.status(200).send('ok');
      }
    }
    if (betaald) {
      const t = await googleToken();
      const orders = await leesOpdrachten(t);
      const code = (omschrijving.match(/\[([a-z0-9-]+)\]\s*$/) || [])[1];
      const order = orders.find((o) => (code && o.Code === code) || (id.startsWith('pl_') && o.Betaallink === id));
      if (order && !order.Betaald) await lever(t, order);
    }
  } catch (e) {
    console.error('Mollie-webhook', id, e);
  }
  res.status(200).send('ok'); // Altijd 200, anders blijft Mollie het opnieuw proberen.
}
