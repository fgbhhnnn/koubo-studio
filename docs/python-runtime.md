# Portable Python runtime in Koubo Studio

Desktop installers for Windows x64, macOS Apple 芯片, and macOS Intel include a
portable CPython so people do not have to install Python themselves. This is
for the 阿杜 / [adu-motion-video](https://github.com/adunext/adu-motion-video)
(MIT) Python pipeline. The talking-head path in `packages/koubo` is JavaScript first. When a resolver finds Python, ingest also runs `prepare-talk` (face track on a 60fps clock) and `mix-sfx` (unit cues remapped to the film clock). Missing Python must not fail ingest.

Official MotionGit `.motion` packs are **not** included (they carry a personal
account envelope and must not be redistributed). A complete 阿杜 feature UI is
not part of this packing work; the installer ships the runtime, its
dependencies, and a clear way to call it.

There is no Linux desktop installer, so no Linux CPython is packed.

## What is downloaded and staged

During `pnpm --filter @koubo/desktop release` (and `.github/workflows/desktop.yml`):

1. A pinned [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
   `install_only_stripped` archive (CPython 3.12.16, release `20261124`) is
   fetched, checksummed (sha256), and extracted to `runtime/python`.
2. The packages in `apps/desktop/runtime/adu/requirements-runtime.txt` are
   installed as **wheels only** (`opencv-python-headless`, not the GUI or CUDA
   OpenCV builds):
   - `numpy>=1.26,<3`
   - `pillow>=10,<13`
   - `scipy>=1.11,<2`
   - `opencv-python-headless>=4.8,<6`
   - `fonttools>=4.50,<5`
3. The smoke-check scripts are copied to `runtime/adu`.
4. Host pip always installs with `--platform`, `--only-binary=:all:` and
   `--target` (macOS 12 tags, or `win_amd64`). Windows installers are built on
   macOS; the same path keeps a macOS 15 packer from picking macOS 15-only
   OpenCV wheels.
5. When the extracted interpreter can run on the packing machine,
   `runtime/adu/pipeline.py doctor` is executed
   as a smoke check (imports the five packages). That script is a Koubo check,
   not the full upstream adu-motion-video doctor (which also looks for Node,
   FFmpeg, Chrome, and a skill `.venv`).

Archives are cached under `~/.cache/koubo-python` (or `KOUBO_PYTHON_CACHE`).
CI caches that directory too. Nothing is committed to the repository.

## Where it lives in the app

electron-builder `extraResources` already copies the staging `runtime/` folder:

| Packaged path (macOS) | Packaged path (Windows) | What |
| --- | --- | --- |
| `Koubo Studio.app/Contents/Resources/runtime/python/bin/python3` | `resources/runtime/python/python.exe` | Interpreter |
| `…/runtime/python/lib/python3.12/site-packages` | `resources/runtime/python/Lib/site-packages` | 阿杜 wheels |
| `…/runtime/adu/pipeline.py` | `resources/runtime/adu/pipeline.py` | Smoke check |

The staging folder during a build is `apps/desktop/.release/<arch>/runtime/`
(git-ignored).

## How the app locates it

`apps/desktop/src/python-runtime.mjs` exports `resolvePython`. Order:

1. `KOUBO_PYTHON`, if it points at an existing file.
2. The packaged runtime (`process.resourcesPath/runtime/python`), when the app
   is packed and the interpreter is there.
3. From source only, `python3` or `python` on `PATH`.

Missing Python returns `null` and does **not** throw. The desktop main process
sets, when an interpreter is found:

- `KOUBO_PYTHON` — absolute path of the interpreter
- `KOUBO_ADU_PIPELINE` — absolute path of `pipeline.py`
- `PYTHONNOUSERSITE=1` — do not mix in the person's user site-packages
- the interpreter's directory, prepended to `PATH`

Those variables are also given to Studio and to the `koubo` command the agents
run. Call path:

```sh
"$KOUBO_PYTHON" "$KOUBO_ADU_PIPELINE" doctor
```

Python is not downloaded when the app starts from source. The editor must
still open if no interpreter is found.

## Size impact

The previous unsigned Windows installer (without this runtime) was about
350 MB. This runtime will grow the installers. Measured from the pinned
CPython archives and a `pip download` of the current wheel ranges (2026-11-28):

| Piece | Compressed | Unpacked in the app |
| --- | --- | --- |
| CPython 3.12.16 `install_only_stripped` | 21–24 MB (Windows 21.4, mac Intel 23.8, Apple 芯片 24.1) | ~98 MB (Apple 芯片 archive) |
| Runtime wheels (headless OpenCV, numpy, scipy, pillow, fonttools) | 98–106 MB | 297–322 MB |
| **Total added** | **about 120–130 MB downloaded** | **about 400 MB on disk** |

The `.dmg` / `.exe` will recompress those files; expect the installer to grow
by roughly **120–180 MB**, with the exact number visible on the next desktop
pack. OpenCV, SciPy and NumPy dominate. GPU / GUI OpenCV builds are not
installed.

On macOS, wheels are resolved for the `macosx_12_0` platform tag, so the
bundled Python stack needs **macOS 12+**. A newer tag would let pip pick
OpenCV 5.x wheels that only run on macOS 15. Windows uses `win_amd64`.

## Tests

`apps/desktop/src/python-runtime.test.mjs` covers resolver order, a missing
runtime (no throw), checksum retries, and staging for a pack target with a
fixture archive (no live download, no API keys).
`apps/desktop/scripts/release.test.mjs` checks that the pack script stages
Python. After CI packaging, `scripts/check-staged-python.mjs` asserts the
staged tree, and on mac-arm64 runs `pipeline.py doctor`.
