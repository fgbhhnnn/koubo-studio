import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of this package: catalog, illustration.html, and template folders. */
export const TEMPLATES_ROOT = dirname(fileURLToPath(import.meta.url));
export const CLASSIC_PACK_DIR = join(TEMPLATES_ROOT, 'classic-performance');
export const ILLUSTRATION_HTML = join(TEMPLATES_ROOT, 'illustration.html');

export function loadCatalog() {
  return JSON.parse(readFileSync(join(TEMPLATES_ROOT, 'catalog.json'), 'utf8'));
}

/**
 * Product talking-head templates. The ingest pipeline and the editor both resolve
 * packs from here — they are not one-off HTML written only at the end of ingest.
 */
export function listTemplates() {
  const catalog = loadCatalog();
  return (catalog.templates || []).map((t) => ({
    ...t,
    path: t.dir ? join(TEMPLATES_ROOT, t.dir) : TEMPLATES_ROOT,
    illustrationPath: t.illustration ? join(TEMPLATES_ROOT, t.illustration) : null,
  }));
}

export function getTemplate(id) {
  const found = listTemplates().find((t) => t.id === id);
  if (!found) throw new Error(`未知模板：${id}`);
  return found;
}

export function templatePath(id) {
  return getTemplate(id).path;
}
