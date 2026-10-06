"""Speaks the film's two voice lines, in Hindi: Maa's question, and AskLocker
reading its answer back to her.

    python tools/voices.py --model model.onnx --voices voices/

writes audio/voices/ask-hi.wav and audio/voices/answer-hi.wav, and src/voices.js
with each line's length and the moments in it the film times to. The WAVs are
committed, so the film renders without this step: run it again only to change a
line or a voice, then re-render.

The voices are Kokoro-82M v1.0 (Apache 2.0), run with onnxruntime:
  --model   onnx/model.onnx from huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
  --voices  that repository's voices/ folder (the kokoro-js npm package carries
            the same files under package/voices)
Hindi is turned into phonemes by espeak-ng, the way Kokoro's own pipeline does
it (misaki's EspeakG2P, language 'hi'), so the model hears what it was trained on.

Needs: pip install numpy onnx onnxruntime phonemizer-fork; apt install espeak-ng.
"""
import argparse
import json
import pathlib
import wave

import numpy as np
import onnx
import onnxruntime as ort
from phonemizer.backend import EspeakBackend

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 24_000

# What the app would say. The answer is the one on the voice screen
# (src/screens.js), as the app's toSpeech() (src/lib/speech-text.ts) hands it to
# the phone's voice: the policy number spelled out, in groups of four. Its
# letters are written as a Hindi voice names them, because espeak reads a lone
# "A" as the English article.
LINES = {
    'ask': dict(voice='hf_beta', speed=0.95, sentences=[
        'पापा की हेल्थ इंश्योरेंस का पॉलिसी नंबर क्या है?',
    ]),
    'answer': dict(voice='hm_omega', speed=1.0, sentences=[
        'पापा की हेल्थ इंश्योरेंस पॉलिसी का नंबर ए एस एच 2, 3 1 1 4, 5 8 9 है।',
        'यह पॉलिसी 14 मार्च 2027 तक वैध है।',
    ]),
}
# The policy number starts after these words of the answer's first sentence:
# the film highlights it from there, and the night scene picks the reading up
# there.
NUMBER_LEAD = 'पापा की हेल्थ इंश्योरेंस पॉलिसी का नंबर'
SENTENCE_GAP = 0.4

# Kokoro's token table (config.json, "vocab"). Anything else is dropped, as the
# model's own front end does.
VOCAB = {
    ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, '—': 9, '…': 10, '"': 11, '(': 12,
    ')': 13, '“': 14, '”': 15, ' ': 16, '\u0303': 17, 'ʣ': 18, 'ʥ': 19, 'ʦ': 20, 'ʨ': 21,
    'ᵝ': 22, '\uab67': 23, 'A': 24, 'I': 25, 'O': 31, 'Q': 33, 'S': 35, 'T': 36, 'W': 39,
    'Y': 41, 'ᵊ': 42, 'a': 43, 'b': 44, 'c': 45, 'd': 46, 'e': 47, 'f': 48, 'h': 50,
    'i': 51, 'j': 52, 'k': 53, 'l': 54, 'm': 55, 'n': 56, 'o': 57, 'p': 58, 'q': 59,
    'r': 60, 's': 61, 't': 62, 'u': 63, 'v': 64, 'w': 65, 'x': 66, 'y': 67, 'z': 68,
    'ɑ': 69, 'ɐ': 70, 'ɒ': 71, 'æ': 72, 'β': 75, 'ɔ': 76, 'ɕ': 77, 'ç': 78, 'ɖ': 80,
    'ð': 81, 'ʤ': 82, 'ə': 83, 'ɚ': 85, 'ɛ': 86, 'ɜ': 87, 'ɟ': 90, 'ɡ': 92, 'ɥ': 99,
    'ɨ': 101, 'ɪ': 102, 'ʝ': 103, 'ɯ': 110, 'ɰ': 111, 'ŋ': 112, 'ɳ': 113, 'ɲ': 114,
    'ɴ': 115, 'ø': 116, 'ɸ': 118, 'θ': 119, 'œ': 120, 'ɹ': 123, 'ɾ': 125, 'ɻ': 126,
    'ʁ': 128, 'ɽ': 129, 'ʂ': 130, 'ʃ': 131, 'ʈ': 132, 'ʧ': 133, 'ʊ': 135, 'ʋ': 136,
    'ʌ': 138, 'ɣ': 139, 'ɤ': 140, 'χ': 142, 'ʎ': 143, 'ʒ': 147, 'ʔ': 148, 'ˈ': 156,
    'ˌ': 157, 'ː': 158, 'ʰ': 162, 'ʲ': 164, '↓': 169, '→': 171, '↗': 172, '↘': 173,
    'ᵻ': 177,
}

