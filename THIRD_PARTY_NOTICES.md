# Third-party notices

Studio's editor (`studio/ui/dist`) bundles:

- **Inter** by Rasmus Andersson, via `@fontsource-variable/inter`: SIL Open Font License 1.1
  (https://openfontlicense.org).
- **React** and **React DOM**: MIT License, © Meta Platforms, Inc. and affiliates.
- **Lucide** icons (`lucide-react`): ISC License, © Lucide Contributors.

The CLI depends on **playwright-core** (Apache License 2.0), which downloads a headless Chromium on first use.

Desktop installers also bundle:

- **CPython** (PSF License, https://docs.python.org/3/license.html), delivered
  as a relocatable build from **python-build-standalone** (Mozilla Public
  License 2.0, https://github.com/astral-sh/python-build-standalone). The
  staged tree includes a `SOURCE` file naming the exact archive.
- **numpy**: BSD License.
- **Pillow**: Historical Permission Notice and Disclaimer (HPND).
- **SciPy**: BSD License.
- **opencv-python-headless** (OpenCV): Apache License 2.0. The GUI and CUDA
  OpenCV packages are not shipped.
- **fonttools**: MIT License.

Version ranges follow `apps/desktop/runtime/adu/requirements-runtime.txt`,
copied from adu-motion-video (MIT). Official MotionGit `.motion` packs are
not included.
