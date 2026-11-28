#!/usr/bin/env python3
"""Koubo smoke check for the bundled 阿杜 / adu-motion-video Python runtime.

This is not the full upstream doctor from adu-motion-video (which also checks
Node, FFmpeg, a browser, and a skill virtualenv). It only verifies that this
interpreter can import the packages in requirements-runtime.txt.

Usage:
    python pipeline.py doctor
"""
from __future__ import annotations

import importlib
import sys

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
    if args[0] == "doctor":
        return doctor()
    print(f"Unknown command: {args[0]}", file=sys.stderr)
    print("Commands: doctor", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
