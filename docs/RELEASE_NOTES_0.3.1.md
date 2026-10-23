# BUPA SCUPA 0.3.1

This stable update fixes four issues found in the code review and includes the
latest invoice and supporting-document parsing corrections. Back up your entire
archive folder before replacing the application.

- A duplicate-declined item no longer zeroes payments for the rest of its claim.
  The validated payment total remains authoritative.
- Session expiry during member switching, claims-list verification or member
  confirmation now offers the same manual sign-in recovery as downloads. The
  selected member is restored and claim ownership checked before retrying.
- Claim details can open a related multi-claim statement saved under another
  claim for the same member. Current-file, SHA-256 and PDF-reference checks reject
  stale, changed or unrelated documents.
- Changed rejection and assessment reasons count as updates even when payment
  amounts and status stay the same. Audit history is retained, old review marks
  are invalidated and unchanged reparses do not create repeat entries.
- Labelled tax/discount tables use the final invoice amount and retain the
  original figure in notes. Compatible assessments containing several invoices
  retain every invoice number and combine validated payments. Conflicting totals,
  identities, currencies or recipients still require review.
- More readable receipts and booking/order confirmations are recognised as
  supporting evidence. Scans still require content-specific review.

After updating, use **Recheck saved PDFs** to repair affected saved amounts,
refresh assessment reasons and build related-statement links. This works offline.
Normal sync keeps login, MFA and first-import member confirmation manual.

## Downloads

Download this version:

- [Portable EXE](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.1/bupa-scupa-x64.exe)
- [Application ZIP](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.1/bupa-scupa-0.3.1-x64.zip)
- [Corresponding source](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.1/bupa-scupa-0.3.1-source.zip)
- [SHA-256 checksums](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.1/SHA256SUMS.txt)

The permanent latest-EXE link serves this version once published as latest.

## Validation and limits

Tested on Windows 11 x64, OS build 26300. Coverage includes 119 automated tests,
desktop and synthetic portal/discovery workflows, packaged and portable agent
commands, cancellation, source privacy and exact release artifact checks.
Electron is updated to 44.9.3 for
[GHSA-jr5w-w6x2-84p9](https://github.com/advisories/GHSA-jr5w-w6x2-84p9),
with matching FFmpeg source and binary provenance. The dependency audit is clear.

The binaries are unsigned. Fresh-machine testing and a fresh live end-to-end
sync of this packaged version have not been performed. Session recovery,
zero-claim members and failed downloads have synthetic coverage; no live Bupa
sync was run for these fixes. Stable publication is authorised with these limits
disclosed. See docs/VALIDATION.md in the corresponding source.

Requires Windows 10/11 x64 and installed Edge or Chrome. Archive files contain
readable health records and must stay private. SCUPA is independent of Bupa.
Both binary downloads retain matching FFmpeg source, build materials and LGPL
notices in resources/ffmpeg, plus Xpdf source and notices in resources/xpdf.
Preserve these materials when redistributing.
