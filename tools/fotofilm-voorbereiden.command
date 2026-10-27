#!/bin/zsh
# Versie 4.1 — werkt op elke Mac: alle paden via $HOME, geen vaste gebruikersnaam.
# Fotofilm voorbereiden — Uitvaart portret
# Dubbelklik, sleep de klantmap in het venster en druk op Enter.
# Of: sleep de map op dit bestand in het Dock / gebruik als argument.

UIT="$HOME/Movies/Fotofilms"
VERSIE="4.1"
APP="$HOME/Library/Application Support/Uitvaart-portret"
BRON="https://uitvaart-portret.nl/tools"

# ---- Nieuwe versie? Eerst vragen, dan pas bijwerken. De vorige versie blijft bewaard. ----
bijwerken() {
  [[ -n "$FOTOFILM_NIET_BIJWERKEN" ]] && return
  local nieuw overslaan antwoord tmp verwacht echt
  nieuw=$(curl -fsS -m 4 "$BRON/versie.txt" 2>/dev/null | tr -d '[:space:]')
  [[ "$nieuw" =~ '^[0-9]+(\.[0-9]+)*$' ]] || return          # offline of geen geldig antwoord: gewoon doorgaan
  autoload -Uz is-at-least
  is-at-least "$nieuw" "$VERSIE" && return                     # we zijn al bij
  overslaan=$(cat "$APP/overslaan.txt" 2>/dev/null)
  [[ "$overslaan" == "$nieuw" ]] && return
  antwoord=$(osascript -e "button returned of (display dialog \"Er is een nieuwe versie van Fotofilm voorbereiden: $nieuw (je hebt nu $VERSIE).\" & return & return & \"Nu bijwerken? De huidige versie blijft bewaard.\" buttons {\"Deze versie overslaan\", \"Later\", \"Bijwerken\"} default button \"Bijwerken\" with title \"Fotofilm voorbereiden\")" 2>/dev/null)
  if [[ "$antwoord" == "Deze versie overslaan" ]]; then mkdir -p "$APP"; print -r -- "$nieuw" > "$APP/overslaan.txt"; return; fi
  [[ "$antwoord" == "Bijwerken" ]] || return
  tmp=$(mktemp "${TMPDIR:-/tmp}/fotofilm-nieuw.XXXXXX")
  verwacht=$(curl -fsS -m 4 "$BRON/fotofilm-voorbereiden.sha256" 2>/dev/null | awk '{print $1}')
  if ! curl -fsS -m 120 "$BRON/fotofilm-voorbereiden.command" -o "$tmp" 2>/dev/null \
     || [[ -z "$verwacht" || "$(shasum -a 256 "$tmp" | awk '{print $1}')" != "$verwacht" ]] \
     || [[ "$(head -1 "$tmp")" != "#!/bin/zsh" ]]; then
    rm -f "$tmp"
    osascript -e 'display dialog "Bijwerken lukte niet (geen of onvolledige download). Je werkt nu verder met de huidige versie." buttons {"OK"} default button "OK" with title "Fotofilm voorbereiden"' >/dev/null 2>&1
    return
  fi
  mkdir -p "$APP/vorige versies"
  [[ -f "$APP/Fotofilm voorbereiden.command" ]] && cp -f "$APP/Fotofilm voorbereiden.command" "$APP/vorige versies/Fotofilm voorbereiden $VERSIE.command"
  mv -f "$tmp" "$APP/Fotofilm voorbereiden.command" && chmod +x "$APP/Fotofilm voorbereiden.command"
  rm -f "$APP/overslaan.txt"
  osascript -e "display notification \"Bijgewerkt naar versie $nieuw\" with title \"Fotofilm voorbereiden\"" 2>/dev/null
  FOTOFILM_NIET_BIJWERKEN=1 exec zsh "$APP/Fotofilm voorbereiden.command" "$@"
}
bijwerken "$@"
JS="$(mktemp -t fotofilm).js"
cat > "$JS" <<'JXA'
// Fotofilm voorbereiden — beeldverwerking met macOS-ingebouwde frameworks (JXA).
// Aanroep: osascript -l JavaScript prep.js "<klantmap>" "<uitvoermap>"
ObjC.import('Cocoa');
ObjC.import('QuartzCore');
ObjC.import('AVFoundation');
try { ObjC.import('Vision'); } catch (e) {}

