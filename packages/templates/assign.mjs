/**
 * Pick a talking-head template from the catalog.
 *
 * If the person named a valid id, that pack is used (`source: 'user'`).
 * If they skipped the picker, auto-assign from talking-head packs (`source: 'auto'`).
 * Today the catalog has one pack (`classic-performance` / 口播讲解). This hook is
 * the place to add plan- or transcript-aware ranking when more packs land — do
 * not hard-code a single id at the call site.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

function readCatalog() {
  return JSON.parse(readFileSync(join(ROOT, 'catalog.json'), 'utf8'));
}

/**
 * @param {{
 *   id?: string | null,
 *   catalog?: { templates?: object[] },
 *   kind?: string,
 * }} [opts]
 * @returns {{ template: object, source: 'user' | 'auto' }}
 */
export function assignTemplate(opts = {}) {
  const catalog = opts.catalog || readCatalog();
  const templates = Array.isArray(catalog.templates) ? catalog.templates : [];
  const kind = opts.kind || 'talking-head';
  const pool = templates.filter((t) => !kind || t.kind === kind);
  const id = typeof opts.id === 'string' && opts.id.trim() ? opts.id.trim() : null;

  if (id) {
    const found = templates.find((t) => t.id === id);
    if (!found) throw new Error(`未知模板：${id}`);
    return { template: found, source: 'user' };
  }

  const auto = pool[0] || templates[0];
  if (!auto) throw new Error('模板目录为空，无法自动分配。');
  return { template: auto, source: 'auto' };
}
