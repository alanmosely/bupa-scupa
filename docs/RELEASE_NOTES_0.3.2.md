# BUPA SCUPA 0.3.2

This patch catches older claims missing from your archive and makes statement
recovery and reassessment parsing more reliable.

- Normal sync checks every claim missing from the verified member's archive,
  even when its reference predates the regular 14-day overlap. Already assessed
  older claims still require **Refresh all claims** to check for reassessments.
- When Bupa says a statement will be available later, sync keeps the last known
  documents and payments. A new claim can appear as awaiting a statement without
  a guessed amount. Unfamiliar portal pages still stop the import.
- PDFs from an interrupted download stay out of the assessment until all of that
  claim's attachments have been checked. Existing files and revisions are kept.
  PDF downloads must have a valid header, trailer and cross-reference location.
- Rate limits during sign-in checks use cancellable retries. The app still
  requires manual login, MFA and first-import member confirmation.
- Multi-invoice reassessments use each invoice's validated final assessment and
  leave historical adjustment values out of the totals. Malformed totals and
  ambiguous invoice matches still require review. More benefit-limit reasons are
  retained in assessment notes.
- An image-only receipt reviewed as supporting evidence keeps that classification
  if Bupa renames a byte-identical copy within the same claim. Changed PDFs still
  need review.

## Updating an archive

Back up the entire archive before replacing the app. Use **Archive options →
Recheck saved PDFs** to apply the parser fixes offline and **Sync with Bupa** to
find claims missing from the archive. Rechecking preserves the saved PDFs and
personal follow-up notes.

## Downloads

- [Portable EXE](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.2/bupa-scupa-x64.exe)
- [Application ZIP](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.2/bupa-scupa-0.3.2-x64.zip)
- [Corresponding source](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.2/bupa-scupa-0.3.2-source.zip)
- [SHA-256 checksums](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.2/SHA256SUMS.txt)

Open the portable EXE, or extract the ZIP and run `BUPA SCUPA.exe`. The extracted
ZIP is recommended for repeated agent use.

## Validation and limits

Tested on Windows 11 x64, build 26300. All 127 automated tests, desktop and
synthetic portal checks, packaged and portable agent checks, and release artifact
validation passed. The dependency audit reported zero vulnerabilities.

The runtime and PDF reader versions, upstream source pins and notices are unchanged.
Build and lint dependencies address the [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
and [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) advisories.
The Windows binaries are unsigned. A fresh Windows installation and a new live
end-to-end household sync were not tested. The app requires Windows 10/11 x64
and installed Edge or Chrome. Keep your archive private.
