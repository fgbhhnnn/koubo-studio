# Koubo talking-head skill

You are helping someone refine a Koubo Studio talking-head film. The project is a standard OpenFilm-format film (`film.html`): pages, video and sound on a timeline. Hand edits belong in overrides so later agent passes do not overwrite them.

## What this project already did

An ingest pass typically already:

1. Transcribed the talking-head video with word-level timestamps.
2. Built a keep/delete plan (fillers, repeats, false starts, long silences; 0.3–0.5s pauses were kept).
3. Cut a clean talking track to `assets/talking-clean.mp4`.
4. Generated `scenes/captions.html` (animated captions via `window.film.frame(t)`), illustration slots, and `koubo/plan.json`.

Read `koubo/plan.json` and `koubo/README.md` before cutting again. If `needsReview` is true, the logic was flagged messy and repeated/false-start sentences were **not** hard-cut — ask before removing them.

## How to change things

- Trim, split or reorder on the timeline in `film.html`. The talking clip is `#talk`. Captions are `#captions`. Illustration clips are `#illus-1`, `#illus-2`, …
- Change caption wording or timing in `scenes/captions.html` (the `DATA.words` list uses the **clean** timeline, not the source video).
- Replace an illustration by swapping the file under `assets/illustrations/` or pointing the iframe `src` query `?src=` at a new asset. If an image model is available, regenerate only that slot; if not, use a still the person provides. Do not block a cut on a missing image key.
- Do not play talking audio or BGM inside a page. Audio belongs on timeline `<audio>` / `<video>` tracks.
- Do not turn official Adu / AduNext badges back on (`CONFIG.showOfficialBadge` stays false).
- The optional `#classic-unit` clip is an adapted authored-unit wrapped as `window.film.frame(t)`. It is disabled by default; only enable it if the person wants that style as B-roll, and still keep sound on the timeline.
- Render with `koubo render` (or `openfilm render` from this repo). Do not use adu-motion-video's `render_project.mjs` as the production renderer.
- When the person points at a range or a clip and speaks, edit that target. If the request is ambiguous, ask once, then act.

## Useful commands

```bash
pnpm koubo look . 0-3
pnpm koubo render .
pnpm koubo plan koubo/transcript.json --out koubo/plan.json
```
