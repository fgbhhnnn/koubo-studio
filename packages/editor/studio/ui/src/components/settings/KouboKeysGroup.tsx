/**
 * Settings → General: the ElevenLabs key used for talking-head (口播) speech-to-text.
 * Stored in ~/.config/koubo/elevenlabs.env (0600) by the desktop host, never in the project tree.
 */
import React from 'react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { SettingsButton, SettingsGroup, SettingsItem, SettingsStatus } from './ui';

export function KouboKeysGroup() {
  const t = useT();
  const koubo = studioHost?.koubo;
  const [status, setStatus] = React.useState<{ hasKey: boolean; last4: string; source: string | null } | null>(null);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const refresh = React.useCallback(async () => {
    if (!koubo) return;
    const next = await koubo.keyStatus();
    setStatus(next);
  }, [koubo]);

  React.useEffect(() => { void refresh(); }, [refresh]);
  if (!koubo) return null;

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setError('');
    try {
      const next = await koubo.setKey(key);
      setStatus(next);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await koubo.setKey('');
      setStatus(next);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup title={t('koubo.settingsGroup')} footnote={t('koubo.keyHint')}>
      <SettingsItem
        title={t('koubo.keyLabel')}
        description={t('koubo.settingsKeyNote')}
        badge={status?.hasKey ? <SettingsStatus>{t('koubo.keyEnding').replace('{last4}', status.last4)}</SettingsStatus> : <SettingsStatus tone="muted">{t('koubo.keyMissing')}</SettingsStatus>}
      >
        <div className="flex flex-col gap-2">
          <input type="password" autoComplete="off" spellCheck={false} value={draft}
            placeholder={status?.hasKey ? t('koubo.keyReplace') : t('koubo.keyPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-field)] px-3 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--text-faint)]" />
          <div className="flex flex-wrap gap-2">
            <SettingsButton variant="primary" disabled={busy || !draft.trim()} onClick={() => void save()}>{t('koubo.keySave')}</SettingsButton>
            {status?.hasKey ? <SettingsButton disabled={busy} onClick={() => void clear()}>{t('koubo.keyClear')}</SettingsButton> : null}
          </div>
          {error ? <p className="text-[13px] text-[var(--danger, #c44848)]">{error}</p> : null}
        </div>
      </SettingsItem>
    </SettingsGroup>
  );
}
