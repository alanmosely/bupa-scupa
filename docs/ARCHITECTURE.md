# Architecture

SCUPA is a small JavaScript application with one shared claims engine. It has no
server, database service, AI integration or runtime package installation.

| Location                                           | Responsibility                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/core/model.js`, `src/version.js`              | Canonical fields, statuses, portal origin, documented data types and version     |
| `src/core/portal.js`, `safety.js`                  | Headed browser, navigation, identity checks, retries and immutable PDF revisions |
| `src/core/parse.js`                                | PDF text extraction and statement interpretation                                 |
| `src/core/merge.js`, `csv.js`, `util.js`           | Validation, canonical CSV, backups, reports and atomic writes                    |
| `src/core/service.js`                              | Household operations, archive snapshots, locks, recovery and exports             |
| `src/agent.js`, `agent-schema.js`                  | Versioned commands, output reservation, JSON responses and progress schemas      |
| `src/desktop/main.cjs`, `preload.cjs`, `worker.js` | Electron lifecycle, validated IPC and cancellable operations                     |
| `src/ui/`                                          | Local HTML/CSS interface; DOM and preload types in `dom.d.ts`                    |
| `scripts/`, `test/`                                | Reproducible packaging, privacy checks and synthetic regression tests            |

## Data flow and boundaries

Sync authenticates in a fresh manual browser session, verifies member ownership,
archives PDFs, parses them, validates the complete batch, then merges. A failure
before merging preserves the master; downloaded PDFs remain available to retry.
PDFs and changed revisions are permanent. Backups precede master replacement.

`browser.js` launches installed Microsoft Edge through Playwright's `msedge`
channel, then tries `chrome` if Edge cannot start. Browser executables are not
bundled or downloaded. Each launch uses a temporary profile and a new context;
personal browser sessions are never attached. Electron remains the local UI.

After every attachment for a claim downloads successfully, `current.json` records
that claim's current PDF filenames atomically. Parsing excludes historical files
from that claim, so a restored original can supersede a later archived revision.
Legacy folders without this metadata retain date/mtime selection until fetched
again. Full refresh revisits every portal claim, bypassing only the incremental
date filter; manual login and member verification stay the same.

Parsing returns records with structured errors and human-readable warnings.
Unparsed benefit rows, missing or multiple payment totals, and uncertain currency
block the batch. The service merges these records directly; `parsed.json` is a
diagnostic snapshot, not a second input. Reparse updates available statement
metadata while preserving identity, audit notes and values missing from the new
statement. Payment dates follow the selected assessment, including a restored
older assessment, so dates and amounts remain consistent.

`discovery.js` reads labelled profile fields and scoped member links on the first
sync. Unknown or ambiguous metadata stops discovery. The human confirms the
complete household before settings are saved, then confirms each profile before
its first import. Existing archives keep their configured member IDs and names;
discovery does not silently add, remove or reassign existing members. A manual
setup fallback handles unsupported portal layouts.

Core archive paths are resolved at module import. Each desktop operation runs in
a new worker with its selected archive in the environment; each CLI invocation
uses one archive. Do not reuse a loaded core module to switch archives in-process.
The renderer cannot choose arbitrary executable paths or access Node APIs.

Keep electron-builder's `portable.unpackDirName` set to `true`. In the pinned
builder, `false` creates one directory name per build, shared by launches; NSIS
removes that directory on startup and exit. `true` uses NSIS's unique per-process
plugin directory. Overlapping GUI and agent launches must not remove one
another's runtime. Archive locks still protect concurrent writers.

Member IDs are permanent. Name corrections update display names and back up the
household settings; existing references must still pass ownership checks, and
the human must reconfirm the corrected member. This is not a member transfer API.

Writers acquire an exclusive `.scupa-lock`. Recovery acquires `.scupa-recovery`;
writers check that guard before and after lock acquisition. Recovery removes a
lock only if its PID is confirmed absent. Permission errors, malformed locks and
PID reuse fail closed. An interrupted recovery guard requires manual inspection.

Agent output/event files are reserved before mutation and must be outside the
archive. Responses may contain health data; progress events contain control state
only. A member-scoped claims query also scopes the returned member dictionary.
Agents cannot supply passwords or bypass human member confirmation.

## Making changes

Keep business rules in the core and use the service boundary from both entry
points. Change schemas and contract tests together. Add a synthetic regression
for ownership, amount parsing or file-write changes; never copy a real statement.
Run `npm test` and `npm run check`. Browser changes also need `npm run test:portal`;
UI changes need `npm run test:desktop`. Packaging changes need packaged and full
portable smoke tests plus `npm run release:check`.

JavaScript is checked with TypeScript `checkJs`, including null checks. JSDoc
records meaningful boundaries; this is incremental typing, not a fully strict
TypeScript conversion. ESLint catches common mistakes and Prettier maintains a
consistent format. Prefer readable functions over clever general frameworks.
