#!/usr/bin/env bash
# Downloads the video's fonts from Google Fonts (all SIL Open Font License)
# into ./fonts and writes ./fonts/fonts.css pointing at the local copies, so a
# render never depends on the network. Re-run to refresh.
set -euo pipefail
cd "$(dirname "$0")/.."
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
FAMILIES=(
  'Bricolage+Grotesque:opsz,wght@12..96,300..800'
  'Instrument+Serif:ital@0;1'
  'Roboto:wght@400;500;600;700'
  'Noto+Sans+Devanagari:wght@400;500;600;700'
  'Caveat:wght@500;700'
)
: > fonts/fonts.css
for fam in "${FAMILIES[@]}"; do
  css=$(curl -fsSL -A "$UA" "https://fonts.googleapis.com/css2?family=${fam}&display=block")
  # Keep only the subsets the video uses.
  css=$(printf '%s\n' "$css" | awk '
    /^\/\* / { keep = ($2=="latin" || $2=="latin-ext" || $2=="devanagari") }
    { if (keep) print }')
  for url in $(printf '%s\n' "$css" | grep -o 'https://fonts.gstatic.com/[^)]*'); do
    file=$(printf '%s' "$url" | sed 's#https://fonts.gstatic.com/s/##; s#/#_#g')
    [ -f "fonts/$file" ] || curl -fsSL -o "fonts/$file" "$url"
    css=${css//"$url"/"$file"}
  done
  printf '%s\n' "$css" >> fonts/fonts.css
done
ls fonts | wc -l
