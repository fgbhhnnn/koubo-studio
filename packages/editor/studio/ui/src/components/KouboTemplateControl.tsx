/**
 * After a 口播 ingest, let the person change the talking-head template from the editor top bar.
 */
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { Tooltip } from './Tooltip';
import { KouboTemplatePreview } from './KouboTemplatePreview';

type TemplateCard = { id: string; name: { 'zh-CN'?: string; en?: string }; preview?: string };

export function KouboTemplateControl({ projectPath }: { projectPath?: string | null }) {
  const t = useT();
  const koubo = studioHost?.koubo;
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [workflow, setWorkflow] = React.useState<{ templateId: string | null; templateSource: string | null } | null>(null);
  const [templates, setTemplates] = React.useState<TemplateCard[]>([]);

  React.useEffect(() => {
    if (!koubo || !projectPath) { setWorkflow(null); return; }
    let cancelled = false;
    void Promise.all([koubo.workflow(projectPath), koubo.templates()]).then(([info, list]) => {
      if (cancelled) return;
      setWorkflow(info && info.mode === 'talking-head' ? info : null);
      setTemplates(list);
    }, () => { if (!cancelled) setWorkflow(null); });
    return () => { cancelled = true; };
  }, [koubo, projectPath]);

  if (!koubo || !projectPath || !workflow) return null;

  const nameOf = (id: string | null) => {
    const found = templates.find((item) => item.id === id);
    return found?.name['zh-CN'] || found?.name.en || id || t('koubo.templateAuto');
  };

  const apply = async (id: string) => {
    if (!id || id === workflow.templateId || busy) return;
    setBusy(true);
    setError('');
    setOpen(false);
    const result = await koubo.changeTemplate({ path: projectPath, templateId: id });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || t('koubo.templateChangeFailed'));
      return;
    }
    setWorkflow({ templateId: result.templateId ?? id, templateSource: result.templateSource ?? 'user' });
    window.location.reload();
  };

  return (
    <div className="relative" data-koubo-template="">
      <Tooltip label={t('koubo.templateControl')} side="bottom">
        <button type="button" disabled={busy} aria-haspopup="listbox" aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-[26px] max-w-[200px] shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-60">
          <span className="truncate">{t('koubo.templateControl')}: {nameOf(workflow.templateId)}</span>
          <ChevronDown size={12} />
        </button>
      </Tooltip>
      {open ? (
        <div role="listbox" className="absolute right-0 top-[30px] z-[80] min-w-[260px] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] py-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.4)]">
          {templates.map((item) => (
            <button key={item.id} type="button" role="option" aria-selected={item.id === workflow.templateId}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] hover:bg-[var(--bg-hover)] ${item.id === workflow.templateId ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}
              onClick={() => void apply(item.id)}>
              <KouboTemplatePreview src={item.preview} alt={t('koubo.templatePreview')} className="h-10 w-[72px] shrink-0 rounded border border-[var(--border)] bg-[var(--bg-field)] object-cover" />
              <span className="min-w-0 flex-1 truncate">{item.name['zh-CN'] || item.name.en || item.id}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <span className="sr-only">{error}</span> : null}
    </div>
  );
}
