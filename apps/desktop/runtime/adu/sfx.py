"""Procedural unit SFX, remapped onto the film output clock.

Adapted from MIT adu-motion-video scripts/audiolib.py (whoosh, hit, ding,
click, and related action cues). Cues must already be on the output clock.
"""
from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
rng = np.random.default_rng(29011)


def T(d):
    return np.arange(max(1, int(SR * d))) / SR


def lowpass(x, fc, k=255):
    t = np.arange(k) - (k - 1) / 2
    h = np.sinc(2 * fc / SR * t) * np.hamming(k)
    h /= h.sum()
    return np.convolve(x, h, 'same')


def highpass(x, fc):
    return x - lowpass(x, fc)


def pan(x, p):
    p = np.clip(p, -1, 1)
    return np.stack([x * np.sqrt((1 - p) / 2), x * np.sqrt((1 + p) / 2)], 1)


def add(buf, x, t0, g=1.0):
    start = int(t0 * SR)
    if x.ndim == 1:
        x = pan(x, 0)
    end = start + len(x)
    if start >= len(buf) or end <= 0:
        return
    a = max(0, start)
    b = min(len(buf), end)
    buf[a:b] += x[(a - start):(b - start)] * g


def whoosh(d=.45, bright=2500):
    t = T(d)
    n = highpass(rng.standard_normal(len(t)), 200)
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
    return lowpass(n, bright) * env * .7


def swoosh(d=.5):
    return whoosh(d, 1800)


def hit(g=1.):
    t = T(.18)
    body = np.sin(2 * np.pi * 90 * t) * np.exp(-t * 28)
    click = highpass(rng.standard_normal(len(t)), 2000) * np.exp(-t * 80)
    return (body * .8 + click * .35) * g


def ding(m=88, d=1.0):
    t = T(d)
    return np.sin(2 * np.pi * (440 * 2 ** ((m - 69) / 12)) * t) * np.exp(-t * 3.2) * .38


def click():
    t = T(.02)
    return highpass(rng.standard_normal(len(t)), 2500) * np.exp(-t * 350) * .45


def card():
    t = T(.12)
    return lowpass(rng.standard_normal(len(t)), 1400) * np.exp(-t * 40) * .5


def tick():
    t = T(.04)
    return highpass(rng.standard_normal(len(t)), 3000) * np.exp(-t * 200) * .35


def swipe():
    return whoosh(.28, 3200)


def stamp():
    t = T(.22)
    return (lowpass(rng.standard_normal(len(t)), 700) * np.exp(-t * 22) + np.sin(2 * np.pi * 70 * t) * np.exp(-t * 18)) * .7


def slash():
    return whoosh(.2, 4000) * .8


def ff():
    t = T(.65)
    return highpass(rng.standard_normal(len(t)), 800) * np.sin(np.pi * np.clip(t / .65, 0, 1)) * .25


SYNTH = {
    'whoosh': whoosh, 'swoosh': swoosh, 'hit': hit, 'ding': ding, 'click': click,
    'card': card, 'tick': tick, 'swipe': swipe, 'stamp': stamp, 'slash': slash, 'ff': ff,
}


def mix_cues(events, duration, gain=0.55):
    n = max(1, int(SR * max(duration, 0.1)))
    buf = np.zeros((n, 2), dtype=np.float64)
    for event in events:
        kind = event.get('type')
        synth = SYNTH.get(kind)
        if synth is None:
            continue
        sample = synth() if kind not in {'whoosh', 'swoosh', 'hit', 'ding'} else (
            whoosh() if kind in {'whoosh', 'swoosh'} else hit(event.get('g', 1)) if kind == 'hit' else ding()
        )
        add(buf, sample, float(event.get('t') or 0), g=float(event.get('g') or 1) * gain)
        # pan
        if abs(float(event.get('p') or 0)) > 1e-6 and sample.ndim == 1:
            pass
    peak = np.max(np.abs(buf)) if len(buf) else 0
    if peak > 0.95:
        buf *= 0.95 / peak
    return np.clip(buf, -1, 1)


def write_wav(path: Path, buf):
    pcm = (buf * 32767).astype(np.int16)
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(SR)
        out.writeframes(pcm.tobytes())


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(prog='mix-sfx')
    parser.add_argument('--cues', required=True, help='JSON {duration, events:[{t,type,g,p}]}')
    parser.add_argument('--out', required=True)
    args = parser.parse_args(argv)
    try:
        data = json.loads(Path(args.cues).read_text(encoding='utf-8'))
        duration = float(data.get('duration') or 0)
        events = data.get('events') or []
        if not isinstance(events, list):
            raise ValueError('events must be a list')
        buf = mix_cues(events, duration)
        path = Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        write_wav(path, buf)
        print(json.dumps({'out': str(path), 'events': len(events), 'duration': duration}))
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
