/* Reviews: vul REVIEWS met échte reviews (bijv. overgenomen van Google, met toestemming).
   Zolang de lijst leeg is, blijft de sectie verborgen. */
(function () {
  var REVIEWS = [
    // { tekst: 'Een prachtige film, precies wie mijn moeder was.', naam: 'Marieke', plaats: 'Amsterdam' },
  ];
  var GOOGLE_REVIEWS_URL = ''; // link naar je Google-bedrijfsprofiel (reviews)

  var sec = document.querySelector('[data-reviews]');
  if (!sec || !REVIEWS.length) return;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var cards = REVIEWS.slice(0, 3).map(function (r) {
    return '<figure style="margin:0;padding:36px;border-radius:20px;background:#FBF8F3;border:1px solid #E2D9CC;display:flex;flex-direction:column;gap:18px">' +
      '<span aria-label="5 sterren" style="color:#B5895E;letter-spacing:3px;font-size:16px">★★★★★</span>' +
      '<blockquote style="margin:0;font-family:\'Newsreader\',Georgia,serif;font-size:22px;line-height:1.45;color:#25292A">“' + esc(r.tekst) + '”</blockquote>' +
      '<figcaption style="font-size:15px;color:#4A4F4C">' + esc(r.naam) + (r.plaats ? ', ' + esc(r.plaats) : '') + '</figcaption></figure>';
  }).join('');
  sec.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:14px;max-width:720px">' +
    '<span style="font-size:13px;font-weight:600;letter-spacing:2.6px;color:#8E5F44">ERVARINGEN</span>' +
    '<h2 style="margin:0;font-family:\'Newsreader\',Georgia,serif;font-weight:300;font-size:52px;line-height:1.06;letter-spacing:-1px;color:#25292A">Wat families zeggen.</h2></div>' +
    '<div style="display:grid;grid-template-columns:repeat(' + Math.min(REVIEWS.length, 3) + ',minmax(0,1fr));gap:24px">' + cards + '</div>' +
    (GOOGLE_REVIEWS_URL ? '<a href="' + esc(GOOGLE_REVIEWS_URL) + '" target="_blank" rel="noopener" style="align-self:flex-start;font-size:16px;color:#25292A">Alle reviews op Google →</a>' : '');
  sec.hidden = false;
})();
