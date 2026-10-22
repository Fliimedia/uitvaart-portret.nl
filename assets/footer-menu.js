// Footer: twee uitklapmenu's naast elkaar; één tegelijk open, lijst eronder over de volle breedte.
document.querySelectorAll('.lp-tabs').forEach(function (tabs) {
  var heads = tabs.querySelectorAll('.lp-head');
  heads.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      heads.forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
        document.getElementById(b.getAttribute('aria-controls')).hidden = true;
      });
      if (open) {
        btn.setAttribute('aria-expanded', 'true');
        document.getElementById(btn.getAttribute('aria-controls')).hidden = false;
      }
    });
  });
});
