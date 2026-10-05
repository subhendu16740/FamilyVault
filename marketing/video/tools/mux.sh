#!/usr/bin/env bash
# Scores a rendered video and writes the deliverables:
#   out/familyvault-intro-<tag>.mp4            music, sound effects and voices
#   out/familyvault-intro-<tag>-sfx-only.mp4   sound effects and voices, no
#                                              music, for adding a platform's
#                                              own music track
# usage: tools/mux.sh [16x9|9x16]   (after tools/render.mjs has written out/video-<tag>.mp4)
set -euo pipefail
cd "$(dirname "$0")/.."
TAG=${1:-16x9}
FFMPEG=${FFMPEG:-ffmpeg}
PYTHON=${PYTHON:-python3}

"$PYTHON" audio/score.py "out/cues-$TAG.json" "out/score-$TAG.wav"
"$PYTHON" audio/score.py "out/cues-$TAG.json" "out/sfx-$TAG.wav" --sfx-only

mux() { # video audio out
  "$FFMPEG" -y -loglevel error -i "$1" -i "$2" -map 0:v -map 1:a -c:v copy \
    -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$3"
  echo "$3"
}
mux "out/video-$TAG.mp4" "out/score-$TAG.wav" "out/familyvault-intro-$TAG.mp4"
mux "out/video-$TAG.mp4" "out/sfx-$TAG.wav" "out/familyvault-intro-$TAG-sfx-only.mp4"