var MAX = 3840, CW = 3840, CH = 2160, PAKKET = 60;
var FOTO = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff', 'bmp', 'gif'];
var VIDEO = ['mov', 'mp4', 'm4v', 'avi', 'mkv', '3gp', 'mts', 'mpg', 'mpeg', 'wmv'];
var AUDIO = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'aif', 'aiff', 'ogg'];
var fm = $.NSFileManager.defaultManager;

function ls(dir) {
  var a = fm.contentsOfDirectoryAtPathError(dir, null);
  return a.isNil() ? [] : ObjC.deepUnwrap(a).filter(function (n) { return n[0] !== '.'; }).sort(function (x, y) { return x.localeCompare(y, 'nl', { numeric: true }); });
}
function isDir(p) {
  var at = fm.attributesOfItemAtPathError(p, null);
  return !at.isNil() && ObjC.unwrap(at.objectForKey('NSFileType')) === 'NSFileTypeDirectory';
}
function mkdir(p) { fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(p, true, $(), null); }
function ext(n) { var i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); }
function stem(n) { var i = n.lastIndexOf('.'); return i < 0 ? n : n.slice(0, i); }
function pad(n) { return ('000' + n).slice(-3); }
function num(v) { return $.NSNumber.numberWithDouble(v); }
function rect(x, y, w, h) { return { origin: { x: x, y: y }, size: { width: w, height: h } }; }

function filter(name, params) {
  var f = $.CIFilter.filterWithName(name);
  Object.keys(params).forEach(function (k) { f.setValueForKey(params[k], k); });
  return f.valueForKey('outputImage');
}
function load(p) {
  var opts = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $('kCIImageApplyOrientationProperty'));
  var img = $.CIImage.imageWithContentsOfURLOptions($.NSURL.fileURLWithPath(p), opts);
  if (img.isNil()) return null;
  LAATSTE_DATUM = datumUit(img);
  var e = img.extent;
  // naar oorsprong (0,0) schuiven, voor de zekerheid
  if (e.origin.x !== 0 || e.origin.y !== 0) {
    var t = $.NSAffineTransform.transform; t.translateXByYBy(-e.origin.x, -e.origin.y);
    img = filter('CIAffineTransform', { inputImage: img, inputTransform: t });
  }
  return img;
}
function size(img) { var e = img.extent; return { w: e.size.width, h: e.size.height }; }
function scale(img, s) {
  var d = size(img);
  var out = filter('CILanczosScaleTransform', { inputImage: img, inputScale: num(s), inputAspectRatio: num(1) });
  return out.imageByCroppingToRect(rect(0, 0, Math.floor(d.w * s), Math.floor(d.h * s)));
}
function save(img, p) {
  // ondoorzichtig maken (transparante PNG's worden wit i.p.v. zwart)
  var d = size(img);
  var wit = $.CIImage.imageWithColor($.CIColor.colorWithRedGreenBlue(1, 1, 1)).imageByCroppingToRect(rect(0, 0, d.w, d.h));
  img = filter('CISourceOverCompositing', { inputImage: img, inputBackgroundImage: wit });
  var rep = $.NSBitmapImageRep.alloc.initWithCIImage(img);
  var props = $.NSDictionary.dictionaryWithObjectForKey(num(0.9), $('NSImageCompressionFactor'));
  var data = rep.representationUsingTypeProperties(3 /* JPEG */, props);
  return !data.isNil() && data.writeToFileAtomically(p, true);
}
function blurCanvas(img) {
  var d = size(img);
  var cover = Math.max(CW / d.w, CH / d.h);
  var bg = scale(img, cover);
  var bd = size(bg);
  var t1 = $.NSAffineTransform.transform; t1.translateXByYBy((CW - bd.w) / 2, (CH - bd.h) / 2);
  bg = filter('CIAffineTransform', { inputImage: bg, inputTransform: t1 }).imageByClampingToExtent;
  bg = filter('CIGaussianBlur', { inputImage: bg, inputRadius: num(70) });
  bg = filter('CIExposureAdjust', { inputImage: bg, inputEV: num(-0.8) });
  var fit = Math.min(CW / d.w, CH / d.h, 1e9);
  var fg = scale(img, fit);
  var fd = size(fg);
  var t2 = $.NSAffineTransform.transform; t2.translateXByYBy(Math.round((CW - fd.w) / 2), Math.round((CH - fd.h) / 2));
  fg = filter('CIAffineTransform', { inputImage: fg, inputTransform: t2 });
  return filter('CISourceOverCompositing', { inputImage: fg, inputBackgroundImage: bg }).imageByCroppingToRect(rect(0, 0, CW, CH));
}
function copy(src, dst) { return fm.copyItemAtPathToPathError(src, dst, null); }


