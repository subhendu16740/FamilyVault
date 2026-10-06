# AskLocker intro film

The launch film, as code. `src/intro.html` is a GSAP timeline that recreates the
app's real screens (same layouts, copy, colours and Feather icons as `src/app/**`,
sized by `src/constants/design.ts`) around a short story: a 2:14 AM hospital
admission, a son who can't find his father's policy, and the same night with
AskLocker. `tools/render.mjs` seeks the paused timeline frame by frame in
headless Chromium and pipes PNGs to ffmpeg, so every frame is deterministic.
`audio/score.py` synthesises the soundtrack from the cue sheet the page emits,
so sound lands on the exact frame of each tap, and mixes in the two spoken
lines from `audio/voices/`.

The product half follows one family through the app: documents brought in from
Gmail (★ Family Plus), a paper policy scanned, a question typed, the same
question asked aloud in Hindi, the family tree, Papa's emergency card, a
reminder arriving on the lock screen, and what keeps the vault private. Every
one of those scenes opens with a **Why**, the problem it exists for, read first
and large, and then shows the **How**, AskLocker's answer, while the phone
does it. The voice scene names all ten voice languages in their own scripts,
and you hear it work: Maa asks her question aloud in Hindi, and the app reads
its answer back to her, policy number spelled out, with English subtitles under
both. On the same night at the end, her phone is heard reading her the number.
The phone is the installed web app on Android, so the status bar takes the
app's theme colour.

| Output | Length | For |
|---|---|---|
| `asklocker-intro-16x9.mp4` | 2:13 | Landing page, YouTube, LinkedIn, pitches |
| `asklocker-intro-9x16.mp4` | 2:13 | Full-length vertical posts |
| `asklocker-intro-9x16-short.mp4` | 1:11 | Reels, Shorts, WhatsApp forwards |
| `asklocker-intro-16x9-short.mp4` | 1:11 | LinkedIn and X feeds |
| `…-sfx-only.mp4` | same | Posting with a platform's own music: effects and voices, no music |

The short cut keeps the story and one pass through the product: Gmail import,
Ask, and the Hindi voice answer. It drops the statistic, Scan, the family tree,
the emergency card, Reminders and Privacy. It leaves the voice scene after the
answer's first sentence, the policy number, and the second sentence carries on
over the night scene, on Maa's phone.

Rendered files go to `out/`, which is not committed.

## Render

Needs Node 22, Python 3 with `numpy` and `scipy`, and an ffmpeg built with
libx264. Playwright's Chromium does the drawing.

```bash
cd marketing/video
npm install
npx playwright install chromium       # skip if Chromium is already provisioned
python3 -m pip install numpy scipy

node tools/render.mjs                 # 16:9, full   -> out/video-16x9.mp4
node tools/render.mjs --portrait      # 9:16, full   -> out/video-9x16.mp4
node tools/render.mjs --portrait --short
node tools/render.mjs --short
./tools/mux.sh 16x9                   # adds sound -> out/asklocker-intro-16x9.mp4
./tools/mux.sh 9x16-short             # tag = orientation, plus -short for the short cut
```

`FFMPEG=/path/to/ffmpeg` and `PYTHON=/path/to/python` override the defaults.
The spoken lines are committed WAVs, so rendering needs no speech engine.
A full cut takes about eight minutes on four cores (`--workers 3` renders three
slices in parallel and joins them losslessly).

Single frames, for checking a change without a full render:

```bash
node tools/render.mjs --stills 4.6,40,62.4          # -> out/stills/16x9-*.png
node tools/render.mjs --portrait --short --stills 30
```

To watch it live, serve this folder (`npm run preview`) and open
`src/intro.html`, `src/intro.html?orientation=portrait` or add `&cut=short`.
Space pauses, arrow keys scrub, number keys jump to tenths of the film.

## Change it

- **The family, the policy, the end card**: `STORY` at the top of
  `src/screens.js`. `STORY.ctaNote` is the line under the call to action (the
  Family Plus price); set `STORY.url` before publishing to show an address.
- **Headlines and captions**: `textBlocks()` and `subtitles()` in `src/screens.js`.
  Each feature scene is one `whyHow()` call: the problem, then the fix and its
  paragraph. In the why, `*stars*` mark the coral emphasis, `|` breaks the line
  and `~` is a space that never breaks.
- **Timing and choreography**: the numbered scenes in `src/main.js`. Each scene
  starts where the previous one ends, so lengthening one shifts the rest; the
  soundtrack follows automatically because it is built from the cue sheet.
- **The spoken lines**: `LINES` in `tools/voices.py`, then run it (below). It
  writes `audio/voices/ask-hi.wav` and `answer-hi.wav`, and `src/voices.js`
  with how long each runs and where the policy number starts in the answer;
  the voice scene and the night scene time themselves from that file, so a
  longer line lengthens the film by itself.
