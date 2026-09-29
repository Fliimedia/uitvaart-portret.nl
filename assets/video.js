document.querySelectorAll('a.yt[data-yt]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    e.preventDefault();
    var box = document.createElement('div');
    box.setAttribute('style', a.getAttribute('style'));
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + a.dataset.yt + '?autoplay=1&rel=0&playsinline=1';
    f.title = a.dataset.title || 'Voorbeeldfilm';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.setAttribute('style', 'position: absolute; inset: 0; width: 100%; height: 100%; border: 0');
    box.appendChild(f);
    a.replaceWith(box);
  });
});