// ---------- Premiere-tijdlijn (FCP7 XML), muziek-gestuurd ----------
var FPS = 25, SW = 1920, SH = 1080, INTRO = 8 * FPS, EINDE_ZW = 4 * FPS, ZW_DISSOLVE = 2 * FPS;
var BEWEGING = ['in', 'uit', 'links', 'rechts', 'in-boven', 'uit', 'rechts', 'in', 'links', 'in-boven'];
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fileUrl(p) { return 'file://' + p.split('/').map(function (s) { return encodeURIComponent(s); }).join('/'); }
function rate() { return '<rate><timebase>' + FPS + '</timebase><ntsc>FALSE</ntsc></rate>'; }
var SH_APP = Application.currentApplication(); SH_APP.includeStandardAdditions = true;
function sh(cmd) { try { return SH_APP.doShellScript(cmd); } catch (e) { return ''; } }
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
// Duur van een audiobestand in seconden, via macOS-ingebouwde afinfo (met mdls als reserve).
function audioSec(p) {
  var m = /estimated duration:\s*([\d.]+)/.exec(sh('/usr/bin/afinfo ' + q(p)));
  if (m && +m[1] > 0) return +m[1];
  m = /=\s*([\d.]+)/.exec(sh('/usr/bin/mdls -name kMDItemDurationSeconds ' + q(p)));
  return m && +m[1] > 0 ? +m[1] : 0;
}
function kf(id, naam, a, b, dur, isCenter) {
  function v(x) { return isCenter ? '<value><horiz>' + x[0].toFixed(4) + '</horiz><vert>' + x[1].toFixed(4) + '</vert></value>' : '<value>' + x.toFixed(2) + '</value>'; }
  return '<parameter authoringApp="PremierePro"><parameterid>' + id + '</parameterid><name>' + naam + '</name>' +
    (isCenter ? '' : '<valuemin>0</valuemin><valuemax>1000</valuemax>') + v(a) +
    '<keyframe><when>0</when>' + v(a) + '</keyframe><keyframe><when>' + dur + '</when>' + v(b) + '</keyframe></parameter>';
}
function beweging(f, i, stil) {
  var ar = f.w / f.h;
  var basis = (ar >= 1.3 ? Math.max(SW / f.w, SH / f.h) : Math.min(SW / f.w, SH / f.h)) * 100;
  if (stil) return { s0: basis, s1: basis, c0: [0, 0], c1: [0, 0] };
  var z = 1.08, m = BEWEGING[i % BEWEGING.length], dx = 0.03, dy = 0.025, r = { c0: [0, 0], c1: [0, 0] };
  if (m === 'in') { r.s0 = basis; r.s1 = basis * z; }
  else if (m === 'uit') { r.s0 = basis * z; r.s1 = basis; }
  else if (m === 'in-boven') { r.s0 = basis; r.s1 = basis * z; r.c1 = [0, dy]; }
  else { r.s0 = r.s1 = basis * z; r.c0 = [m === 'links' ? dx : -dx, 0]; r.c1 = [-r.c0[0], 0]; }
  return r;
}
function clip(id, f, start, dur, mv) {
  return '<clipitem id="clip' + id + '"><name>' + esc(f.naam) + '</name><enabled>TRUE</enabled><duration>' + dur + '</duration>' + rate() +
    '<start>' + start + '</start><end>' + (start + dur) + '</end><in>0</in><out>' + dur + '</out>' +
    '<file id="file' + id + '"><name>' + esc(f.naam) + '.jpg</name><pathurl>' + esc(fileUrl(f.pad)) + '</pathurl>' + rate() + '<duration>' + dur + '</duration>' +
    '<media><video><samplecharacteristics><width>' + f.w + '</width><height>' + f.h + '</height></samplecharacteristics></video></media></file>' +
    '<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>' +
    kf('scale', 'Scale', mv.s0, mv.s1, dur, false) + kf('center', 'Center', mv.c0, mv.c1, dur, true) + '</effect></filter></clipitem>';
}
function dissolve(at, len) {
  return '<transitionitem><start>' + (at - Math.floor(len / 2)) + '</start><end>' + (at + Math.ceil(len / 2)) + '</end><alignment>center</alignment>' + rate() +
    '<effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect></transitionitem>';
}
// lijst: [eerste, ...rest]; zw: zwart-witversie van de laatste; muziek: [{pad, naam, sec}]. Geeft info terug voor het overzicht.
function tijdlijn(lijst, zw, muziek, pad, titel) {
  var muziekFr = Math.round(muziek.reduce(function (a, m) { return a + m.sec; }, 0) * FPS);
  var rest = lijst.slice(1), n = rest.length;
  var info = { perFoto: 5, muziekSec: muziekFr / FPS, opmerking: '' };
  // Beschikbare tijd voor de foto's na de intro: de muziekduur min de zwart-witstaart.
  var beschikbaar = muziekFr ? muziekFr - (zw ? EINDE_ZW : 0) : n * 5 * FPS;
  var D = n ? Math.floor(beschikbaar / n) : 0, over = n ? beschikbaar - D * n : 0;
  info.perFoto = D / FPS;
  if (!muziekFr) info.opmerking = 'Geen muziekbestand gevonden: 5 s per foto. Zet het muziekbestand in de klantmap en draai opnieuw.';
  else if (D < 4.5 * FPS) info.opmerking = 'Let op: ' + info.perFoto.toFixed(1) + ' s per foto is kort. Overweeg foto\'s te schrappen of een tweede nummer.';
  else if (D > 8 * FPS) info.opmerking = 'Let op: ' + info.perFoto.toFixed(1) + ' s per foto is lang. Te weinig foto\'s voor de muziek, of muziek inkorten.';
  var X = Math.min(FPS, Math.floor(D / 3)); // overgang max 1 s, nooit meer dan 1/3 van een foto
  var v = [], id = 0, t = 0;
  v.push(clip(++id, lijst[0], 0, INTRO, beweging(lijst[0], 0, true))); t = INTRO;
  rest.forEach(function (f, i) {
    var dur = D + (i === n - 1 ? over : 0), laatsteFoto = i === n - 1 && zw;
    v.push(dissolve(t, i === 0 ? FPS : X));
    v.push(clip(++id, f, t, dur, beweging(f, i, laatsteFoto))); t += dur;
  });
  if (zw && n) { v.push(dissolve(t, ZW_DISSOLVE)); v.push(clip(++id, zw, t, EINDE_ZW, beweging(zw, 0, true))); t += EINDE_ZW; }
  var a = [], at = INTRO;
  muziek.forEach(function (m, k) {
    var fr = Math.round(m.sec * FPS);
    a.push('<clipitem id="audio' + (k + 1) + '"><name>' + esc(m.naam) + '</name><enabled>TRUE</enabled><duration>' + fr + '</duration>' + rate() +
      '<start>' + at + '</start><end>' + (at + fr) + '</end><in>0</in><out>' + fr + '</out>' +
      '<file id="afile' + (k + 1) + '"><name>' + esc(m.naam) + '</name><pathurl>' + esc(fileUrl(m.pad)) + '</pathurl>' + rate() + '<duration>' + fr + '</duration>' +
      '<media><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media></file>' +
      '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack></clipitem>');
    at += fr;
  });
  var x = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="seq1"><name>' + esc('Fotofilm – ' + titel) + '</name><duration>' + Math.max(t, at) + '</duration>' + rate() +
    '<media><video><format><samplecharacteristics>' + rate() + '<width>' + SW + '</width><height>' + SH + '</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>' +
    '<track>' + v.join('') + '</track></video><audio><track>' + a.join('') + '</track></audio></media>' +
    '<timecode>' + rate() + '<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode></sequence></xmeml>\n';
  $(x).writeToFileAtomicallyEncodingError(pad, true, $.NSUTF8StringEncoding, null);
  return info;
}


