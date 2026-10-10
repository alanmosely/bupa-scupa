# Release checklist

The first public release is **0.1.0**, tagged **v0.1.0**. Publish only after the
maintainer authorises it and the applicable checks below are complete. A prerelease
must state any unfinished acceptance checks in its release notes. Current evidence and
outstanding acceptance checks are recorded in [VALIDATION.md](VALIDATION.md).

## Verify the candidate

1. Review exact dependency pins and `npm audit`. Provision the bundled tools with
   `npm run vendor`, then run the following on Windows x64. Release builds require
   the C++ tools described in [CONTRIBUTING.md](../CONTRIBUTING.md); the build
   compiles Xpdf from verified source and records its provenance.

   ```powershell
   $env:SCUPA_REQUIRE_PDF_TESTS = '1'
   $env:SCUPA_REQUIRE_FFMPEG_SOURCE = '1'
   npm test
   npm run check
   npm run test:desktop
   npm run test:portal
   npm run build
   node scripts/smoke.js --packaged --browser --cancel-parse
   node scripts/agent-smoke.js
   node scripts/agent-smoke.js --portable
   node scripts/agent-cancel-smoke.js
   node scripts/portable-overlap.js
   ```

2. Complete a manual-login sync in the packaged app using a fresh private archive.
   Confirm the household and every member, include a zero-claim profile, and
   compare downloaded statements with displayed amounts. Check cancellation,
   expired sessions and failed downloads. Keep real records and captures private.
3. Review the component evidence in [THIRD_PARTY.md](THIRD_PARTY.md) after any
   dependency change. Retain the matching FFmpeg source, patches, build materials
   and LGPL text under `resources/ffmpeg`, plus Xpdf's source and notices. Do not
   remove these directories to reduce download size.
4. Run `npm run release:source` and `npm run release:check` against the final
   artifacts. Inspect the exact staged files, source ZIP and binary contents.
   Include only reviewed source, tests, docs, assets, dependency locks and build
   configuration. Exclude archives, household settings, portal captures, the
   parent private project, caches and generated binaries from Git history.

The maintainer has excluded signing and fresh-machine testing from 0.1.0's
release gates. Describe this release as unsigned and report the Windows version
actually tested. The [signing](SIGNING.md) and [clean Windows](CLEAN_WINDOWS.md)
procedures are optional future work.

## Publish

Tag the reviewed commit in [bupa-scupa](https://github.com/alanmosely/bupa-scupa).
Attach these assets to the release:

- `bupa-scupa-0.1.0-x64.exe`: portable app for double-click use.
- `bupa-scupa-0.1.0-x64.zip`: extracted app for repeated agent use.
- `bupa-scupa-0.1.0-source.zip`: corresponding application source.
- `bupa-scupa-x64.exe`: identical portable EXE for the permanent download link.
- `SHA256SUMS.txt`: checksums of the final release files.

`npm run release:source` generates `bupa-scupa-x64.exe` from the versioned EXE
and includes both in `SHA256SUMS.txt`. `npm run release:check` verifies their
contents match. Upload all four archives/binaries and the checksum manifest;
keep both EXEs so existing version-specific links continue to work. The README's
permanent direct download uses `/releases/latest/download/bupa-scupa-x64.exe`;
verify it after marking a stable release as latest.

Use [RELEASE_NOTES_0.1.0.md](RELEASE_NOTES_0.1.0.md) for the release notes. Record
actual tested platforms, limitations and signature status. Add and verify direct
download links in the README and release notes after uploading; do not present
anticipated downloads as available.

Verify private vulnerability reporting, dependency alerts and branch protection
with the required CI checks. The supplied workflows have read-only repository
permissions and do not publish releases automatically.
