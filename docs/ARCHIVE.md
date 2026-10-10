# Archive, backups and recovery

SCUPA keeps its archive separately from the application. The default is
`Documents/BUPA SCUPA`; choose another private folder before your first sync if
needed. Replacing the executable does not move or remove the archive.

## Files

| Path                 | Contents                                           |
| -------------------- | -------------------------------------------------- |
| `household.json`     | Private member names and settings                  |
| `raw/`               | Permanent PDF archive, including changed revisions |
| `master/claims.csv`  | Canonical claim records                            |
| `master/backups/`    | Previous master versions                           |
| `parsed.json`        | Parsing results and diagnostics                    |
| `reports/`           | Changes from each merge                            |
| `household-backups/` | Previous settings after name corrections           |

Back up the **entire archive folder**. These files contain personal records and
must stay out of public repositories and issue reports. SCUPA does not encrypt
them; use your operating system's account controls, disk encryption and backups.
See [privacy](../PRIVACY.md).

Each successfully downloaded claim has a `current.json` file beside its PDFs.
It identifies the complete set returned by the portal, including a restored older
revision. Parsing uses those files; previous PDFs remain as history. A failed or
cancelled claim download leaves its previous selection intact.

Archives created before this metadata existed use payment dates and file times
until refreshed. Use **Archive options → Refresh all claims** to record the
current files for every claim still available in Bupa's 36-month window. This
also catches reassessments outside the normal 14-day incremental overlap.
**Recheck saved PDFs** works offline and does not fetch portal changes.

After a successful sync or recheck, expand **View changes** to see added claims
and the previous and new values for updated claims. Claimed and paid amounts use
their own currencies. The summary covers the latest run in this window and clears
when another run starts or you change archives. Change reports are also saved in
`reports/`.

In the master CSV, `currency` describes `claimed` and `paid_currency` describes
`paid`. Earlier preview CSVs with one currency remain readable. Their header is
upgraded on the next successful merge, with the original CSV backed up first;
queries and dry runs do not rewrite it. Older previews cannot read the new header.

## Household names

Use **Archive options → Edit household names** to correct spelling while keeping
the same people and claim ownership. Corrections require confirmation at the
next sync. Use a separate archive for a different household; do not rename one
person as another.

## Parsing errors

Open **Archive help** to see affected files. Keep these diagnostics private.
Parsing errors block the merge, leaving the master unchanged. If Bupa changes
its statement format, retain the PDFs and try a newer SCUPA release.

Some provider receipts arrive with Bupa's statement tag but contain only images.
For these, **Archive help → View PDF** opens the original in your PDF viewer.
Read every page. If it is an invoice or receipt, choose **Mark as supporting
document** and confirm, then close Archive help and **Recheck saved PDFs**.
Do not use this for Bupa statements; image-only assessments still require review
outside SCUPA and cannot supply payment amounts to the parser.

The decision is saved beside the PDF in `document-reviews.json`, tied to that
claim, filename and SHA-256 content hash. The PDF is never renamed or changed.
A different revision requires a fresh review. **Undo supporting classification**
removes the decision; the next parse will stop on the unreadable PDF again.
These decisions are included when you back up the entire archive. Text extraction
failures and malformed text statements cannot be bypassed with this action.

## Restore a master backup

1. Close SCUPA. Do not edit the master while a sync is running.
2. Copy the current `master/claims.csv` to a safe location.
3. Copy a chosen file from `master/backups/` to `master/claims.csv`.

Original PDFs are never automatically deleted.

## Recover an interrupted run

Close other SCUPA windows, then open **Archive help → Recover interrupted run**.
Recovery is offered only when the lock owner is confirmed to have stopped.
Normal errors and cancellation release locks automatically.

An unreadable lock or interrupted recovery guard cannot be removed automatically.
Close all SCUPA and associated browser processes, restarting Windows if uncertain.
Then remove only `.scupa-lock` and `.scupa-recovery` from the archive and retry.
Do not remove the PDFs or master.