// ---------- Analyse (Apple Vision, lokaal) ----------
var LAATSTE_DATUM = 0;
function datumUit(img) {
  try {
    var pr = ObjC.deepUnwrap(img.properties) || {};
    var s = (pr['{Exif}'] && (pr['{Exif}'].DateTimeOriginal || pr['{Exif}'].DateTimeDigitized)) || (pr['{TIFF}'] && pr['{TIFF}'].DateTime) || '';
    var m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
    if (!m || +m[1] < 1900) return 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  } catch (e) { return 0; }
}
function analyse(img) {
  var r = { soort: 'onbekend', print: null };
  try {
    var d = size(img), k = Math.min(1, 1024 / Math.max(d.w, d.h));
    var klein = k < 1 ? scale(img, k) : img;
    var h = $.VNImageRequestHandler.alloc.initWithCIImageOptions(klein, $({}));
    var fr = $.VNDetectFaceRectanglesRequest.alloc.init;
    var fp = $.VNGenerateImageFeaturePrintRequest.alloc.init;
    if (!h.performRequestsError($([fr, fp]), null)) return r;
    var n = fr.results.isNil() ? 0 : fr.results.count, grootste = 0;
    for (var i = 0; i < n; i++) grootste = Math.max(grootste, fr.results.objectAtIndex(i).boundingBox.size.height);
    r.soort = n === 0 ? 'leeg' : n >= 3 ? 'groep' : grootste > 0.28 ? 'close' : 'mens';
    if (!fp.results.isNil() && fp.results.count) r.print = fp.results.objectAtIndex(0);
  } catch (e) {}
  return r;
}
function afstand(a, b) {
  if (!a || !b) return 1e9;
  try { var d = Ref(); return a.computeDistanceToObservationError(b, d, null) ? d[0] : 1e9; } catch (e) { return 1e9; }
}
// Afwisselen: geen drie dezelfde soorten op rij en geen (bijna) dezelfde foto's naast elkaar. Verplaatst hooguit 4 plekken.
function afwisselen(lijst) {
  if (lijst.length < 3) return lijst;
  var ds = [];
  for (var i = 1; i < lijst.length; i++) { var x = afstand(lijst[i - 1].print, lijst[i].print); if (x < 1e9) ds.push(x); }
  ds.sort(function (a, b) { return a - b; });
  var grens = ds.length ? ds[Math.floor(ds.length / 2)] * 0.45 : -1; // 'bijna hetzelfde' = veel dichter bij elkaar dan gemiddeld
  function botst(i) {
    var a = lijst[i], v = lijst[i - 1], vv = lijst[i - 2];
    if (vv && a.soort !== 'onbekend' && a.soort === v.soort && v.soort === vv.soort) return true;
    return grens > 0 && afstand(v.print, a.print) < grens;
  }
  for (var j = 1; j < lijst.length; j++) {
    if (!botst(j)) continue;
    for (var k = j + 1; k < Math.min(lijst.length, j + 5); k++) {
      var t = lijst[j]; lijst[j] = lijst[k]; lijst[k] = t;
      if (!botst(j)) { WISSELS++; break; }
      t = lijst[j]; lijst[j] = lijst[k]; lijst[k] = t;
    }
  }
  return lijst;
}
var WISSELS = 0;

