/**
 * How the window brings a tab back after its page renderer exits.
 *
 * A talking-head film (full-frame unit pages, a muted picture-in-picture talk
 * video inside those that are awake, face-crop work on the first frame) can
 * take the renderer down as the preview is drawn. The window used to reload
 * the tab 500 ms later, every time, without end: each reload remounts the
 * whole Studio shell (the logo and "正在打开项目") until a later load can no
 * longer fetch the edit workbench from the plugins' origin (Studio's port + 2,
 * `http://localhost:4749/s/<token>/ui.js` when Studio is on 4747).
 *
 * Quick exits are retried a few times with backoff, then left; a page that ran
 * a while is brought back once, as before. A deliberate quit cancels a pending
 * reload. Reads no Electron module, so `node --test` can use it.
 */
export const RELOAD_MS = 500;
export const RELOAD_MAX_MS = 8_000;
export const SETTLED_MS = 30_000;
export const MAX_QUICK_RELOADS = 3;

/** The wait before the next reload: `last`, the wait before this one (0: none); `ran`, how long the page ran (ms). */
export function reloadDelay(last, ran) {
  if (ran >= SETTLED_MS || !last) return RELOAD_MS;
  return Math.min(RELOAD_MAX_MS, last * 2);
}

/**
 * Retry after the page renderer exits. `reload` brings the tab back; `onRetry`
 * is told the wait; `onGiveUp` when quick crashes are not retried again.
 */
export function pageRendererReloads({ reload, onRetry, onGiveUp }) {
  let wait = 0;
  let quick = 0;
  let timer = null;
  let stopped = false;

  function afterGone(ran) {
    if (stopped || timer !== null) return;
    if (ran >= SETTLED_MS) quick = 0;
    else quick += 1;
    if (quick > MAX_QUICK_RELOADS) {
      onGiveUp?.();
      return;
    }
    wait = reloadDelay(wait, ran);
    onRetry?.(wait);
    timer = setTimeout(() => {
      timer = null;
      reload();
    }, wait);
  }

  return {
    afterGone,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
