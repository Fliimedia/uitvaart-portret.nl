(function () {
  var b = document.querySelector('.flii-badge');
  if (!b) return;
  function run() {
    b.classList.add('is-on');
    setTimeout(function () { b.classList.remove('is-on'); }, 3600);
  }
  if (!('IntersectionObserver' in window)) { run(); return; }
  var io = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) { io.disconnect(); setTimeout(run, 300); }
  }, { threshold: 1 });
  io.observe(b);
})();
