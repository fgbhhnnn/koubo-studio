# Bundled 阿杜 Python runtime (desktop)

Desktop installers ship a portable CPython under `resources/runtime/python` and
copy this folder to `resources/runtime/adu`. This is **not** a complete
adu-motion-video product, and it does **not** include official MotionGit
`.motion` packs (those carry a personal account envelope and must not be
redistributed).

`pipeline.py doctor` is a Koubo smoke check: it confirms the bundled
interpreter can import the packages in `requirements-runtime.txt` (the same
ranges as MIT [adu-motion-video](https://github.com/adunext/adu-motion-video)).
It does not run the upstream doctor (Node, FFmpeg, Chrome, skill `.venv`).

## How the app finds Python

1. `KOUBO_PYTHON` if it points at an existing interpreter.
2. The packaged runtime: `resources/runtime/python/bin/python3` (macOS) or
   `resources/runtime/python/python.exe` (Windows).
3. From source only, a `python3` / `python` on `PATH`, if present.

Missing Python must not crash the editor. The current talking-head path in
`packages/koubo` is JavaScript and does not need this runtime. When the 阿杜
pipeline is invoked:

```sh
"$KOUBO_PYTHON" "$KOUBO_ADU_PIPELINE" doctor
```

`KOUBO_ADU_PIPELINE` is the packaged `runtime/adu/pipeline.py` (or this file
when running from this checkout). See `docs/python-runtime.md`.
