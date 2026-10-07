# Security

Report vulnerabilities privately using [GitHub private vulnerability reporting](https://github.com/alanmosely/bupa-scupa/security/advisories/new).
This reporting channel is enabled. Do not post exploit details, health records,
credentials or portal captures in public issues. Repository maintainers receive
private reports.

This preview has not had an independent security audit. It handles sensitive
health documents. Keep the OS and SCUPA updated and use a private archive folder.

The renderer is sandboxed, has no Node integration, uses context isolation and a
restrictive CSP, denies permissions and network requests, and blocks navigation
and new windows. IPC callers are checked against the main frame of the local UI.
Only approved operations and validated arguments reach the shared core.

Downloaded PDF headers and end markers are checked; revisions are preserved.
These checks do not prove a PDF is harmless. Parsing executes the bundled reader
in a child process with a time limit. Do not open unknown documents casually.

Known member reference overlap is required and cross-member reference matches
are rejected. Fresh or claim-free members need a human identity check. A failed
download or parsing error blocks master updates. Writes use atomic replacement,
exclusive operation locks and pre-change master backups.

Dependencies are pinned. Before release run production and development dependency
audits, review upstream advisories, test bundled components and document the
Windows release's signature status. Checksums detect changes; they do not authenticate an unsigned
release publisher by themselves.
