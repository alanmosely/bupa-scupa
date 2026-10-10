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
  export: UiCommand<
    { query?: import('../core/claims.js').ClaimQuery } | undefined,
    ReturnType<typeof import('../core/service.js').exportCsv> | null
  >;
  'claim-details': UiCommand<
    { claimRef: string },
    ReturnType<typeof import('../core/service.js').claimDetails>
  >;
  'update-follow-up': UiCommand<
    { claimRef: string; followUp: import('../core/claims.js').FollowUp },
    Snapshot
  >;
  'save-view': UiCommand<{ name: string; query: import('../core/claims.js').ClaimQuery }, Snapshot>;
  'remove-view': UiCommand<{ id: string }, Snapshot>;
  'open-claim-document': UiCommand<{ claimRef: string; file: string; sha256: string }, undefined>;
  'open-folder': UiCommand<undefined, undefined>;
  'open-document': UiCommand<{ file: string; sha256: string }, undefined>;
  'review-document': UiCommand<
    { file: string; sha256: string; classification: 'assessment' | 'supporting' | null },
    undefined
  >;
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
  changes: HTMLDetailsElement;
  'changes-title': HTMLElement;
  'changes-list': HTMLElement;
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
  provider: HTMLSelectElement;
  'date-field': HTMLSelectElement;
  'date-from': HTMLInputElement;
  'date-to': HTMLInputElement;
  'sort-by': HTMLSelectElement;
  'sort-direction': HTMLButtonElement;
  'clear-filters': HTMLButtonElement;
  'more-filters': HTMLButtonElement;
  'advanced-filters': HTMLElement;
  'advanced-count': HTMLElement;
  'filter-summary': HTMLElement;
  'active-filters': HTMLElement;
  'view-menu': HTMLDetailsElement;
  'view-menu-title': HTMLElement;
  'all-tab': HTMLButtonElement;
  'attention-tab': HTMLButtonElement;
  'attention-count': HTMLElement;
  'view-description': HTMLElement;
  'filter-error': HTMLElement;
  'saved-view': HTMLSelectElement;
  'save-view': HTMLButtonElement;
  'remove-view': HTMLButtonElement;
  'save-view-dialog': HTMLDialogElement;
  'save-view-form': HTMLFormElement;
  'view-name': HTMLInputElement;
  'view-save-error': HTMLElement;
  'cancel-save-view': HTMLButtonElement;
  'confirm-save-view': HTMLButtonElement;
  'claim-dialog': HTMLDialogElement;
  'detail-provider': HTMLElement;
  'detail-reference': HTMLElement;
  'detail-member': HTMLElement;
  'detail-status': HTMLElement;
  'detail-claimed': HTMLElement;
  'detail-paid': HTMLElement;
  'detail-fields': HTMLElement;
  'detail-notes': HTMLElement;
  'detail-documents': HTMLElement;
  'detail-document-error': HTMLElement;
  'detail-attention': HTMLElement;
  'close-claim': HTMLButtonElement;
  'follow-up-form': HTMLFormElement;
  'follow-up-details': HTMLDetailsElement;
  'follow-up-summary': HTMLElement;
  'follow-up-notes': HTMLTextAreaElement;
  'chased-on': HTMLInputElement;
  'follow-up-on': HTMLInputElement;
  'follow-up-pinned': HTMLInputElement;
  'follow-up-reviewed': HTMLInputElement;
  'save-follow-up': HTMLButtonElement;
  'follow-up-message': HTMLElement;
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
