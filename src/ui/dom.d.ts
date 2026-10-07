type Snapshot = ReturnType<typeof import('../core/service.js').snapshot>;
type ParseResult = ReturnType<typeof import('../core/service.js').reparse>;
type UiCommand<Options, Result> = { options: Options; result: Result };
interface UiCommands {
  snapshot: UiCommand<undefined, Snapshot>;
  folder: UiCommand<undefined, Snapshot>;
  setup: UiCommand<{ names: string[] }, Snapshot>;
  'update-household': UiCommand<{ edits: Array<{ id: string; displayName: string }> }, Snapshot>;
  sync: UiCommand<
    { fullRefresh?: boolean } | undefined,
    ParseResult & { fetched: Array<{ member: string; claims: number }> }
  >;
  parse: UiCommand<{ dryRun?: boolean } | undefined, ParseResult>;
  'archive-help': UiCommand<undefined, ReturnType<typeof import('../core/service.js').archiveHelp>>;
  'recover-lock': UiCommand<undefined, ReturnType<typeof import('../core/service.js').recoverLock>>;
  export: UiCommand<undefined, ReturnType<typeof import('../core/service.js').exportCsv> | null>;
  'open-folder': UiCommand<undefined, undefined>;
  'open-document': UiCommand<{ file: string; sha256: string }, undefined>;
  'review-document': UiCommand<{ file: string; sha256: string; supporting: boolean }, undefined>;
  cancel: UiCommand<undefined, undefined>;
  confirm: UiCommand<{ accepted: boolean }, undefined>;
}
type UiArgs<K extends keyof UiCommands> = undefined extends UiCommands[K]['options']
  ? [options?: UiCommands[K]['options']]
  : [options: UiCommands[K]['options']];
type UiResponse<T> =
  { ok: true; result: T } | { ok: false; error: { code: string; message: string } };
type UiProgress =
  | { type: 'confirm'; memberId: string; displayName: string; claimCount: number }
  | { type: 'household'; names: string[] }
  | { type?: 'progress'; message: string; phase?: string; current?: number; total?: number };

interface Window {
  scupa: {
    call<K extends keyof UiCommands>(
      command: K,
      ...args: UiArgs<K>
    ): Promise<UiResponse<UiCommands[K]['result']>>;
    onProgress(callback: (event: UiProgress) => void): () => void;
  };
}
interface UiElements {
  sync: HTMLButtonElement;
  'full-sync': HTMLButtonElement;
  'last-sync': HTMLElement;
  setup: HTMLElement;
  names: HTMLTextAreaElement;
  'setup-archive-path': HTMLElement;
  'save-setup': HTMLButtonElement;
  'choose-folder': HTMLButtonElement;
  progress: HTMLElement;
  'progress-title': HTMLElement;
  'progress-detail': HTMLElement;
  cancel: HTMLButtonElement;
  message: HTMLElement;
  'recovery-actions': HTMLElement;
  'error-help': HTMLButtonElement;
  dashboard: HTMLElement;
  'claim-count': HTMLElement;
  'awaiting-count': HTMLElement;
  'paid-total': HTMLElement;
  'result-count': HTMLElement;
  export: HTMLButtonElement;
  search: HTMLInputElement;
  member: HTMLSelectElement;
  status: HTMLSelectElement;
  claims: HTMLElement;
  empty: HTMLElement;
  'archive-path': HTMLElement;
  'open-folder': HTMLButtonElement;
  'change-folder': HTMLButtonElement;
  'edit-household': HTMLButtonElement;
  reparse: HTMLButtonElement;
  'archive-help': HTMLButtonElement;
  version: HTMLElement;
  privacy: HTMLButtonElement;
  confirmation: HTMLDialogElement;
  'confirm-name': HTMLElement;
  'confirm-count': HTMLElement;
  'confirm-instructions': HTMLElement;
  'confirm-accept': HTMLButtonElement;
  'household-editor': HTMLDialogElement;
  'household-title': HTMLElement;
  'household-form': HTMLFormElement;
  'household-fields': HTMLElement;
  'household-error': HTMLElement;
  'close-household': HTMLButtonElement;
  'save-household': HTMLButtonElement;
  'help-dialog': HTMLDialogElement;
  'help-title': HTMLElement;
  'help-lock': HTMLElement;
  'recover-lock': HTMLButtonElement;
  'help-summary': HTMLElement;
  'help-issues': HTMLElement;
  'help-open-folder': HTMLButtonElement;
  'close-help': HTMLButtonElement;
  'privacy-dialog': HTMLDialogElement;
  'privacy-title': HTMLElement;
  'privacy-path': HTMLElement;
  'close-privacy': HTMLButtonElement;
}