# misaki.espeak.EspeakG2P: espeak's tied pairs become Kokoro's single symbols.
E2M = sorted({'a^ɪ': 'I', 'a^ʊ': 'W', 'd^z': 'ʣ', 'd^ʒ': 'ʤ', 'e^ɪ': 'A', 'o^ʊ': 'O',
              'ə^ʊ': 'Q', 's^s': 'S', 't^s': 'ʦ', 't^ʃ': 'ʧ', 'ɔ^ɪ': 'Y'}.items())


class Kokoro:
    def __init__(self, model, voices):
        # The graph rounds each token's predicted length, in frames, before it
        # draws the sound. Exposing that tensor gives every word's start and end.
        graph = onnx.load(str(model))
        lengths = next(n.output[0] for n in graph.graph.node
                       if n.op_type == 'Clip' and any('Round' in i for i in n.input))
        graph.graph.output.append(onnx.helper.make_tensor_value_info(lengths, onnx.TensorProto.FLOAT, None))
        self.session = ort.InferenceSession(graph.SerializeToString(), providers=['CPUExecutionProvider'])
        self.voices = pathlib.Path(voices)
        self.g2p = EspeakBackend(language='hi', preserve_punctuation=True, with_stress=True,
                                 tie='^', language_switch='remove-flags')

    def phonemes(self, text):
        # The danda ends a sentence; Kokoro knows the full stop.
        ps = self.g2p.phonemize([text.replace('।', '.')])[0].strip()
        for old, new in E2M:
            ps = ps.replace(old, new)
        return ps.replace('^', '').replace('-', '')

    def speak(self, text, voice, speed):
        """The sentence as audio, and each word in it as (phonemes, start, end)."""
        chars = [c for c in self.phonemes(text) if c in VOCAB]
        # One style per length: n tokens use row n - 1 of the voice's table.
        pack = np.fromfile(self.voices / f'{voice}.bin', dtype=np.float32).reshape(-1, 1, 256)
        audio, frames = self.session.run(None, {
            'input_ids': np.array([[0, *[VOCAB[c] for c in chars], 0]], dtype=np.int64),
            'style': pack[min(len(chars), len(pack)) - 1],
            'speed': np.array([speed], dtype=np.float32),
        })
        audio, frames = audio[0], frames.reshape(-1)
        # Token i of the sentence is frame run i + 1: the first run is padding.
        edges = np.concatenate([[0], np.cumsum(frames)]) * len(audio) / frames.sum() / SR
        words, word, start = [], '', 0.0
        for i, c in enumerate(chars + [' ']):
            if c != ' ':
                start = start if word else edges[i + 1]
                word += c
            elif word:
                words.append((word, start, edges[i + 1]))
                word = ''
        audio, offset = trim(audio)
        return audio, [(w, a - offset, b - offset) for w, a, b in words]


def trim(x, floor=0.008, pad=0.03):
    """Cut the silence the model leaves at both ends, keeping a breath of it.
    Returns the audio and how many seconds came off the front."""
    loud = np.where(np.abs(x) > floor)[0]
    a = max(0, loud[0] - int(pad * SR))
    b = min(len(x), loud[-1] + int(pad * SR))
    out = x[a:b].copy()
    fade = int(0.01 * SR)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out, a / SR


def write_wav(path, x):
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(x / max(1e-9, np.max(np.abs(x))) * 0.89, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--model', required=True, help="Kokoro-82M v1.0 ONNX export (onnx/model.onnx)")
    ap.add_argument('--voices', required=True, help='folder holding hf_beta.bin, hm_omega.bin, ...')
    args = ap.parse_args()
    tts = Kokoro(args.model, args.voices)

    marks = {}
    for name, line in LINES.items():
        said = [tts.speak(s, line['voice'], line['speed']) for s in line['sentences']]
        gap = np.zeros(int(SENTENCE_GAP * SR))
        audio = np.concatenate([a if i == 0 else np.concatenate([gap, a]) for i, (a, _) in enumerate(said)])
        write_wav(ROOT / 'audio' / 'voices' / f'{name}-hi.wav', audio)
        marks[name] = {'dur': round(len(audio) / SR, 3)}
        if len(said) > 1:
            marks[name]['sentence2'] = round((len(said[0][0]) + len(gap)) / SR, 3)
        print(f'{name}: {len(audio) / SR:.2f}s, {line["voice"]}')
        for _, words in said:
            print('   ', '  '.join(f'{w} {a:.2f}' for w, a, _ in words))
        if name == 'answer':
            # Halfway through the pause before the number's first letter.
            words = said[0][1]
            k = len(tts.phonemes(NUMBER_LEAD).split())
            marks[name]['number'] = round((words[k - 1][2] + words[k][1]) / 2, 3)

    js = ROOT / 'src' / 'voices.js'
    js.write_text(
        '// Written by tools/voices.py: how long each spoken line runs, in seconds,\n'
        '// and the moments in it the film times to. Regenerate rather than edit.\n'
        f'export const VOICES = {json.dumps(marks, indent=2)};\n')
    print(js, json.dumps(marks))


if __name__ == '__main__':
    main()
