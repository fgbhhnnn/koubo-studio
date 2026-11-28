/**
 * Visual thumbnail for a talking-head template. `src` is a data URL from the
 * catalog (never a filesystem path).
 */
export function KouboTemplatePreview({ src, alt, className }: {
  src?: string;
  alt: string;
  className?: string;
}) {
  if (!src) return null;
  return <img src={src} alt={alt} draggable={false} className={className ?? 'h-[72px] w-[128px] shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg-field)] object-cover'} />;
}
