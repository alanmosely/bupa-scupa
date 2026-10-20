# Validation

## Automatic statements and partial imports — 20 October 2026

Recognised Bupa statements now import without routine confirmation. Unfamiliar
documents, unreadable files and invalid payment totals defer only affected claims;
safe claims still import. New deferred claims have blank amounts. Existing
payments remain unchanged and affected claims stay in Needs attention, including
when an older assessment has been marked reviewed. Ownership conflicts and corrupt
archive metadata still block the entire merge. Manual decisions remain available
for exceptional unfamiliar documents and image-only supporting receipts.

All 104 automated tests pass, including partial-import JSON contracts,
multi-claim document deferral, ownership conflicts and preserved payment values.
Desktop checks verify an automatic first import, no routine confirmation buttons,
the partial-import message, visible existing claims, attention filtering and
exceptional document review. Screenshots use synthetic records. The packaged
desktop and agent checks also pass, including cancellation during parsing.
An offline import of an existing private archive made its claims visible,
retaining awaiting statements and isolating documents needing attention. No new
portal login was required. A fresh live portal sync was not repeated for this change.

## Local interrupted-download resume — 19 October 2026

Each validated, archived PDF now creates an atomic download checkpoint. Retrying
sync rechecks member ownership and attachment lists, then verifies source
identity, local PDF validity, size and SHA-256 before reuse. The checkpoint also
covers documents completed within an otherwise incomplete claim. Resume expires
after 24 hours, stops after a successful sync, and is bypassed by full refresh.
Recent complete claims from older versions require an exact current filename-set
match before adoption; loose or partial files are not adopted.

Unit checks cover interrupted documents, source changes, changed or missing PDF
bytes, successful-sync invalidation, expiry, full refresh and legacy revision
selection. All 100 automated tests and desktop smoke checks pass. The synthetic
browser test interrupts an import after a completed member, then verifies that
retry checks both fresh attachment lists, downloads only the missing PDF and
leaves the master unchanged. This verifies synthetic recovery; the live download
below preceded the resume change.

## Local PDF response recovery — 19 October 2026

A live read-only check of the claim at the latest stopped download returned its
PDFs successfully. Each matched the previously archived PDF byte for byte.
That check did not reproduce the rejected response from the longer sync.

Invalid download bodies now trigger a browser-fetch fallback with unchanged PDF
checks and a 64 MB size limit. Private diagnostics retain typed response metadata
without response text, tokens, cookies or URLs. New unit coverage includes HTML
responses mislabeled as PDFs, truncated PDFs, failed fallbacks, login bodies with
incorrect content types, redirects and oversized responses. All 97 automated
tests pass. A subsequent live download completed the entire household
without an invalid PDF response. Parsing then stopped with the master unchanged:
assessment confirmations, unrecognised statement formats and ambiguous payment
totals still require review. This verifies the download phase, not a completed
import or reproduction of the previous intermittent response.

## Local long-import recovery fix — 19 October 2026

Claim-details HTTP failures previously all appeared as an expired session.
Requests now have a pacing gap; HTTP 429 and server failures use cancellable
backoff and respect server cooldowns. Actual login expiry prompts manual sign-in
in the same browser, then restores and verifies the member before resuming.

Synthetic coverage includes HTTP error classification, retry cooldowns,
cancellation, a rate limit on the 100th claim-details request, and refusal to
resume under the wrong member after sign-in. This does not establish which HTTP
response caused the reported live failure; the previous error omitted it.
All 92 automated tests, source checks, desktop checks and both synthetic portal
workflows pass. No live sync was performed for this fix.

## Local profile navigation fix — 19 October 2026

The synthetic portal reproduced a cross-member refusal when global claims links
preceded the dependant's own link. Navigation now requires the member ID from
the selected card, and refuses missing, conflicting or mismatched IDs.

- 87 tests pass with PDF extraction and FFmpeg source coverage required.
- Source hygiene, lint, type checking and formatting pass.
- Desktop and synthetic portal/discovery checks pass, including duplicate global
  claims links, first-import retries, zero-claim members and refused navigation.
- Cross-member claim reference verification remains required. No live sync was
  performed for this fix; synthetic tests do not establish full live compatibility.

