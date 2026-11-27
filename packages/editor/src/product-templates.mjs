/**
 * Koubo product templates (talking-head caption + illustration packs).
 *
 * These are first-class in this project: ingest (`packages/koubo`), this editor
 * module, and Studio all resolve them from `@koubo/templates`. They are not the
 * same format as `library/templates` (saved.json starters with posters).
 */
export {
  listTemplates,
  getTemplate,
  templatePath,
  TEMPLATES_ROOT,
  CLASSIC_PACK_DIR,
  ILLUSTRATION_HTML,
} from '@koubo/templates';
