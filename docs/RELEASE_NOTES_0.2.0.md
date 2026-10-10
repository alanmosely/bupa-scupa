# BUPA SCUPA 0.2.0

Open a claim to see its dates, invoice number, payment recipient, benefit category
and current statement or supporting PDFs. Personal follow-ups and saved views
help you keep track of claims between syncs.

- **Your follow-up** stores notes, a last-chased date, a next follow-up date and
  a personal pin in this archive.
- **Needs attention** gathers claims awaiting statements, rejected or partially
  paid assessments, and claims you pin or schedule. Reviewing an assessment does
  not change Bupa's status; a later reassessment requires a new review.
- **More filters** adds provider and received, treatment or payment dates.
  Sort with column headings and save the current settings through **Views**.
- **Export shown claims** exports the current results in the displayed order.
- The default screen keeps advanced filters and follow-up fields collapsed.
  Keyboard focus returns to the claim when you close its details.
- Invoice numbers are retained in the master CSV and local JSON API. Existing
  CSVs remain readable; the next successful merge backs up and migrates the header.
- Personal follow-ups and saved views are stored in private `workspace.json`.
  Back up the entire archive to preserve them.

## Downloads

- [Portable EXE](https://github.com/alanmosely/bupa-scupa/releases/download/v0.2.0/bupa-scupa-x64.exe)
- [Application ZIP](https://github.com/alanmosely/bupa-scupa/releases/download/v0.2.0/bupa-scupa-0.2.0-x64.zip)
- [Corresponding source](https://github.com/alanmosely/bupa-scupa/releases/download/v0.2.0/bupa-scupa-0.2.0-source.zip)
- [SHA-256 checksums](https://github.com/alanmosely/bupa-scupa/releases/download/v0.2.0/SHA256SUMS.txt)

Open the portable EXE, or extract the ZIP and run `BUPA SCUPA.exe`. The permanent
[latest EXE link](https://github.com/alanmosely/bupa-scupa/releases/latest/download/bupa-scupa-x64.exe)
provides this version once the release is published. Use the extracted ZIP for
repeated agent commands.

## Validation and privacy

Validation uses fictional claims and PDFs on Windows 11 x64 and the Windows
Server 2022 hosted runner. Automated coverage includes 86 core, agent, privacy
and source-integrity tests, desktop and synthetic portal workflows, packaged
and portable agent commands, cancellation and concurrent portable runs.
Release checks inspect corresponding source, binary contents, third-party
notices, source provenance and SHA-256 checksums.

Requires Windows 10/11 x64 and installed Edge or Chrome. The binaries are
unsigned. Full live household sync acceptance remains incomplete; the live
test remains stopped at the maintainer's request. Fresh-machine acceptance
has not been performed. See [validation](https://github.com/alanmosely/bupa-scupa/blob/v0.2.0/docs/VALIDATION.md).

Archive files contain readable health records. Replacing the application
preserves your archive. SCUPA is independent of Bupa.

Both binary downloads retain matching FFmpeg source, patches, build materials
and LGPL notices in `resources/ffmpeg`, plus Xpdf source and notices in
`resources/xpdf`. Preserve these materials when redistributing.
