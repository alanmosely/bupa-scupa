# BUPA SCUPA 0.1.1

Sync and saved-PDF rechecks now show an expandable summary of added claims and
the previous and new values for updated claims. Claimed and paid amounts retain
their own currencies.

- The permanent EXE download is generated and checked with every release.
- Application and packaging PRs automatically run full Windows validation.
- The app displays its release version without the old preview label.
- ASAR release tooling and the Node setup action are updated.

## Downloads

- [Portable EXE](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.1/bupa-scupa-0.1.1-x64.exe)
- [ZIP](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.1/bupa-scupa-0.1.1-x64.zip)
- [Source](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.1/bupa-scupa-0.1.1-source.zip)
- [SHA-256 checksums](https://github.com/alanmosely/bupa-scupa/releases/download/v0.1.1/SHA256SUMS.txt)

The permanent [latest EXE link](https://github.com/alanmosely/bupa-scupa/releases/latest/download/bupa-scupa-x64.exe)
also downloads this version. Requires Windows 10/11 x64 and installed Edge or
Chrome. Extract the ZIP for repeated use, including agent commands.

## Validation and privacy

Automated checks cover the core, desktop, synthetic portal, packaged and portable
agent commands, release contents and checksums. Validation runs on Windows 11 x64
and the Windows Server 2022 hosted runner. The binaries are unsigned; full live
household sync acceptance remains incomplete and fresh-machine acceptance has not
been performed. See [validation](https://github.com/alanmosely/bupa-scupa/blob/v0.1.1/docs/VALIDATION.md).

Archive files contain readable health records. Back up the entire archive privately.
Replacing the application preserves the archive. SCUPA is independent of Bupa.

Both binary downloads include matching FFmpeg source, patches, build materials
and LGPL notices in `resources/ffmpeg`, plus Xpdf source and notices in
`resources/xpdf`. Preserve these materials when redistributing.
