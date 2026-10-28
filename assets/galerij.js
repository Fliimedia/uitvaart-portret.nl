// Kleine voorbeelden per vak, voor verzamel.html (aanvrager/partner) en kijk.html (alleen meekijken).
window.toonGalerij = function (box, d) {
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]; }); };
  var h = '', totaal = 0;
  d.fases.forEach(function (f) {
    if (!f.items.length) return;
    totaal += f.items.length;
    h += '<h3 style="font-family:Newsreader,Georgia,serif;font-weight:400;font-size:21px;margin:18px 0 8px">' + esc(f.naam) + ' <span style="font-family:inherit;font-size:14px;color:#6A6F6B">(' + f.items.length + ')</span></h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px">' +
      f.items.map(function (i) {
        return '<div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#E9E4DA' + (i.portret ? ';outline:3px solid #4B5A48' : '') + '">' +
          '<img src="' + esc(i.src) + '" alt="" loading="lazy" draggable="false" oncontextmenu="return false" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'">' +
          (i.video ? '<span style="position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.6);color:#fff;border-radius:8px;padding:1px 7px;font-size:12px">▶ film</span>' : '') +
          (i.ster ? '<span style="position:absolute;right:6px;top:4px;color:#B08A3E;font-size:18px;text-shadow:0 0 3px #fff">★</span>' : '') + '</div>';
      }).join('') + '</div>';
  });
  var muziek = [d.titels].concat(d.muziek || []).filter(Boolean);
  h += muziek.length ? '<p style="margin:18px 0 0;color:#4A4F4C"><strong>Muziek:</strong> ' + esc(muziek.join(' · ')) + '</p>' : '<p style="margin:18px 0 0;color:#4A4F4C">Er is nog geen muziek doorgegeven.</p>';
  box.innerHTML = totaal ? h : '<p style="color:#4A4F4C">Er zijn nog geen foto\'s binnen.</p>' + h;
};
