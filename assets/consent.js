/* Cookiebanner + Google Consent Mode v2. Standaard staat alles op 'denied' (zie <head>). */
(function () {
  var KEY = 'cookie-consent';
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  if (stored === 'granted' || stored === 'denied') return;

  function save(choice) {
    try { localStorage.setItem(KEY, choice); } catch (e) {}
    if (choice === 'granted' && typeof gtag === 'function') {
      gtag('consent', 'update', {
        ad_storage: 'granted', ad_user_data: 'granted',
        ad_personalization: 'granted', analytics_storage: 'granted'
      });
    }
    bar.remove();
  }

  var bar = document.createElement('div');
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Cookiekeuze');
  bar.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:640px;margin:0 auto;' +
    'background:#2B302D;color:#EFE9DF;border-radius:16px;padding:20px 24px;box-shadow:0 8px 32px rgba(0,0,0,.25);' +
    "font-family:'Instrument Sans','Helvetica Neue',sans-serif;font-size:15px;line-height:1.5;" +
    'display:flex;flex-wrap:wrap;align-items:center;gap:16px';

  var txt = document.createElement('p');
  txt.style.cssText = 'margin:0;flex:1 1 280px';
  txt.textContent = 'Deze site gebruikt cookies van Google om te meten hoe bezoekers via advertenties hier komen. Gaat u daarmee akkoord?';
  var more = document.createElement('a');
  more.href = '/privacyverklaring.html';
  more.textContent = 'Meer informatie';
  more.style.cssText = 'color:#EFE9DF;margin-left:6px';
  txt.appendChild(more);

  function btn(label, primary, choice) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'height:44px;padding:0 20px;border-radius:22px;font:inherit;font-weight:600;cursor:pointer;' +
      (primary ? 'background:#4B5A48;color:#FFFFFF;border:1px solid #4B5A48'
               : 'background:transparent;color:#EFE9DF;border:1px solid #EFE9DF');
    b.addEventListener('click', function () { save(choice); });
    return b;
  }

  var actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:10px';
  actions.appendChild(btn('Weigeren', false, 'denied'));
  actions.appendChild(btn('Akkoord', true, 'granted'));

  // Mobiel: compacte balk, zodat de belknop in beeld blijft.
  if (window.matchMedia && window.matchMedia('(max-width: 600px)').matches) {
    bar.style.left = '8px'; bar.style.right = '8px'; bar.style.bottom = '8px';
    bar.style.padding = '10px 12px'; bar.style.gap = '8px'; bar.style.fontSize = '13px'; bar.style.borderRadius = '12px';
    bar.style.flexWrap = 'nowrap';
    txt.style.flex = '1 1 auto';
    txt.firstChild.nodeValue = 'Cookies voor advertentiemeting?';
    more.textContent = 'Info';
    Array.prototype.forEach.call(actions.children, function (b) { b.style.height = '34px'; b.style.padding = '0 12px'; b.style.fontSize = '13px'; });
    actions.style.gap = '6px'; actions.style.flexShrink = '0';
  }
  bar.appendChild(txt);
  bar.appendChild(actions);
  document.body.appendChild(bar);
})();
