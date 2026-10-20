# BUPA SCUPA 0.3.0-rc.1

This prerelease improves long household imports and makes saved claims available
without confirming every routine statement. Replacing the app preserves your
existing archive; back up the entire archive folder before updating.

- Recognised Bupa statements and reassessments import automatically after amount
  and currency validation. Only unfamiliar, unreadable or ambiguous documents
  need attention. Other claims still import; existing payment values stay intact
  for deferred claims and new deferred claims have blank amounts.
- Needs attention includes deferred statement imports, and Archive help shows
  the exceptional documents rather than a confirmation button for every statement.
- Retrying an interrupted sync within 24 hours reuses validated PDFs saved after
  the last successful sync. Member ownership and fresh attachment lists are
  checked first; saved PDFs must still match their size and SHA-256. Full refresh
  downloads everything again. Existing recent complete claims can also resume.
- Dependant navigation retains the selected member ID even when desktop/mobile
  navigation contains earlier account-holder claims links. Cross-member reference
  checks remain required.
- Bulk requests are paced. Rate limits and server errors use cancellable backoff
  and respect Retry-After. A genuine expired login pauses for manual sign-in,
  restores the member and rechecks ownership before continuing.
- Incomplete or non-PDF responses retry through the logged-in browser with the
  same PDF checks and size limit. Private diagnostics retain typed metadata,
  never response bodies, authentication data or download URLs.
- The JSON API adds optional reviewRequired to successful parse/sync results.
  Corrupt archive metadata and conflicting ownership still block master updates.

## Downloads

These links become available when the prerelease is published:

- [Portable EXE](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.0-rc.1/bupa-scupa-x64.exe)
- [Application ZIP](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.0-rc.1/bupa-scupa-0.3.0-rc.1-x64.zip)
- [Corresponding source](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.0-rc.1/bupa-scupa-0.3.0-rc.1-source.zip)
- [SHA-256 checksums](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.0-rc.1/SHA256SUMS.txt)

Use this version-specific EXE link for the candidate. The permanent latest-EXE
link serves the latest stable release.

## Validation and remaining acceptance

The candidate is tested on Windows 11 x64, OS build 26300. Automated coverage includes
104 tests, desktop and synthetic portal workflows, packaged and portable agent
commands, cancellation, source privacy checks and release artifact inspection.
No dependency versions changed. The dependency audit reports no vulnerabilities.

A live household download completed, and an offline import made the saved
claims available with exceptions isolated. The complete current packaged version
has not yet passed a fresh live end-to-end sync, including a zero-claim profile
and live session/download recovery. Those cases have synthetic coverage. This
remaining acceptance is why this release is a prerelease.

Requires Windows 10/11 x64 and installed Edge or Chrome. The binaries are unsigned;
fresh-machine acceptance has not been performed. See docs/VALIDATION.md in the
corresponding source for the detailed evidence and limits. The stable latest-EXE
link continues to serve the latest stable release.

Archive files contain readable health records and must stay private. SCUPA is
independent of Bupa. Both binary downloads retain matching FFmpeg source, patches,
build materials and LGPL notices in resources/ffmpeg, plus Xpdf source and notices
in resources/xpdf. Preserve these materials when redistributing.
