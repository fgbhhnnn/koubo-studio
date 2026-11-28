/**
 * Load a module by its address, a few times if the first fetch fails.
 *
 * The edit workbench is a plugin element on Studio's plugins origin (the port
 * two after Studio's: `http://localhost:4749/s/<token>/ui.js` when Studio is on
 * 4747). A page reload that races the plugins server, or one that follows the
 * page renderer exiting while a talking-head preview is drawn, otherwise leaves
 * the shell on the workbench's "did not start" message and "Failed to fetch dynamically
 * imported module", and never tries again. A page that remounts the Studio shell
 * is not started from here: this only retries the import.
 */

export const IMPORT_TRIES = 3;
export const IMPORT_RETRY_MS = 250;

/**
 * `load`: how the module is fetched (`import()` by default). `wait`: the pause
 * between tries. The last refusal is thrown.
 */
export async function importModule<T>(
  url: string,
  load: (url: string) => Promise<T> = (href) => import(/* @vite-ignore */ href) as Promise<T>,
  wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < IMPORT_TRIES; i++) {
    try {
      return await load(url);
    } catch (error) {
      last = error;
      if (i < IMPORT_TRIES - 1) await wait(IMPORT_RETRY_MS * (i + 1));
    }
  }
  throw last;
}
