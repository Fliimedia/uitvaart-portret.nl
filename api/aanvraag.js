// Vercel-functie: ontvangt het leadformulier en mailt het via Resend.
// Vereist env var RESEND_API_KEY (zet de Resend-integratie in Vercel automatisch).
// Optioneel: MAIL_TO en MAIL_FROM.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false });
  }

  var b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  // Honeypot: bots vullen dit veld in. Doe alsof het gelukt is.
  if (b.botcheck) return res.status(200).json({ success: true });

  function clean(v, max) { return String(v || '').trim().slice(0, max); }
  var naam = clean(b.naam, 200);
  var contact = clean(b.contact, 200);
  var datum = clean(b.datum_uitvaart, 40);
  var bericht = clean(b.bericht, 5000);
  var pagina = clean(b.pagina, 200);

  if (!naam || !contact) return res.status(400).json({ success: false, message: 'Naam en contactgegevens zijn verplicht.' });

  var text = [
    'Nieuwe aanvraag via uitvaart-portret.nl', '',
    'Naam: ' + naam,
    'Telefoon/e-mail: ' + contact,
    'Datum uitvaart: ' + (datum || '-'),
    'Pagina: ' + (pagina || '-'), '',
    'Bericht:', bericht || '-'
  ].join('\n');

  var payload = {
    from: process.env.MAIL_FROM || 'uitvaart-portret.nl <aanvraag@uitvaart-portret.nl>',
    to: [process.env.MAIL_TO || 'info@uitvaart-portret.nl'],
    subject: 'Nieuwe aanvraag van ' + naam,
    text: text
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) payload.reply_to = contact;

  try {
    var r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      console.error('Resend fout', r.status, await r.text());
      return res.status(502).json({ success: false });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false });
  }
};
