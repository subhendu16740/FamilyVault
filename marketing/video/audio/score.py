"""Synthesises the intro video's soundtrack from the cue sheet the renderer writes.

    python audio/score.py out/cues-16x9.json out/score-16x9.wav [--sfx-only]

Every sound here is generated (numpy + scipy), so the video carries no
third-party audio licence. The picture decides the timing: src/main.js emits a
cue for each tap, notification and scene change, and this script places sound
on exactly those frames. The two spoken lines, Maa's question and the app
reading its answer, are the WAVs in audio/voices/ (made by tools/voices.py);
the music dips under them, and --sfx-only keeps them.

The music follows the story in three moods:
  night   (0 -> brand reveal)  D minor pad, a low pulse, a ticking clock during
                               the scramble, a boom on "Your family won't.",
                               a ringtone, then silence when nobody answers
  day     (reveal -> night2)   F major, 96 bpm: I-V-vi-IV with a felt-piano
                               arpeggio, soft kick and shaker once it settles
  night2 + end                 the same progression, slow and sparse, resolving
                               on F for the end card
"""
import json
import pathlib
import sys
import wave

import numpy as np
from scipy import signal

SR = 48_000
RNG = np.random.default_rng(7)
VOICES = pathlib.Path(__file__).resolve().parent / 'voices'


# ─── Building blocks ────────────────────────────────────────────────────────

def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def lowpass(x, hz, order=2):
    return signal.sosfilt(signal.butter(order, hz, 'low', fs=SR, output='sos'), x)


def highpass(x, hz, order=2):
    return signal.sosfilt(signal.butter(order, hz, 'high', fs=SR, output='sos'), x)


