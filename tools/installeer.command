#!/bin/zsh
# Installeer of herstel de Uitvaart-portret tools op deze Mac. Werkt op elke Mac: alleen paden via $HOME.
# Haalt de nieuwste versie van uitvaart-portret.nl; lukt dat niet, dan de versie die naast dit bestand staat.
HIER="${0:A:h}"
APP="$HOME/Library/Application Support/Uitvaart-portret"
BRON="https://www.uitvaart-portret.nl/tools"
TOOL="$APP/Fotofilm voorbereiden.command"
[[ -t 1 ]] && clear
echo "Uitvaart-portret tools installeren…"
mkdir -p "$APP" "$HOME/Movies/Fotofilms"

# 1. Het programma
tmp=$(mktemp "${TMPDIR:-/tmp}/fotofilm-inst.XXXXXX")
verwacht=$(curl -fsSL -m 5 "$BRON/fotofilm-voorbereiden.sha256" 2>/dev/null | awk '{print $1}')
if curl -fsSL -m 120 "$BRON/fotofilm-voorbereiden.command" -o "$tmp" 2>/dev/null \
   && [[ -n "$verwacht" && "$(shasum -a 256 "$tmp" | awk '{print $1}')" == "$verwacht" ]] \
   && [[ "$(head -1 "$tmp")" == "#!/bin/zsh" ]]; then
  [[ -f "$TOOL" ]] && { mkdir -p "$APP/vorige versies"; cp -f "$TOOL" "$APP/vorige versies/Fotofilm voorbereiden (voor installatie).command"; }
  mv -f "$tmp" "$TOOL"; echo "✓ Nieuwste versie gedownload."
elif [[ -f "$HIER/Fotofilm voorbereiden.command" ]]; then
  rm -f "$tmp"; cp -f "$HIER/Fotofilm voorbereiden.command" "$TOOL"; echo "✓ Versie uit deze map gebruikt (geen internet?)."
else
  rm -f "$tmp"; echo "⚠️  Kon het programma niet downloaden. Controleer je internet en probeer opnieuw."
  [[ -t 0 ]] && read -k1 "?Druk op een toets."; exit 1
fi
xattr -c "$TOOL" "$HIER/"*.command 2>/dev/null
chmod +x "$TOOL" "$HIER/"*.command 2>/dev/null
rm -f "$APP/overslaan.txt"

# 2. Snelle actie in Finder (rechtsklik op een map → Snelle taken → Fotofilm voorbereiden)
WF="$HOME/Library/Services/Fotofilm voorbereiden.workflow/Contents"
mkdir -p "$WF"
cat > "$WF/Info.plist" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>NSServices</key><array><dict>
<key>NSBackgroundColorName</key><string>background</string>
<key>NSIconName</key><string>NSActionTemplate</string>
<key>NSMenuItem</key><dict><key>default</key><string>Fotofilm voorbereiden</string></dict>
<key>NSMessage</key><string>runWorkflowAsService</string>
<key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>
<key>NSSendFileTypes</key><array><string>public.folder</string></array>
</dict></array>
</dict></plist>
PL
cat > "$WF/document.wflow" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>AMApplicationBuild</key><string>523</string>
<key>AMApplicationVersion</key><string>2.10</string>
<key>AMDocumentVersion</key><string>2</string>
<key>actions</key><array><dict>
 <key>action</key><dict>
  <key>AMAccepts</key><dict><key>Container</key><string>List</string><key>Optional</key><true/><key>Types</key><array><string>com.apple.cocoa.path</string></array></dict>
  <key>AMActionVersion</key><string>2.0.3</string>
  <key>AMApplication</key><array><string>Automator</string></array>
  <key>AMParameterProperties</key><dict><key>COMMAND_STRING</key><dict/><key>CheckedForUserDefaultShell</key><dict/><key>inputMethod</key><dict/><key>shell</key><dict/><key>source</key><dict/></dict>
  <key>AMProvides</key><dict><key>Container</key><string>List</string><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>
  <key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
  <key>ActionName</key><string>Run Shell Script</string>
  <key>ActionParameters</key><dict>
   <key>COMMAND_STRING</key><string>for MAP in "$@"; do zsh "$HOME/Library/Application Support/Uitvaart-portret/Fotofilm voorbereiden.command" "$MAP"; done</string>
   <key>CheckedForUserDefaultShell</key><true/>
   <key>inputMethod</key><integer>1</integer>
   <key>shell</key><string>/bin/zsh</string>
   <key>source</key><string></string>
  </dict>
  <key>BundleIdentifier</key><string>com.apple.RunShellScript</string>
  <key>CFBundleVersion</key><string>2.0.3</string>
  <key>CanShowSelectedItemsWhenRun</key><false/>
  <key>CanShowWhenRun</key><true/>
  <key>Category</key><array><string>AMCategoryUtilities</string></array>
  <key>Class Name</key><string>RunShellScriptAction</string>
  <key>InputUUID</key><string>4C5C1A57-1D7B-4B0B-9A3E-2F3F6C1A0B01</string>
  <key>Keywords</key><array><string>Shell</string><string>Script</string></array>
  <key>OutputUUID</key><string>4C5C1A57-1D7B-4B0B-9A3E-2F3F6C1A0B02</string>
  <key>UUID</key><string>4C5C1A57-1D7B-4B0B-9A3E-2F3F6C1A0B03</string>
  <key>UnlocalizedApplications</key><array><string>Automator</string></array>
  <key>arguments</key><dict/>
  <key>isViewVisible</key><integer>1</integer>
 </dict>
 <key>isViewVisible</key><integer>1</integer>
</dict></array>
<key>connectors</key><dict/>
<key>workflowMetaData</key><dict>
 <key>applicationBundleIDsByPath</key><dict/>
 <key>applicationPaths</key><array/>
 <key>inputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject.folder</string>
 <key>outputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
 <key>presentationMode</key><integer>15</integer>
 <key>processesInput</key><integer>0</integer>
 <key>serviceApplicationBundleID</key><string>com.apple.finder</string>
 <key>serviceApplicationPath</key><string>/System/Library/CoreServices/Finder.app</string>
 <key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject.folder</string>
 <key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
 <key>serviceProcessesInput</key><integer>0</integer>
 <key>systemImageName</key><string>NSActionTemplate</string>
 <key>useAutomaticInputType</key><integer>0</integer>
 <key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>
</dict>
</dict></plist>
PL
/System/Library/CoreServices/pbs -update 2>/dev/null
echo "✓ Snelle actie aangemaakt: rechtsklik op een klantmap → Snelle taken → Fotofilm voorbereiden."

V=$(grep -m1 '^VERSIE=' "$TOOL" | cut -d'"' -f2)
echo
echo "✅ Klaar. Versie ${V:-?} staat in:"
echo "   $APP"
echo "   PREMIERE-mappen komen in: Films → Fotofilms"
echo
echo "Zie je de snelle actie niet? Log één keer uit en weer in, of volg LEESMIJ.txt."
[[ -t 0 ]] && read -k1 "?Druk op een toets om te sluiten."
exit 0
