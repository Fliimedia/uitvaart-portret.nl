document.querySelectorAll('form.aanvraag').forEach(function (form) {
  var btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = form.querySelector('.form-msg');
    var data = Object.fromEntries(new FormData(form));
    data.pagina = location.pathname;
    btn.disabled = true; btn.textContent = 'Bezig met versturen…';
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw j; }); })
      .then(function () {
        if (typeof gtag === 'function') {
          gtag('event', 'conversion', { send_to: 'AW-18526777996/_Q6pCIrooaMdEIzloIJF', value: 1.0, currency: 'EUR' });
        }
        form.innerHTML = '<p style="margin: 0; font-family: \'Newsreader\', Georgia, serif; font-size: 28px; line-height: 1.3; color: #25292A">Dank u wel. Uw bericht is verstuurd.</p><p style="margin: 0; font-size: 17px; line-height: 1.6; color: #4A4F4C">U ontvangt zo snel mogelijk een reactie.</p>';
      })
      .catch(function (j) {
        btn.disabled = false; btn.textContent = 'Verstuur bericht';
        msg.textContent = (j && j.error) || 'Versturen lukte niet. Bel of app ons op +31 6 18 42 48 58.';
        msg.style.color = '#8E3B2F';
      });
  });
});