function run(argv) {
  var src = argv[0], out = argv[1];
  mkdir(out); mkdir(out + '/video'); mkdir(out + '/staand origineel'); mkdir(out + '/muziek');
  var muziek = [];

  // Fasemappen ("1 Jeugd" …) op volgorde; losse bestanden in de hoofdmap komen als "Overig" achteraan.
  var groepen = [];
  ls(src).forEach(function (n) {
    var p = src + '/' + n;
    if (isDir(p) && !/^\d+\s*Film$/i.test(n)) groepen.push({ label: n.replace(/^\d+\s*/, ''), pad: p, files: ls(p) }); // map '5 Film' (jouw eigen films) overslaan
  });
  var los = ls(src).filter(function (n) { return !isDir(src + '/' + n); });
  if (los.length) groepen.push({ label: 'Overig', pad: src, files: los });

  var gezien = {}, dubbel = {}, laatste = null, tl = [], tlPortret = [], nr = 0, vnr = 0, fotos = 0, ster = 0, staand = 0, portret = null, video = [], fout = [], perFase = [];
  var ONZEKER = /^(Weet ik niet|Overig)/;
  // 1) Verzamelen en analyseren
  var items = [];
  groepen.forEach(function (g, gi) {
    g.files.forEach(function (n, volg) {
      var p = g.pad + '/' + n, e = ext(n);
      var isP = n.indexOf('PORTRET') >= 0, isS = n.indexOf('★') >= 0;
      var naam = stem(n).replace(/^\d+\s*(★\s*)?(PORTRET\s*)?-\s*/, '').replace(/[\/:]/g, '_');
      if (n === 'MUZIEK.txt') { copy(p, out + '/MUZIEK.txt'); return; }
      if (AUDIO.indexOf(e) >= 0) {
        if (copy(p, out + '/muziek/' + n.replace(/[\/:]/g, '_'))) muziek.push(n); else fout.push(n + ' (kopiëren mislukt)');
        return;
      }
      if (VIDEO.indexOf(e) >= 0) {
        vnr++; var dst = out + '/video/' + pad(vnr) + ' ' + g.label + ' - ' + naam + '.' + e;
        if (copy(p, dst)) video.push(n); else fout.push(n + ' (kopiëren mislukt)');
        return;
      }
      if (FOTO.indexOf(e) < 0) { if (!/^AKKOORD/.test(n) && e !== 'txt') fout.push(n + ' (onbekend type)'); return; }
      var at = fm.attributesOfItemAtPathError(p, null), sz = at.isNil() ? 0 : ObjC.unwrap(at.objectForKey('NSFileSize'));
      var sleutel = naam + '|' + sz;
      if (gezien[sleutel]) { dubbel[naam] = (dubbel[naam] || 1) + 1; return; } // dubbel: overslaan
      gezien[sleutel] = true;
      var img = load(p);
      if (!img) { fout.push(n + ' (kan niet openen)'); return; }
      var datum = LAATSTE_DATUM;
      var d = size(img), m = Math.max(d.w, d.h);
      if (m > MAX) img = scale(img, MAX / m);
      var an = analyse(img);
      items.push({ n: n, naam: naam, img: img, d: d, isP: isP, isS: isS, gi: gi, volg: volg, datum: datum, soort: an.soort, print: an.print });
    });
  });
  // 2) Volgorde: per fase op opnamedatum (zonder datum: volgorde van de familie), 'Weet ik niet' met datum naar de passende fase
  var fasen = groepen.map(function (g) { return { label: g.label, lijst: [], onzeker: ONZEKER.test(g.label) }; });
  var geplaatst = 0;
  items.filter(function (x) { return !x.isP; }).forEach(function (x) { fasen[x.gi].lijst.push(x); });
  var vast = fasen.filter(function (f) { return !f.onzeker; });
  vast.forEach(function (f) {
    var ds = f.lijst.filter(function (x) { return x.datum; }).map(function (x) { return x.datum; });
    f.van = ds.length ? Math.min.apply(null, ds) : 0; f.tot = ds.length ? Math.max.apply(null, ds) : 0;
  });
  fasen.filter(function (f) { return f.onzeker; }).forEach(function (f) {
    f.lijst = f.lijst.filter(function (x) {
      if (!x.datum) return true;
      var best = null, bestAfst = Infinity;
      vast.forEach(function (v) {
        if (!v.van) return;
        var a = x.datum < v.van ? v.van - x.datum : x.datum > v.tot ? x.datum - v.tot : 0;
        if (a < bestAfst) { bestAfst = a; best = v; }
      });
      if (!best) return true;
      best.lijst.push(x); x.verplaatst = true; geplaatst++; return false;
    });
  });
  var metDatum = 0;
  fasen.forEach(function (f) {
    var gedateerd = f.lijst.filter(function (x) { return x.datum; }).sort(function (a, b) { return a.datum - b.datum; });
    var rest = f.lijst.filter(function (x) { return !x.datum; }).sort(function (a, b) { return a.gi - b.gi || a.volg - b.volg; });
    metDatum += gedateerd.length;
    f.lijst = afwisselen(gedateerd.concat(rest));
  });
  // 3) Opslaan in de nieuwe volgorde
  function bewaar(x, label) {
    var img = x.img, d = x.d;
    fotos++; if (x.isS) ster++;
    var base = x.isP ? '000 PORTRET - ' + x.naam : pad(++nr) + ' ' + label + (x.isS ? ' ★' : '') + ' - ' + x.naam;
    if (x.isP) portret = x.n;
    var ok, mainPath = out + '/' + base + '.jpg', sd = size(img);
    if (d.h > d.w * 1.05) { // staand: 16:9 met vervaagde achtergrond in de hoofdmap, origineel apart
      staand++;
      var canvas = blurCanvas(img);
      ok = save(canvas, mainPath) && save(img, out + '/staand origineel/' + base + '.jpg');
      sd = { w: CW, h: CH }; if (!x.isP) laatste = { img: canvas, naam: x.naam, w: CW, h: CH };
    } else {
      ok = save(img, mainPath);
      if (!x.isP) laatste = { img: img, naam: x.naam, w: Math.round(sd.w), h: Math.round(sd.h) };
    }
    if (!ok) fout.push(x.n + ' (opslaan mislukt)');
    else (x.isP ? tlPortret : tl).push({ pad: mainPath, naam: base, w: Math.round(sd.w), h: Math.round(sd.h) });
    if (d.w < 1200 && d.h < 1200) fout.push(x.n + ' (let op: lage resolutie ' + d.w + '×' + d.h + ')');
  }
  items.filter(function (x) { return x.isP; }).slice(0, 1).forEach(function (x) { bewaar(x, ''); });
  items.filter(function (x) { return x.isP; }).slice(1).forEach(function (x) { x.isP = false; fasen[x.gi].lijst.push(x); });
  fasen.forEach(function (f) {
    f.lijst.forEach(function (x) { bewaar(x, f.label); });
    if (f.lijst.length) perFase.push(f.label + ': ' + f.lijst.length);
  });
  var SORTEER = { metDatum: metDatum, geplaatst: geplaatst, wissels: WISSELS, totaal: items.length };

  var xmlNaam = 'Tijdlijn – ' + src.split('/').pop() + '.xml';
  var tlInfo = null, alle = tlPortret.concat(tl);
  if (alle.length) {
    var zw = null;
    if (laatste && alle.length > 1) {
      var zwPad = out + '/999 EINDE zwart-wit - ' + laatste.naam + '.jpg';
      if (save(filter('CIColorControls', { inputImage: laatste.img, inputSaturation: num(0), inputBrightness: num(0), inputContrast: num(1.05) }), zwPad))
        zw = { pad: zwPad, naam: '999 EINDE zwart-wit - ' + laatste.naam, w: laatste.w, h: laatste.h };
    }
    var mz = ls(out + '/muziek').filter(function (n) { return AUDIO.indexOf(ext(n)) >= 0; })
      .map(function (n) { var p = out + '/muziek/' + n; return { pad: p, naam: n, sec: audioSec(p) }; });
    mz.filter(function (m) { return !m.sec; }).forEach(function (m) { fout.push(m.naam + ' (duur onleesbaar, telt niet mee)'); });
    tlInfo = tijdlijn(alle, zw, mz.filter(function (m) { return m.sec; }), out + '/' + xmlNaam, src.split('/').pop());
  }
  var extra = Math.max(0, fotos - PAKKET), toeslag = Math.ceil(extra / 5) * 10;
  var r = [];
  r.push('FOTOFILM — ' + src.split('/').pop());
  r.push('');
  r.push('Foto\'s: ' + fotos + ' (pakket: ' + PAKKET + ')');
  r.push(extra ? 'Boven pakket: ' + extra + ' → toeslag €' + toeslag + ' (per 5 extra €10)' : 'Binnen het pakket, geen toeslag.');
  r.push('Met ster: ' + ster);
  r.push('Portretfoto: ' + (portret ? 'ja (000 PORTRET)' : 'NEE — nog vragen'));
  r.push('Staande foto\'s omgezet naar 16:9 met vervaagde achtergrond: ' + staand + ' (originelen in "staand origineel")');
  r.push('Muziekbestanden: ' + muziek.length + (fm.fileExistsAtPath(out + '/MUZIEK.txt') ? ' — zie MUZIEK.txt voor titels en links' : ' — GEEN MUZIEK.txt gevonden, vraag de muziek na'));
  r.push('Filmpjes: ' + video.length + (video.length ? ' (map video — maak in Premiere proxy\'s bij import)' : ''));
  r.push('');
  r.push('Tijdlijn voor Premiere: ' + xmlNaam + ' (File → Import)');
  if (tlInfo) {
    r.push('  Eerste foto 8 s zonder muziek · muziek ' + Math.floor(tlInfo.muziekSec / 60) + ':' + ('0' + Math.round(tlInfo.muziekSec % 60)).slice(-2) + ' · ' + tlInfo.perFoto.toFixed(1) + ' s per foto · einde dissolve naar zwart-wit');
    if (tlInfo.opmerking) r.push('  ' + tlInfo.opmerking);
  }
  r.push('Per fase: ' + perFase.join(' · '));
  r.push('Volgorde: ' + SORTEER.metDatum + ' van ' + SORTEER.totaal + ' foto\'s op opnamedatum gezet' + (SORTEER.geplaatst ? ' · ' + SORTEER.geplaatst + ' uit "Weet ik niet" in de juiste fase geplaatst' : '') + ' · ' + SORTEER.wissels + '× omgewisseld voor afwisseling (close-up/groep/zonder mensen, bijna dezelfde foto\'s)');
  if (perFase.some(function (x) { return /^(Weet ik niet|Overig)/.test(x); })) r.push('  Let op: foto\'s zonder datum uit "Weet ik niet" staan achteraan. Schuif ze in Premiere naar de juiste plek.');
  var dub = Object.keys(dubbel);
  if (dub.length) { r.push(''); r.push('DUBBELE FOTO\'S automatisch overgeslagen (alleen de eerste is gebruikt):'); dub.forEach(function (k) { r.push('- ' + k + ' (' + dubbel[k] + '× aangeleverd)'); }); }
  if (fout.length) { r.push(''); r.push('AANDACHTSPUNTEN:'); fout.forEach(function (f) { r.push('- ' + f); }); }
  $(r.join('\n') + '\n').writeToFileAtomicallyEncodingError(out + '/OVERZICHT.txt', true, $.NSUTF8StringEncoding, null);
  if (!video.length) fm.removeItemAtPathError(out + '/video', null);
  if (!staand) fm.removeItemAtPathError(out + '/staand origineel', null);
  if (!muziek.length) fm.removeItemAtPathError(out + '/muziek', null);
  return r.join('\n');
}
JXA