## Version 0.2.0

The claim details, Needs attention and browsing improvements were checked on
Windows with entirely synthetic archives and documents. No live sync was run for
these changes.

- 86 tests pass with PDF extraction and FFmpeg source coverage required, including
  follow-up persistence, reassessment review invalidation, query/export parity,
  current-document ownership and hash checks, CSV invoice migration and malformed
  workspace preservation, stale assessment-review rejection and stable missing-amount sorting.
- Source privacy checks, lint, type checking and formatting pass.
- Desktop checks cover the compact default screen, expandable filters and follow-ups,
  active filter summaries, the saved-view menu, PDF opening and persistence across restarts,
  review markers, provider/date filters, saved filters for missing providers, column sorting, filtered CSV export,
  invalid date ranges and an 860px window. Rendered screenshots were reviewed.
- Keyboard focus returns to the claim after its drawer closes. The public dashboard
  screenshot uses fictional records, a generic archive path and no text metadata.
- The existing desktop smoke and synthetic portal/discovery workflows remain
  covered. The release candidate passes full Windows validation: packaged
  desktop and browser checks, extracted and portable agent checks, cancellation,
  concurrent portable invocations and exact release artifact inspection.

## Version 0.1.1

Local checks were run on Windows 11 x64 with Node.js 24. Tests and screenshots use
synthetic people, claims and PDFs. Synthetic portal tests intercept requests.

- 73 core, agent, privacy and source-integrity tests pass, with PDF extraction and
  FFmpeg source coverage required.
- Source and staged-file privacy checks, lint, type checking and formatting pass.
- Desktop checks cover setup, parsing, document review and undo, separate claim
  and payment currencies, filters, renderer isolation and cancellation.
- Change summaries cover added claims, reassessed amounts and statuses, literal
  member names, and clearing results after unchanged or failed runs.
- A delayed-startup regression checks that Sync stays disabled until the initial
  archive load finishes, preventing overlapping agent operations.
- Synthetic portal tests cover member confirmation, zero-claim profiles,
  reassessments, failed downloads and cancellation without changing the master.
- Packaged and portable agent checks cover JSON schemas, output preflight,
  parsing, idempotence and structured errors with a system-only PATH.
- Concurrent portable invocations use isolated runtime folders.
- Release checks verify source ZIP completeness, packaged application source,
  notices, FFmpeg source/DLL provenance, Xpdf hashes, ZIP parity and checksums.
- The builder produces one portable EXE with the permanent download filename.
  The checksum manifest covers the EXE, app ZIP and source ZIP; CI uploads only
  those three downloads and the manifest. Relevant pull requests run the full
  Windows validation workflow automatically.
- Source archive checks accept regenerated timestamps but reject changed contents
  and duplicate paths; the pins were derived from the verified upstream inputs.
- Public source and release contents are reviewed for private records, credentials,
  personal paths and image metadata. The dashboard screenshot uses fictional data.

Xpdf is compiled from pinned source with optional libraries disabled. Electron's
FFmpeg DLL matches the pinned upstream binary and includes its corresponding
source and build materials. Electron/FFmpeg has not been rebuilt locally, and
byte-for-byte reproducibility is not claimed. See [FFMPEG.md](FFMPEG.md).

## Acceptance

Full live household sync acceptance remains incomplete. A live household
download completed on 19 October 2026; parsing stopped before merge
pending document review and parsing issues. The subsequent offline import on
20 October made the saved claims visible with exceptions isolated. A fresh live
end-to-end sync of the current packaged version, including zero-claim profiles
and live session/download recovery, remains outstanding. Live login, discovery
and cancellation have also been exercised; synthetic tests cover the remaining
paths without establishing complete live compatibility. Version 0.3.0-rc.1 is
therefore published as a prerelease.

The Windows binaries are unsigned. Testing on a fresh Windows installation is
outside this release's scope. Hosted check and build results are available in
[GitHub Actions](https://github.com/alanmosely/bupa-scupa/actions).

Repeat the relevant checks after source, dependency or packaging changes. See the
[release procedure](RELEASE.md) for commands and artifact review requirements.
