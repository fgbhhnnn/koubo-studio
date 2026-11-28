import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignTemplate } from './assign.mjs';

/** Root of this package: catalog, illustration.html, and template folders. */
export const TEMPLATES_ROOT = dirname(fileURLToPath(import.meta.url));
export const CLASSIC_PACK_DIR = join(TEMPLATES_ROOT, 'classic-performance');
export const ILLUSTRATION_HTML = join(TEMPLATES_ROOT, 'illustration.html');

export { assignTemplate };
export {
  assignUnits,
  loadUnitsManifest,
  fillUnitSlots,
  mapUnitClock,
  sourceTimeAt,
  unitBounds,
  classifyBeat,
  splitSentences,
  joinWords,
  sceneById,
  UNITS_MANIFEST_PATH,
} from './assign-units.mjs';
export { bindAuthoredBlock, jsContent, sha256Utf8, PACK_PLAIN_TEXT_RUNTIME } from './bind-unit.mjs';
export { renderUnitPage } from './unit-page.mjs';
export { clipText, twoLines, clauseChunks, splitClauses, softBreaks } from './typography.mjs';
export { renderEvidencePlate, EVIDENCE_PLATE_KEYS } from './evidence-plate.mjs';
export { interpolateFace, faceJs } from './face.mjs';
export { parseUnitCues, remapClipCues, outputTimeAt } from './cues.mjs';



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

/**
 * Resolve a catalog entry to the shape `listTemplates()` returns (with paths),
 * after assignTemplate has chosen an id.
 */
export function resolveAssignedTemplate(opts = {}) {
  const { template, source } = assignTemplate(opts);
  return { template: getTemplate(template.id), source, list: listTemplates() };
}