def bandpass(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def adsr(n, a, r, sustain=1.0):
    env = np.full(n, sustain)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    env[:na] = np.linspace(0, sustain, na) if na else env[:na]
    if nr:
        env[-nr:] *= np.linspace(1, 0, nr)
    return env


def place(bus, start, sig, gain=1.0, pan=0.0):
    """Mix a mono or stereo signal into the stereo bus at `start` seconds."""
    i = int(start * SR)
    if i >= bus.shape[1] or i + len(sig if sig.ndim == 1 else sig[0]) <= 0:
        return
    if sig.ndim == 1:
        left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.vstack([sig * left * 1.414, sig * right * 1.414])
    j = min(bus.shape[1], i + sig.shape[1])
    bus[:, i:j] += gain * sig[:, : j - i]


def reverb(x, seconds=2.4, mix=0.25, predelay=0.02):
    """Convolution with decaying, decorrelated noise: a soft hall."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 6.9 / seconds)
    irs = []
    for _ in range(2):
        ir = RNG.standard_normal(n) * env
        ir = lowpass(ir, 5200)
        ir[: int(predelay * SR)] = 0
        irs.append(ir / np.sqrt(np.sum(ir ** 2)))
    wet = np.vstack([signal.fftconvolve(x[c], irs[c])[: x.shape[1]] for c in range(2)])
    return x * (1 - mix) + wet * mix


# ─── Instruments ────────────────────────────────────────────────────────────

def pad(freqs, dur, attack=1.2, release=1.8, cutoff=1400, voices=3):
    t = t_axis(dur)
    out = np.zeros_like(t)
    for f in freqs:
        for v in range(voices):
            cents = (v - (voices - 1) / 2) * 7
            ff = f * 2 ** (cents / 1200)
            ph = RNG.uniform(0, 2 * np.pi)
            out += signal.sawtooth(2 * np.pi * ff * t + ph) * 0.6 + np.sin(2 * np.pi * ff * t + ph) * 0.4
    out = lowpass(out / (len(freqs) * voices), cutoff, order=2)
    return out * adsr(len(t), attack, release)


def pluck(freq, dur=1.6, bright=1.0, decay=0.85):
    t = t_axis(dur)
    out = np.zeros_like(t)
    for k, a in [(1, 1.0), (2, 0.42 * bright), (3, 0.18 * bright), (4, 0.08 * bright), (5, 0.04 * bright)]:
        fk = freq * k * (1 + 0.00035 * k * k)
        out += a * np.sin(2 * np.pi * fk * t) * np.exp(-t * (1.1 + 0.7 * k) / decay)
    env = (1 - np.exp(-t / 0.003)) * np.exp(-t / decay)
    return lowpass(out * env, 4200)


def bell(freq, dur=1.8):
    t = t_axis(dur)
    parts = [(1, 1.0, 1.6), (2.0, 0.35, 2.4), (3.01, 0.18, 3.6), (4.2, 0.12, 5.0), (5.4, 0.06, 7.0)]
    out = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t * d) for r, a, d in parts)
    return out * (1 - np.exp(-t / 0.002))


def sine_bass(freq, dur, attack=0.02, release=0.3):
    t = t_axis(dur)
    s = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t)
    return s * adsr(len(t), attack, release)


def kick(level=1.0):
    t = t_axis(0.45)
    f = 44 + 90 * np.exp(-t / 0.035)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = highpass(RNG.standard_normal(len(t)), 2500) * np.exp(-t / 0.004) * 0.15
    return (s + click) * level


def shaker(level=1.0):
    t = t_axis(0.09)
    n = bandpass(RNG.standard_normal(len(t)), 6000, 11000)
    return n * np.exp(-t / 0.022) * (1 - np.exp(-t / 0.004)) * level


def noise_sweep(dur, lo, hi, q=1.2):
    """Band-limited noise whose centre glides lo -> hi: a whoosh."""
    n = int(dur * SR)
    out = np.zeros(n)
    x = RNG.standard_normal(n)
    hop = 1024
    centres = np.geomspace(lo, hi, n // hop + 1)
    for b, c in enumerate(centres):
        a, e = b * hop, min(n, (b + 1) * hop + 512)
        if a >= n:
            break
        lo_, hi_ = max(40, c / q), min(SR / 2 - 100, c * q)
        seg = bandpass(x[max(0, a - 2048):e], lo_, hi_)[-(e - a):]
        out[a:e] += seg * np.hanning(e - a) if e - a > 1 else seg
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
    return out * env / (np.max(np.abs(out)) + 1e-9)


# ─── Sound effects ──────────────────────────────────────────────────────────

def sfx_tap():
    t = t_axis(0.05)
    n = bandpass(RNG.standard_normal(len(t)), 1800, 5200) * np.exp(-t / 0.006)
    body = np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.012) * 0.6
    return (n * 0.5 + body) * 0.9


def sfx_key():
    t = t_axis(0.03)
    return bandpass(RNG.standard_normal(len(t)), 2200, 5500) * np.exp(-t / 0.0035) * 0.3


def sfx_buzz(dur=0.45):
    t = t_axis(dur)
    tone = signal.square(2 * np.pi * 150 * t) * 0.5 + np.sin(2 * np.pi * 150 * t)
    am = 0.6 + 0.4 * np.sin(2 * np.pi * 28 * t)
    return lowpass(tone * am, 900) * adsr(len(t), 0.01, 0.06) * 0.55


def sfx_notif():
    a = bell(midi(88), 1.2) * 0.55
    b = bell(midi(93), 1.4) * 0.5
    out = np.zeros(int(1.6 * SR))
    out[: len(a)] += a
    k = int(0.11 * SR)
    out[k: k + len(b)] += b[: len(out) - k]
    return out * 0.45


def sfx_pop(level=1.0):
    t = t_axis(0.12)
    f = 320 + 900 * (1 - np.exp(-t / 0.03))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035)
    return s * 0.45 * level


def sfx_tick(hi=True):
    t = t_axis(0.06)
    f = 2400 if hi else 1900
    s = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.52 * t)) * np.exp(-t / 0.008)
    return s * 0.3


def sfx_error():
    out = np.zeros(int(0.5 * SR))
    for i, f in enumerate([233, 196]):
        t = t_axis(0.16)
        s = (signal.square(2 * np.pi * f * t) * 0.3 + np.sin(2 * np.pi * f * t)) * adsr(len(t), 0.005, 0.08)
        k = int(i * 0.17 * SR)
        out[k:k + len(s)] += lowpass(s, 1400)
    return out * 0.35


def sfx_hit():
    t = t_axis(3.2)
    f = 38 + 34 * np.exp(-t / 0.25)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.1)
    thump = lowpass(RNG.standard_normal(len(t)), 300) * np.exp(-t / 0.08) * 0.8
    air = highpass(RNG.standard_normal(len(t)), 3000) * np.exp(-t / 0.5) * 0.05
    return (sub + thump + air) * 0.9


def sfx_ring():
    """A soft marimba ringtone phrase, played twice."""
    notes = [76, 79, 83, 88, 83, 79]
    out = np.zeros(int(1.5 * SR))
    for i, n in enumerate(notes):
        s = pluck(midi(n), 0.6, bright=0.5, decay=0.25)
        k = int(i * 0.12 * SR)
        out[k:k + len(s)] += s[: len(out) - k]
    return out * 0.5


def sfx_whoosh(dur=1.0, lo=250, hi=4200):
    return noise_sweep(dur, lo, hi) * 0.35


def sfx_shutter():
    out = np.zeros(int(0.2 * SR))
    for k in [0, int(0.055 * SR)]:
        t = t_axis(0.03)
        s = bandpass(RNG.standard_normal(len(t)), 1200, 6000) * np.exp(-t / 0.005)
        out[k:k + len(s)] += s
    return out * 0.6


def sfx_scan(dur):
    t = t_axis(dur)
    f = 520 + 260 * (t / dur)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25 + np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR) * 0.08
    return s * adsr(len(t), 0.15, 0.3) * 0.25


def sfx_process(dur):
    out = np.zeros(int((dur + 0.3) * SR))
    for k in np.arange(0, dur, 0.09):
        f = RNG.choice([1760, 1975, 2217, 2637])
        t = t_axis(0.05)
        s = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.01) * RNG.uniform(0.3, 0.7)
        i = int(k * SR)
        out[i:i + len(s)] += s
    return out * 0.12


def sfx_success():
    out = np.zeros(int(1.6 * SR))
    for i, n in enumerate([84, 88, 91]):
        s = bell(midi(n), 1.2) * (0.5 - 0.08 * i)
        k = int(i * 0.075 * SR)
        out[k:k + len(s)] += s[: len(out) - k]
    return out * 0.4


def sfx_ding():
    return bell(midi(91), 1.0) * 0.3


def sfx_send():
    return noise_sweep(0.22, 800, 5000) * 0.18


def sfx_answer():
    out = np.zeros(int(1.4 * SR))
    for i, n in enumerate([81, 88]):
        s = bell(midi(n), 1.2) * 0.35
        k = int(i * 0.09 * SR)
        out[k:k + len(s)] += s[: len(out) - k]
    return out * 0.45


def sfx_mic():
    out = np.zeros(int(0.35 * SR))
    for i, f in enumerate([880, 1320]):
        t = t_axis(0.09)
        s = np.sin(2 * np.pi * f * t) * adsr(len(t), 0.005, 0.05)
        k = int(i * 0.08 * SR)
        out[k:k + len(s)] += s
    return out * 0.22


# ─── Voices ─────────────────────────────────────────────────────────────────

def voice_line(c):
    """A spoken line from audio/voices/, cut to the cue's from/to (seconds into
    the line) and coloured by who is speaking: Maa as she is, the app through a
    phone's speaker, and at night the same speaker heard across a room.
    Returns the sound (room tail included), its gain and how long the words run."""
    with wave.open(str(VOICES / f"{c['line']}-hi.wav")) as w:
        rate = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16) / 32768.0
    a = int(c.get('from', 0) * rate)
    b = int(c['to'] * rate) if 'to' in c else len(x)
    x = x[a:b].copy()
    edge = int(0.012 * rate)
    x[:edge] *= np.linspace(0, 1, edge)
    x[-edge:] *= np.linspace(1, 0, edge)
    x = signal.resample_poly(x, SR, rate)
    words = len(x) / SR
    if c.get('phone'):
        x = lowpass(highpass(x, 320, 2), 5200, 2)
        x = np.tanh(x * 1.6) / np.tanh(1.6)
        x = np.concatenate([x, np.zeros(int(1.4 * SR))])
        return reverb(np.vstack([x, x]), 1.3, 0.28, predelay=0.03), 0.85, words
    if c['line'] == 'answer':
        x = lowpass(highpass(x, 160, 2), 9000, 2)
    else:
        x = highpass(x, 80, 2)
    x = np.concatenate([x, np.zeros(int(0.8 * SR))])
    return reverb(np.vstack([x, x]), 0.7, 0.07, predelay=0.012), 0.9, words


def duck(n, spans, depth_db, attack=0.25, release=0.6):
    """A gain curve that dips by depth_db over each (start, end) span."""
    floor = 10 ** (-depth_db / 20)
    gain = np.ones(n)
    for a, b in spans:
        i0, i1 = int((a - attack) * SR), int(a * SR)
        j0, j1 = int(b * SR), int((b + release) * SR)
        ramp_in = np.linspace(1, floor, max(1, i1 - i0))
        ramp_out = np.linspace(floor, 1, max(1, j1 - j0))
        seg = np.concatenate([ramp_in, np.full(max(0, j0 - i1), floor), ramp_out])
        lo = max(0, i0)
        hi = min(n, i0 + len(seg))
        if hi > lo:
            gain[lo:hi] = np.minimum(gain[lo:hi], seg[lo - i0:hi - i0])
    return gain


# ─── Music ──────────────────────────────────────────────────────────────────

def night_music(bus, t0, t1, hit, ring_stop):
    """D minor pad under the whole night section, with a clock and a pulse."""
    chords = [[50, 57, 62, 65], [46, 53, 58, 62], [43, 50, 55, 58], [45, 52, 57, 61]]  # Dm Bb Gm A
    span = 4.0
    t = t0
    i = 0
    while t < ring_stop - 0.5:
        dur = min(span + 1.8, ring_stop - t + 0.4)
        place(bus, t, pad([midi(n) for n in chords[i % 4]], dur, attack=1.6 if i == 0 else 0.9, release=1.6, cutoff=900), 0.20)
        place(bus, t, sine_bass(midi(chords[i % 4][0] - 12), dur, attack=0.8, release=1.2), 0.16)
        t += span
        i += 1


def clock(bus, a, b):
    k = 0
    t = a
    while t < b:
        place(bus, t, sfx_tick(hi=k % 2 == 0), 0.5 if k % 2 == 0 else 0.4, pan=0.15 if k % 2 else -0.15)
        t += 0.5
        k += 1


def pulse(bus, a, b, bpm=70):
    t = a
    while t < b:
        place(bus, t, kick(0.5), 0.55)
        t += 60 / bpm


def day_music(bus, t0, t1, reveal, build_at, breath=None):
    """F major, 96 bpm, I-V-vi-IV; percussion joins at build_at."""
    bpm = 96
    beat = 60 / bpm
    bar = 4 * beat
    prog = [  # (bass, pad voicing, arpeggio)
        (41, [53, 57, 60, 67], [65, 69, 72, 76, 72, 69, 67, 69]),  # F(add9)
        (36, [52, 55, 60, 64], [64, 67, 72, 76, 72, 67, 64, 67]),  # C/E
        (38, [50, 57, 60, 65], [62, 65, 69, 74, 69, 65, 62, 65]),  # Dm
        (34, [50, 53, 58, 62], [62, 65, 70, 74, 70, 65, 62, 65]),  # Bb
    ]
    # The reveal: one long F add9 swell with a shimmer.
    place(bus, reveal, pad([midi(n) for n in [41, 53, 57, 60, 67, 72]], t0 - reveal + 1.5, attack=0.5, release=1.2, cutoff=2400), 0.5)
    place(bus, reveal, sine_bass(midi(29), t0 - reveal + 0.8, attack=0.4, release=1.0), 0.28)
    for i, n in enumerate([77, 81, 84, 88, 91]):
        place(bus, reveal + 0.35 + i * 0.11, bell(midi(n), 2.4), 0.18, pan=-0.4 + 0.2 * i)
    for k, n in enumerate([65, 69, 72, 77]):
        place(bus, reveal + 1.4 + k * 0.62, pluck(midi(n), 2.0, bright=0.7, decay=1.1), 0.14)
    t = t0
    b = 0
    while t < t1:
        bass, voicing, arp = prog[b % 4]
        end = min(t + bar, t1)
        place(bus, t, pad([midi(n) for n in voicing], bar + 1.2, attack=0.35, release=1.0, cutoff=1500), 0.22)
        quiet = breath is not None and breath[0] <= t < breath[1]
        for k, n in enumerate(arp):
            at = t + k * beat / 2
            if at >= t1:
                break
            vel = (0.9 if k % 2 == 0 else 0.65) * (0.7 if quiet else 1.0)
            place(bus, at, pluck(midi(n), 1.4), 0.15 * vel, pan=-0.25 + 0.5 * (k % 4) / 3)
        if not quiet:
            place(bus, t, sine_bass(midi(bass), bar * 0.95, attack=0.01, release=0.4), 0.2 if t >= build_at else 0.14)
        if t >= build_at and not quiet:
            for k in range(4):
                at = t + k * beat
                if at < t1:
                    if k in (0, 2):
                        place(bus, at, kick(0.7), 0.42)
                    place(bus, at + beat / 2, shaker(), 0.06, pan=0.3)
                    place(bus, at, shaker(0.6), 0.04, pan=-0.3)
        t = end
        b += 1


def resolution_music(bus, t0, t_end, total):
    """Slow and sparse: Dm Bb F C, then F for the end card."""
    seq = [(t0, [50, 57, 62, 65], [74, 69]), (t0 + 2.2, [46, 53, 58, 62], [70, 65]),
           (t0 + 4.4, [41, 53, 57, 60], [72, 69]), (t0 + 6.6, [36, 52, 55, 60], [67, 64])]
    for at, voicing, mel in seq:
        if at >= t_end:
            break
        place(bus, at, pad([midi(n) for n in voicing], 3.4, attack=0.6, release=1.4, cutoff=1300), 0.25)
        for k, n in enumerate(mel):
            place(bus, at + k * 0.55, pluck(midi(n), 2.2, bright=0.6, decay=1.3), 0.15)
    # End card: resolve on F with a rising shimmer.
    place(bus, t_end, pad([midi(n) for n in [41, 53, 57, 60, 65, 69, 72]], total - t_end + 0.5, attack=0.4, release=2.2, cutoff=2000), 0.2)
    place(bus, t_end, sine_bass(midi(29), total - t_end, attack=0.05, release=2.0), 0.18)
    for i, n in enumerate([72, 77, 81, 84]):
        place(bus, t_end + 0.3 + i * 0.13, bell(midi(n), 2.6), 0.11, pan=-0.3 + 0.2 * i)
    for k, n in enumerate([65, 69, 72, 77, 72, 69]):
        place(bus, t_end + 1.2 + k * 0.31, pluck(midi(n), 1.8, bright=0.7), 0.09)


# ─── Assembly ───────────────────────────────────────────────────────────────

def main():
    cues_path, out_path = sys.argv[1], sys.argv[2]
    sfx_only = '--sfx-only' in sys.argv
    data = json.load(open(cues_path))
    total = float(data['duration'])
    cues = data['cues']
    sec = {c['name']: c['t'] for c in cues if c['type'] == 'section'}
    first = lambda kind: next(c['t'] for c in cues if c['type'] == kind)
    n = int((total + 0.5) * SR)
    music = np.zeros((2, n))
    fx = np.zeros((2, n))
    voice = np.zeros((2, n))
    spoken = []

    reveal, day, night2, end = sec['reveal'], sec['day'], sec['night2'], sec['end']
    hit, ring_stop = first('hit'), first('ring-stop')
    ticks = [c['t'] for c in cues if c['type'] == 'tick']
    scramble_a = ticks[0] - 1.9 if ticks else 7.0
    scramble_b = ticks[-1] + 1.9 if ticks else 16.0

    if not sfx_only:
        night_music(music, 0.0, reveal, hit, ring_stop)
        pulse(music, scramble_a, scramble_b)
        day_music(music, day, night2 + 0.4, reveal, build_at=day + 10.0,
                  breath=(sec['night2'] - 5.5, sec['night2']))
        resolution_music(music, night2, end, total)
        clock(fx, scramble_a, scramble_b)

    makers = {
        'tap': lambda c: (sfx_tap(), 0.55), 'buzz': lambda c: (sfx_buzz(), 0.6), 'notif': lambda c: (sfx_notif(), 0.7),
        'pop': lambda c: (sfx_pop(), 0.6), 'pop-soft': lambda c: (sfx_pop(0.6), 0.5), 'tick': lambda c: (sfx_tick(), 0.9),
        'error': lambda c: (sfx_error(), 0.7), 'hit': lambda c: (sfx_hit(), 0.7), 'ring': lambda c: (sfx_ring(), 0.7),
        'whoosh': lambda c: (sfx_whoosh(1.1), 0.8), 'whoosh-soft': lambda c: (sfx_whoosh(0.6, 400, 3000), 0.45),
        'shutter': lambda c: (sfx_shutter(), 0.7), 'scan': lambda c: (sfx_scan(c.get('dur', 1.0)), 0.6),
        'process': lambda c: (sfx_process(c.get('dur', 1.5)), 0.7), 'success': lambda c: (sfx_success(), 0.7),
        'ding': lambda c: (sfx_ding(), 0.6), 'send': lambda c: (sfx_send(), 0.6), 'answer': lambda c: (sfx_answer(), 0.65),
        'mic-on': lambda c: (sfx_mic(), 0.7),
    }
    for c in cues:
        kind = c['type']
        if kind == 'typing':
            count, dur = int(c.get('n', 10)), float(c.get('dur', 1.0))
            step = dur / max(count, 1)
            for k in range(count):
                if RNG.random() < 0.85:
                    place(fx, c['t'] + k * step + RNG.uniform(0, step * 0.3), sfx_key(), 0.22, pan=RNG.uniform(-0.2, 0.2))
        elif kind == 'voice':
            sig, gain, words = voice_line(c)
            place(voice, c['t'], sig, gain)
            spoken.append((c['t'], c['t'] + words))
        elif kind in makers:
            sig, gain = makers[kind](c)
            place(fx, c['t'] - (0.35 if kind == 'whoosh' else 0.0), sig, gain)

    # Nobody answers: everything drops away until the reveal.
    gap_a, gap_b = int((ring_stop + 0.1) * SR), int(reveal * SR)
    if gap_b > gap_a:
        fade = np.linspace(1, 0, min(int(0.35 * SR), gap_b - gap_a))
        music[:, gap_a:gap_a + len(fade)] *= fade
        music[:, gap_a + len(fade):gap_b] = 0

    music = reverb(music, 2.6, 0.30)
    fx = reverb(fx, 1.4, 0.16)
    # Whoever is speaking is heard: the music steps back, the effects a little.
    mix = music * duck(n, spoken, 15) + fx * duck(n, spoken, 4) + voice
    # Gentle fades and a soft limiter.
    fi, fo = int(0.25 * SR), int(1.6 * SR)
    mix[:, :fi] *= np.linspace(0, 1, fi)
    end_i = int(total * SR)
    mix[:, end_i - fo:end_i] *= np.linspace(1, 0, fo)
    mix[:, end_i:] = 0
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    peak = np.max(np.abs(mix))
    mix = mix / peak * 0.89
    pcm = (mix.T * 32767).astype(np.int16)
    import wave
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'{out_path}: {total:.2f}s, {"sfx + voices" if sfx_only else "music + sfx + voices"}')


if __name__ == '__main__':
    main()
