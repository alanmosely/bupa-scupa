# BUPA SCUPA 0.3.3

This patch fixes archive recovery, statement validation, portal retries and
archive file boundaries. It preserves change reports when their destination
cannot be written after claims have already been saved.

- **Recover interrupted run** can recover a recovery attempt that stopped
  unexpectedly, once its owner is confirmed to have stopped. Active operations
  remain protected. Agent writes also retry a verified stale recovery guard.
- A report write failure after the master CSV is saved now reports a successful
  import with a pending-report warning. The report is retained privately and
  retried at its original path, without duplicating claims or losing its changes.
- Agent responses expose `reportPending` alongside the successful result. Dry
  runs do not write or retry pending reports. Failures before the master commit
  preserve the previous CSV.
- Padded claim headings keep each claim's amounts separate. Invalid claim
  references, malformed benefit amounts and inconsistent currency-conversion
  summaries require review instead of importing partial totals.
- Missing assessed amounts and invalid stored statuses block archive updates.
  Linked archive folders, PDFs and CSV export paths cannot bypass archive file
  boundaries, including during downloads and zero-claim manifest updates.
- Member-page navigation retries HTTP 429 and temporary server errors, respects
  server cooldowns and remains cancellable. Login and MFA stay manual.
- Simultaneous portable launches now reserve separate extraction directories
  for their full lifetimes. This prevents one launch from overwriting or removing
  another launch's application files. The EXE remains portable and needs no
  installation or administrator permission.

## Upgrade and recovery

1. Back up the **entire archive folder**, including PDFs, master history, personal
   notes and any pending report. Close SCUPA and other agents using the archive.
2. Replace the portable EXE, or extract the complete application ZIP into a new
   application folder. Open the updated app with your existing archive.
3. If a run was interrupted, use **Archive help → Recover interrupted run**.
   Recovery refuses active owners. An old ownerless guard or unreadable lock
   still needs the [manual recovery procedure](https://github.com/alanmosely/bupa-scupa/blob/v0.3.3/docs/ARCHIVE.md#recover-an-interrupted-run).
4. If a report is pending, repair write access to the archive's `reports/` folder,
   then use **Archive options → Recheck saved PDFs**. Keep the pending report file
   with your backup until the retry succeeds. Rechecking works offline and
   preserves saved PDFs and personal follow-up notes.

No manual CSV or household-settings migration is needed. Finish pending report
recovery before returning to an older application version. Reports already lost
by a previous version cannot be recreated by this patch.

Use **Recheck saved PDFs** to apply the statement fixes offline. Files with
invalid amounts remain in **Archive help** for review. Linked archive folders or
PDFs are refused: keep the archive in a private, regular directory with regular
files, outside the development checkout. Existing PDFs and personal notes are
preserved; do not guess amounts or statuses to bypass a validation error.

## Release assets

- [bupa-scupa-x64.exe](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.3/bupa-scupa-x64.exe): portable application.
- [bupa-scupa-0.3.3-x64.zip](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.3/bupa-scupa-0.3.3-x64.zip): extracted application, recommended for repeated agent use.
- [bupa-scupa-0.3.3-source.zip](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.3/bupa-scupa-0.3.3-source.zip): corresponding application source.
- [SHA256SUMS.txt](https://github.com/alanmosely/bupa-scupa/releases/download/v0.3.3/SHA256SUMS.txt): SHA-256 checksums for the three downloads.

## Validation and limits

The [complete Windows release workflow](https://github.com/alanmosely/bupa-scupa/actions/runs/43751600679)
passed on Windows Server 2022 x64: all 143 tests with PDF extraction and FFmpeg
source checks required, zero skips, source checks, desktop and synthetic portal
tests, packaged/portable agents, 128 startup invocations, cancellation, concurrent
portable launches, and exact source/binary release checks. The merged commit has
the same source tree and its
[source checks](https://github.com/alanmosely/bupa-scupa/actions/runs/43753150145)
also passed.

An independent build passed on Windows 11 x64, build 26300, including all 143
tests, packaged desktop, startup, extracted/portable agents, cancellation, three
concurrent portable pairs with complete temporary-directory cleanup, and
release-content verification. Seven independent report-journal fault scenarios
and native launcher argument, error and concurrency tests also passed. A fresh
dependency audit reported zero vulnerabilities.

Dependencies, bundled runtime and PDF reader versions, source pins and notices
are unchanged. The Windows binaries are unsigned. A fresh Windows installation
and a new live end-to-end household sync were not tested. The app requires
Windows 10/11 x64 and installed Edge or Chrome. Keep your archive private.
