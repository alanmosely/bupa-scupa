# Validation

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
- The permanent EXE alias is generated automatically, included in the checksum
  manifest and verified to match the versioned EXE. Relevant pull requests run
  the full Windows validation workflow automatically.
- Source archive checks accept regenerated timestamps but reject changed contents
  and duplicate paths; the pins were derived from the verified upstream inputs.
- Public source and release contents are reviewed for private records, credentials,
  personal paths and image metadata. The dashboard screenshot uses fictional data.

Xpdf is compiled from pinned source with optional libraries disabled. Electron's
FFmpeg DLL matches the pinned upstream binary and includes its corresponding
source and build materials. Electron/FFmpeg has not been rebuilt locally, and
byte-for-byte reproducibility is not claimed. See [FFMPEG.md](FFMPEG.md).

## Acceptance

Full live household sync acceptance remains incomplete. Live login, discovery and
cancellation have been exercised, but synthetic tests do not establish complete
live compatibility. The live test remains stopped at the maintainer's request.

The Windows binaries are unsigned. Testing on a fresh Windows installation is
outside this release's scope. Hosted check and build results are available in
[GitHub Actions](https://github.com/alanmosely/bupa-scupa/actions).

Repeat the relevant checks after source, dependency or packaging changes. See the
[release procedure](RELEASE.md) for commands and artifact review requirements.
