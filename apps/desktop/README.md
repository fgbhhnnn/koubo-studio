# Koubo Studio for desktop

Studio, with a chat beside it, as an Electron app. The product name is **Koubo Studio**, not OpenFilm. This is not an official OpenFilm release.

## Run from source

From the repository root:

```sh
pnpm install
pnpm dev:desktop
```

Or in this directory, after a root `pnpm install`:

```sh
npm start            # builds the window's page, then runs the app as "Koubo Studio Dev"
npm test
npm run typecheck
```

`node bench/media-menu.test.mjs` builds and checks empty and populated media-pane menus in an isolated Electron app, with file pickers cancelled.

Run from source, the app is its own "Koubo Studio Dev": its own name, data folder, Studio home and port, so it never shares anything with an installed Koubo Studio. Its renamed copy of Electron lives in `.dev/` (git-ignored).

## Builds

`npm run release` (or `pnpm --filter @koubo/desktop release`) builds the app into `.release/` (git-ignored).

Without `KOUBO_SIGN_IDENTITY` / `APPLE_TEAM_ID` it is **unsigned and not notarized**, same as `--unsigned`. A build of this source uses `product.json` (empty update feed: the app never looks for updates). Do not pass `--official` unless you have first set a Koubo update feed in `packages/editor/product.official.json`; that file must not point at openfilm.dev.

Typical local commands:

```sh
npm run release -- --unsigned
npm run release -- --unsigned --arch=x64
npm run release -- --unsigned --platform=win --arch=x64
```

Installers are named `Koubo-Studio-arm64.dmg`, `Koubo-Studio-x64.dmg`, and `Koubo-Studio-Setup-x64.exe`.

On an unsigned macOS build, allow the app in System Settings → Privacy & Security, or Control-click → Open. On Windows, SmartScreen may ask once: More info → Run anyway.

CI on GitHub Actions packages Windows and macOS this way and uploads the artifacts; version tags also attach them to a GitHub Release. See [`docs/desktop-ci.md`](../../docs/desktop-ci.md). See the repo [`TRADEMARK.md`](../../TRADEMARK.md) and [`UPSTREAM.md`](../../UPSTREAM.md) before distributing a build of your own.
