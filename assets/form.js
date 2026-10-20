/* Leadformulier: verstuurt via Web3Forms en meet een Google Ads-conversie na een gelukte verzending. */
(function () {
  var ACCESS_KEY = 'WEB3FORMS_KEY_HIER';
  var CONVERSION = 'AW-18526777996/_Q6pCIrooaMdEIzloIJF';

  document.querySelectorAll('form[data-leadform]').forEach(function (form) {
    // Honeypot tegen spambots: onzichtbaar veld dat mensen leeg laten.
    var hp = document.createElement('input');
    hp.type = 'checkbox';
    hp.name = 'botcheck';
    hp.tabIndex = -1;
    hp.setAttribute('aria-hidden', 'true');
    hp.style.display = 'none';
    form.appendChild(hp);

    var status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.cssText = 'margin:0;font-size:16px;line-height:1.5';
    form.appendChild(status);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Bezig met versturen…';
      status.textContent = '';

      var data = new FormData(form);
      data.append('access_key', ACCESS_KEY);
      data.append('subject', 'Nieuwe aanvraag via uitvaart-portret.nl');
      data.append('from_name', 'uitvaart-portret.nl');
      data.append('pagina', location.pathname);

      fetch('https://api.web3forms.com/submit', { method: 'POST', body: data, headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.success) throw new Error(res.message || 'mislukt');
          if (typeof gtag === 'function') {
            gtag('event', 'conversion', { send_to: CONVERSION, value: 1.0, currency: 'EUR' });
          }
          form.reset();
          btn.textContent = 'Verstuurd';
          status.textContent = 'Dank u wel. Uw bericht is ontvangen; Daan neemt zo snel mogelijk contact met u op.';
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = label;
          status.textContent = 'Het versturen is niet gelukt. Mail of bel ons gerust direct via info@uitvaart-portret.nl.';
        });
    });
  });
})();
