#!/usr/bin/env python3
"""Koubo entry point for the bundled 阿杜 / adu-motion-video Python runtime.

Commands:
    doctor         Smoke-check that runtime wheels import (numpy, pillow, scipy,
                   opencv-python-headless, fonttools).
    prepare-talk   Sample the clean talking-head track and write a face track
                   on a 60fps clock (Haar / wide-fixed fallback).
    mix-sfx        Synthesize remapped unit action cues onto an output-clock WAV.

This is not the full upstream adu-motion-video doctor (Node, FFmpeg, Chrome,
skill venv). Official MotionGit .motion packs are never loaded here.

Usage:
    python pipeline.py doctor
    python pipeline.py prepare-talk --video talking-clean.mp4 --out DIR
    python pipeline.py mix-sfx --cues cues.json --out unit-sfx.wav
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

MODULES = (
    ("numpy", "numpy"),
    ("PIL", "pillow"),
    ("scipy", "scipy"),
    ("cv2", "opencv-python-headless"),
    ("fontTools", "fonttools"),
)


def doctor() -> int:
    print(f"Python {sys.version}")
    print(f"Executable {sys.executable}")
    failures: list[str] = []
    for module, package in MODULES:
        try:
            imported = importlib.import_module(module)
            version = getattr(imported, "__version__", None)
            if version is None:
                version = getattr(imported, "VERSION", "present")
            print(f"OK  {package}: {version}")
        except Exception as exc:  # noqa: BLE001 — report any import failure
            print(f"MISSING  {package}: {exc}")
            failures.append(package)
    if failures:
        print("Failed: " + ", ".join(failures))
        return 1
    print("Bundled 阿杜 runtime packages are importable.")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print(__doc__)
        return 0
    command = args[0]
    if command == "doctor":
        return doctor()
    if command == "prepare-talk":
        sys.path.insert(0, str(HERE))
        from face_track import main as prepare
        return prepare(args[1:])
    if command == "mix-sfx":
        sys.path.insert(0, str(HERE))
        from sfx import main as mix
        return mix(args[1:])
    print(f"Unknown command: {command}", file=sys.stderr)
    print("Commands: doctor, prepare-talk, mix-sfx", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
