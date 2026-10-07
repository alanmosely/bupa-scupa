# BUPA SCUPA 0.1.0

A Windows app for keeping your household's Bupa Global MembersWorld claims and
statements in a local archive.

- Download statements using manual Bupa login and MFA.
- Search claims, filter by member or status, and export CSV.
- Keep original PDFs and revisions, with backups before master updates.
- Query claims and payment totals through the local JSON API.

## Downloads

- [Portable EXE](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.0/bupa-scupa-0.1.0-x64.exe) — open to run.
- [ZIP](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.0/bupa-scupa-0.1.0-x64.zip) — extract for repeated use, including agent commands.
- [Source](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.0/bupa-scupa-0.1.0-source.zip)
- [SHA-256 checksums](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.0/SHA256SUMS.txt)

Requires Windows 10/11 x64 and installed Edge or Chrome. The binaries include
Electron and the PDF reader; Node.js is not required.

## Validation and privacy

This is an unsigned prerelease. Local automated and packaged-app checks pass;
full live household sync acceptance is incomplete. Fresh-machine testing has not
been performed. See [validation](https://github.com/alanmosely/bupa-scupa/blob/v0.1.0/docs/VALIDATION.md)
and [hosted checks](https://github.com/alanmosely/bupa-scupa/actions).

Archive files contain readable health records. Store and back them up privately.
SCUPA has no built-in analytics or AI uploads. It is independent of Bupa.

The app uses FFmpeg under LGPL-2.1-or-later through Electron. Both binary downloads
include matching source, patches, build instructions and licence in
`resources/ffmpeg`. Xpdf source and notices are in `resources/xpdf`. Preserve these
materials when redistributing.
