/**
 * Desktop 口播 wizard: upload a talking-head video, choose 口播, optionally pick
 * a template, then run the existing koubo ingest pipeline in one action.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Check, Clapperboard, KeyRound, LoaderCircle, Upload } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import {
  canStartIngest, initialWizardState, reduceWizard, type WizardState,
} from '@/lib/koubo-wizard';
import { Card, CardActions, CardButton } from './Card';

type TemplateCard = {
  id: string;
  kind: string;
  name: { 'zh-CN'?: string; en?: string };
  description?: string;
};

export function KouboIngestWizard({ open, onClose, onOpened }: {
  open: boolean;
  onClose: () => void;
  /** The Studio project id after a successful run, so the library can open it. */
  onOpened: (projectId: string) => void;
}) {
  const t = useT();
  const koubo = studioHost?.koubo;
  const [state, dispatch] = React.useReducer(reduceWizard, undefined, () => initialWizardState(false));
  const [templates, setTemplates] = React.useState<TemplateCard[]>([]);
  const latest = React.useRef({ state, onClose, onOpened });
  latest.current = { state, onClose, onOpened };

  React.useEffect(() => {
    if (!open || !koubo) return;
    let cancelled = false;
    void Promise.all([koubo.keyStatus(), koubo.templates()]).then(([status, list]) => {
      if (cancelled) return;
      dispatch({ type: 'set-has-key', hasKey: Boolean(status.hasKey) });
      setTemplates(list.filter((item) => !item.kind || item.kind === 'talking-head'));
    }, () => {});
    return () => { cancelled = true; };
  }, [open, koubo]);

  React.useEffect(() => {
    if (!open || !koubo?.onProgress) return;
    return koubo.onProgress((event) => {
      if (latest.current.state.status !== 'running') return;
      dispatch({ type: 'progress', step: event.step, message: event.message });
    });
  }, [open, koubo]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || latest.current.state.status === 'running') return;
      e.preventDefault();
      latest.current.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open || !koubo) return null;

  const nameOf = (item: TemplateCard) => item.name['zh-CN'] || item.name.en || item.id;
  const busy = state.status === 'running';
  const canRun = canStartIngest(state);

  const pickVideo = async () => {
    const path = await koubo.pickVideo({ title: t('koubo.pickVideo'), button: t('koubo.upload') });
    if (path) dispatch({ type: 'set-video', path });
  };

  const run = async () => {
    if (!canStartIngest(latest.current.state)) return;
    dispatch({ type: 'start' });
    const current = { ...latest.current.state, status: 'running' as const };
    const result = await koubo.ingest({
      video: current.videoPath!,
      title: current.title.trim() || undefined,
      templateId: current.templateId,
      apiKey: current.hasKey ? undefined : current.keyDraft.trim() || undefined,
      saveKey: true,
    });
    if (!result.ok) {
      dispatch({ type: 'error', error: result.error || t('koubo.runFailed') });
      return;
    }
    dispatch({ type: 'done', projectId: result.projectId ?? null });
    if (result.projectId) latest.current.onOpened(result.projectId);
  };

  const body = (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !busy) onClose();
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="koubo-wizard-title" className="w-full max-w-[560px]" onMouseDown={(e) => e.stopPropagation()}>
        <Card title={<span id="koubo-wizard-title">{t('koubo.wizardTitle')}</span>} body={t('koubo.wizardHint')} onClose={busy ? undefined : onClose} className="px-5 pb-4 pt-4">
          <ol className="mt-4 flex flex-col gap-4">
            <li className="flex flex-col gap-2">
              <Label n={1}>{t('koubo.stepVideo')}</Label>
              <button type="button" disabled={busy} onClick={() => void pickVideo()}
                className="flex h-12 items-center gap-3 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-field)] px-3 text-left text-[14px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-60">
                <Upload size={16} className="shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 truncate">{state.videoName || t('koubo.pickVideo')}</span>
              </button>
              {state.videoPath ? (
                <label className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
                  {t('koubo.titleLabel')}
                  <input value={state.title} disabled={busy} onChange={(e) => dispatch({ type: 'set-title', title: e.target.value })}
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 text-[14px] text-[var(--text)] outline-none focus:border-[var(--text-faint)]" />
                </label>
              ) : null}
            </li>
            <li className="flex flex-col gap-2">
              <Label n={2}>{t('koubo.stepMode')}</Label>
              <button type="button" disabled={busy} aria-pressed={state.mode === 'talking-head'} onClick={() => dispatch({ type: 'set-mode', mode: 'talking-head' })}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${state.mode === 'talking-head' ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] bg-[var(--bg-field)] hover:bg-[var(--bg-hover)]'}`}>
                <Clapperboard size={16} className="shrink-0" />
                <span className="min-w-0">
                  <strong className="block text-[14px] font-medium">{t('koubo.modeTalking')}</strong>
                  <small className="block text-[12.5px] text-[var(--text-muted)]">{t('koubo.modeTalkingNote')}</small>
                </span>
                {state.mode === 'talking-head' ? <Check size={16} className="ml-auto shrink-0" /> : null}
              </button>
            </li>
            <li className="flex flex-col gap-2">
              <Label n={3}>{t('koubo.stepTemplate')}</Label>
              <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">{t('koubo.templateHint')}</p>
              <div className="flex flex-col gap-1.5">
                <TemplateChoice selected={state.templateId === null} disabled={busy} title={t('koubo.templateAuto')} note={t('koubo.templateAutoNote')}
                  onClick={() => dispatch({ type: 'set-template', id: null })} />
                {templates.map((item) => (
                  <TemplateChoice key={item.id} selected={state.templateId === item.id} disabled={busy}
                    title={nameOf(item)} note={item.description || t('koubo.templatePackNote')}
                    onClick={() => dispatch({ type: 'set-template', id: item.id })} />
                ))}
              </div>
            </li>
            {!state.hasKey ? (
              <li className="flex flex-col gap-2">
                <Label n={4}>{t('koubo.stepKey')}</Label>
                <label className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
                  <span className="flex items-center gap-1.5"><KeyRound size={13} />{t('koubo.keyLabel')}</span>
                  <input type="password" autoComplete="off" spellCheck={false} disabled={busy} value={state.keyDraft}
                    placeholder={t('koubo.keyPlaceholder')}
                    onChange={(e) => dispatch({ type: 'set-key-draft', key: e.target.value })}
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--text-faint)]" />
                </label>
                <p className="text-[12px] leading-relaxed text-[var(--text-faint)]">{t('koubo.keyHint')}</p>
              </li>
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)]">{t('koubo.keyReady')}</p>
            )}
          </ol>
          {state.status === 'running' || state.message || state.error ? (
            <p className={`mt-4 flex items-start gap-2 text-[13px] ${state.status === 'error' ? 'text-[var(--danger, #c44848)]' : 'text-[var(--text-muted)]'}`} role="status">
              {state.status === 'running' ? <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" /> : null}
              <span>{state.error || state.message || t('koubo.running')}</span>
            </p>
          ) : null}
          <CardActions>
            <CardButton type="button" disabled={busy} onClick={onClose}>{t('koubo.cancel')}</CardButton>
            <CardButton type="button" weight="primary" disabled={!canRun} onClick={() => void run()}>{busy ? t('koubo.running') : t('koubo.run')}</CardButton>
          </CardActions>
        </Card>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

function Label({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[11px] tabular-nums">{n}</span>
      {children}
    </div>
  );
}

function TemplateChoice({ selected, disabled, title, note, onClick }: {
  selected: boolean; disabled?: boolean; title: string; note: string; onClick: () => void;
}) {
  return (
    <button type="button" disabled={disabled} aria-pressed={selected} onClick={onClick}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left transition ${selected ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'} disabled:opacity-60`}>
      <span className="min-w-0 flex-1">
        <strong className="block text-[13.5px] font-medium text-[var(--text)]">{title}</strong>
        <small className="block text-[12px] leading-relaxed text-[var(--text-muted)]">{note}</small>
      </span>
      {selected ? <Check size={14} className="mt-0.5 shrink-0" /> : null}
    </button>
  );
}

export function useKouboWizard() {
  const [open, setOpen] = React.useState(false);
  const koubo = studioHost?.koubo;
  React.useEffect(() => {
    if (!koubo?.onOpenWizard) return;
    return koubo.onOpenWizard(() => setOpen(true));
  }, [koubo]);
  return { open, setOpen, available: Boolean(koubo) };
}