- **Fonts**: `tools/fetch-fonts.sh` refreshes the local copies in `fonts/`.
- **Icons**: add a Feather name to `NEEDED` in `tools/build-icons.mjs` and rerun it.

### The voices

Both lines are spoken by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
v1.0, an open text-to-speech model (Apache 2.0), from espeak-ng's Hindi
phonemes, the way Kokoro's own pipeline reads Hindi. Maa is the voice
`hf_beta`; the app is `hm_omega`, a different voice so that question and answer
never sound like the same person. `score.py` plays the answer through a
phone-sized speaker, and at night through the same speaker across a room, and
lowers the music by 15 dB while anyone speaks.

```bash
apt install espeak-ng
python3 -m pip install numpy onnx onnxruntime phonemizer-fork
# onnx/model.onnx and voices/ from huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
python3 tools/voices.py --model model.onnx --voices voices/
```

Word timings come from the model itself (each sound's length, read out of the
graph), not from the waveform, so the night scene starts on the number's first
letter. Kokoro's Hindi voices are its least practised, so have a Hindi speaker
listen to both lines before the film goes out.

## Keep it honest

The film may only claim what the app does. Check a new line against the
"What we can claim today" table in `marketing/strategy/index.html` first. Some
details were chosen deliberately:

- **Gmail import's rows are what the app would show.** Each file name, sender
  and subject was run through `classifyAttachment` in
  `supabase/functions/_shared/gmail-rules.ts`; the reasons ("file name says
  statement") and categories on screen are its answers. The senders are generic
  ("Card Statements", "Rail Bookings") so that no real bank or insurer appears.
  Gmail import is web only, part of ★ Family Plus, and while Google's
  verification of the Gmail scope is pending only listed test users can connect:
  don't put the film in front of the public before that is done, or cut the
  Gmail scene from the short.
- **A photographed page is saved as `scan_<Date.now()>.jpg`** (`upload.tsx`), so
  that is the name on the upload screen and on the answer's source chip.
- **The sample policy's labels** ("Policy Number", "Sum insured", "Valid
  till") are the ones the extractor in `supabase/functions/_shared/metadata.ts`
  reads, so the "Read off the page" callout shows exactly what the app would
  pull out. It leaves out the insured's name on purpose: the name pattern
  carries on across the line break and stores "Ramesh Sharma Members".
- **The reminders are web push**, as `public/sw.js` shows them: the title and
  body are the server's own wording (migrations 034 and 035), at 9:05 because
  reminders are made from 9 in the morning, India time, and pushed at five past
  the hour. The Notifications screen is where a tapped one opens.
- **Relations come from the tree.** The "Ask by relation" callout shows what
  `relativesNamedIn()` in `supabase/functions/_shared/kinship.ts` resolves:
  "Dadi" and "दादी" to the grandmother, "Papa" to the father.
- **The voice languages** are the list in `src/lib/voice-languages.ts`:
  English (India), Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada,
  Malayalam and Punjabi. One code per language drives listening, the written
  answer (`rag-search`) and the voice that reads it. Whether a phone can speak
  a language depends on the voices it has, which the line under the cards says.
- **The spoken answer is what the app would say.** It is the answer on the
  screen as `toSpeech()` (`src/lib/speech-text.ts`) hands it to the phone's
  voice: the policy number spelled out, in groups of four ("A S H 2, 3 1 1 4,
  5 8 9"). The letters are written as a Hindi voice says them (ए एस एच),
  because espeak would read a lone "A" as the English article. The app reads
  with the phone's own voices, so on a real phone the voice will differ; the
  film's is a stand-in for one.
- **The family has 4 members**, the most any plan allows; Dadi, Neha and Aarav are
  in the tree without accounts, which the tree allows.
- **The end card's price line** is Family Plus as `PLUS_PRICE` sets it. Where
  payments are not switched on the app says "Coming soon", so check before
  publishing.

The Sharma family, Arogya Shield and the policy are fictional, the document
carries a SPECIMEN watermark, and the phone numbers on the emergency card are
the app's own placeholder pattern. The logo is the app's icon (`public/icon-512.png`):
the locker and speech bubble of `assets/expo.icon/Assets/asklocker-mark.svg`,
placed and coloured as the icon has them, so the two match pixel for pixel. The
app was called FamilyVault until 6 October 2026; the film says AskLocker
everywhere a person sees the name, as the app does.

## Licences

Fonts are from Google Fonts under the SIL Open Font License. Icons are Feather
(MIT). GSAP is used under its free standard licence. The soundtrack and sound
effects are generated by `audio/score.py`, so no audio licence is involved. The
voices are generated by Kokoro-82M, whose model and voices are Apache 2.0; no
recording or voice actor is involved.
