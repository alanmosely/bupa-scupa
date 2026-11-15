# BUPA SCUPA 0.3.3

This patch fixes interrupted archive recovery and preserves change reports when
their destination cannot be written after claims have already been saved.

- **Recover interrupted run** can recover a recovery attempt that stopped
  unexpectedly, once its owner is confirmed to have stopped. Active operations
  remain protected. Agent writes also retry a verified stale recovery guard.
- A report write failure after the master CSV is saved now reports a successful
  import with a pending-report warning. The report is retained privately and
  retried at its original path, without duplicating claims or losing its changes.
- Agent responses expose `reportPending` alongside the successful result. Dry
  runs do not write or retry pending reports. Failures before the master commit
  preserve the previous CSV.

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

## Release assets

- `bupa-scupa-x64.exe`: portable application.
- `bupa-scupa-0.3.3-x64.zip`: extracted application, recommended for repeated agent use.
- `bupa-scupa-0.3.3-source.zip`: corresponding application source.
- `SHA256SUMS.txt`: SHA-256 checksums for the three downloads.

## Validation and limits

The archive fixes passed 131 automated tests, desktop and synthetic portal
checks, packaged and portable agent checks, and release-artifact validation on
the full Windows pipeline before this release preparation. Independent synthetic
fault tests also verified seven process-interruption and write-failure scenarios.
The versioned release artifacts require the same complete Windows validation;
the release's GitHub Actions run records the final result.

Dependencies, bundled runtime and PDF reader versions, source pins and notices
are unchanged. The Windows binaries are unsigned. A fresh Windows installation
and a new live end-to-end household sync were not tested. The app requires
Windows 10/11 x64 and installed Edge or Chrome. Keep your archive private.