[[ -t 1 ]] && clear
echo "──────────────────────────────────────────"
echo "  Fotofilm voorbereiden — Uitvaart portret (versie $VERSIE)"
echo "──────────────────────────────────────────"
if [[ -n "$1" ]]; then
  MAP="$1"
else
  echo
  echo "Sleep de map van de klant in dit venster en druk op Enter:"
  read -r INVOER
  INVOER="${INVOER%"${INVOER##*[![:space:]]}"}"   # spaties achteraan weg
  MAP="${(Q)INVOER}"                               # \ en aanhalingstekens van slepen weg
fi
MAP="${MAP%/}"
if [[ ! -d "$MAP" ]]; then
  echo; echo "⚠️  Dat is geen map: $MAP"; [[ -t 0 ]] && read -k1 "?Druk op een toets om te sluiten."; exit 1
fi
NAAM="${MAP:t}"
DOEL="$UIT/$NAAM – PREMIERE"
# Oude uitvoer van deze klant naar de prullenmand (wordt opnieuw gemaakt)
for OUD in "$UIT/$NAAM – PREMIERE"*(N); do mv "$OUD" "$HOME/.Trash/${OUD:t} $(date +%H%M%S)" 2>/dev/null; done
mkdir -p "$DOEL"
echo; echo "Bezig met \"$NAAM\" …"
START=$(date +%s)
if osascript -l JavaScript "$JS" "$MAP" "$DOEL"; then
  echo; echo "✅ Klaar in $(( $(date +%s) - START )) seconden → $DOEL"
  open "$DOEL"
  osascript -e "display notification \"PREMIERE-map van $NAAM staat klaar\" with title \"Fotofilm voorbereiden\"" 2>/dev/null
else
  echo; echo "⚠️  Er ging iets mis. Maak een screenshot van dit venster en stuur het naar Claude."
fi
rm -f "$JS"
[[ -t 0 ]] && { echo; read -k1 "?Druk op een toets om te sluiten."; }
