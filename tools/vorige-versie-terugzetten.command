#!/bin/zsh
# Zet de vorige versie van Fotofilm voorbereiden terug (als een nieuwe versie iets geks doet).
APP="$HOME/Library/Application Support/Uitvaart-portret"
TOOL="$APP/Fotofilm voorbereiden.command"
[[ -t 1 ]] && clear
VORIG=$(ls -t "$APP/vorige versies/"*.command 2>/dev/null | head -1)
if [[ -z "$VORIG" ]]; then echo "Er is geen vorige versie bewaard."; [[ -t 0 ]] && read -k1 "?Druk op een toets."; exit 1; fi
NU=$(grep -m1 '^VERSIE=' "$TOOL" 2>/dev/null | cut -d'"' -f2)
cp -f "$VORIG" "$TOOL" && chmod +x "$TOOL"
TERUG=$(grep -m1 '^VERSIE=' "$TOOL" | cut -d'"' -f2)
# De versie waar we vanaf komen niet opnieuw aanbieden; een nóg nieuwere versie wel.
[[ -n "$NU" ]] && print -r -- "$NU" > "$APP/overslaan.txt"
echo "✅ Teruggezet naar versie ${TERUG:-?} (was ${NU:-?})."
echo "Vertel Claude wat er misging met versie ${NU:-?}."
[[ -t 0 ]] && read -k1 "?Druk op een toets om te sluiten."
