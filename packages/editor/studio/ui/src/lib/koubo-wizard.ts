/**
 * State machine for the desktop 口播 ingest wizard. Pure: the page and tests both use it.
 * The ElevenLabs draft is kept in memory only; public snapshots never include it.
 */

export type KouboMode = 'talking-head';

export type WizardStatus = 'idle' | 'running' | 'error' | 'done';

export type WizardState = {
  videoPath: string | null;
  videoName: string;
  mode: KouboMode | null;
  /** null: auto-assign from the catalog */
  templateId: string | null;
  title: string;
  hasKey: boolean;
  keyDraft: string;
  status: WizardStatus;
  step: string | null;
  message: string;
  error: string | null;
  projectId: string | null;
};

export const initialWizardState = (hasKey = false): WizardState => ({
  videoPath: null,
  videoName: '',
  mode: null,
  templateId: null,
  title: '',
  hasKey,
  keyDraft: '',
  status: 'idle',
  step: null,
  message: '',
  error: null,
  projectId: null,
});

export function canStartIngest(state: WizardState): boolean {
  if (state.status === 'running') return false;
  if (!state.videoPath) return false;
  if (state.mode !== 'talking-head') return false;
  if (!state.hasKey && !state.keyDraft.trim()) return false;
  return true;
}

export function resolvedTemplateChoice(state: WizardState, autoId: string): { id: string; source: 'user' | 'auto' } {
  if (state.templateId) return { id: state.templateId, source: 'user' };
  return { id: autoId, source: 'auto' };
}

export type WizardAction =
  | { type: 'set-video'; path: string; name?: string }
  | { type: 'clear-video' }
  | { type: 'set-mode'; mode: KouboMode | null }
  | { type: 'set-template'; id: string | null }
  | { type: 'set-title'; title: string }
  | { type: 'set-has-key'; hasKey: boolean }
  | { type: 'set-key-draft'; key: string }
  | { type: 'start' }
  | { type: 'progress'; step: string; message?: string }
  | { type: 'error'; error: string }
  | { type: 'done'; projectId?: string | null }
  | { type: 'reset'; hasKey?: boolean };

export function reduceWizard(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'set-video': {
      const name = action.name || action.path.split(/[\\/]/).pop() || action.path;
      const title = state.title.trim() ? state.title : name.replace(/\.[^.]+$/, '');
      return { ...state, videoPath: action.path, videoName: name, title, error: null, status: state.status === 'error' ? 'idle' : state.status };
    }
    case 'clear-video':
      return { ...state, videoPath: null, videoName: '', error: null };
    case 'set-mode':
      return { ...state, mode: action.mode, error: null };
    case 'set-template':
      return { ...state, templateId: action.id };
    case 'set-title':
      return { ...state, title: action.title };
    case 'set-has-key':
      return { ...state, hasKey: action.hasKey, keyDraft: action.hasKey ? '' : state.keyDraft };
    case 'set-key-draft':
      return { ...state, keyDraft: action.key };
    case 'start':
      if (!canStartIngest(state)) return state;
      return { ...state, status: 'running', step: 'transcribe', message: '', error: null, projectId: null };
    case 'progress':
      if (state.status !== 'running') return state;
      return { ...state, step: action.step, message: action.message || state.message };
    case 'error':
      return { ...state, status: 'error', error: action.error, message: action.error };
    case 'done':
      return { ...state, status: 'done', step: 'done', projectId: action.projectId ?? null, keyDraft: '' };
    case 'reset':
      return initialWizardState(action.hasKey ?? state.hasKey);
    default:
      return state;
  }
}

/** What tests and logs may serialize: the key draft is reduced to a boolean. */
export function publicWizardSnapshot(state: WizardState) {
  const { keyDraft, ...rest } = state;
  return { ...rest, keyEntered: Boolean(keyDraft.trim()) };
}
