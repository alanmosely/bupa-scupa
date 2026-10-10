# Archive, backups and recovery

SCUPA keeps its archive separately from the application. The default is
`Documents/BUPA SCUPA`; choose another private folder before your first sync if
needed. Replacing the executable does not move or remove the archive.

## Files

| Path                 | Contents                                              |
| -------------------- | ----------------------------------------------------- |
| `household.json`     | Private member names and settings                     |
| `workspace.json`     | Personal follow-up notes, dates, pins and saved views |
| `raw/`               | Permanent PDF archive, including changed revisions    |
| `master/claims.csv`  | Canonical claim records                               |
| `master/backups/`    | Previous master versions                              |
| `parsed.json`        | Parsing results and diagnostics                       |
| `reports/`           | Changes from each merge                               |
| `household-backups/` | Previous settings after name corrections              |

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
`paid`; `invoice` holds the provider invoice number. Earlier CSVs without invoice
numbers or with one currency remain readable. Their header is
upgraded on the next successful merge, with the original CSV backed up first;
queries and dry runs do not rewrite it. Older previews cannot read the new header.
Invoice numbers missing from an older CSV are populated when its saved assessments
are successfully rechecked or synced.

## Browsing and following up

Select a claim row or its reference to open claim details. This shows assessment
dates, invoice number, payment recipient, benefit category and archive notes. The
document buttons open the current statements and supporting PDFs in your usual
PDF viewer. These buttons do not confirm an assessment or change classifications;
document reviews still take place in Archive help. Historical revisions remain in
the archive.

**Needs attention** shows awaiting statements with their age, rejected and partially
paid assessments to review, and personal pins or follow-up dates. A payment
difference alone does not establish a balance owed: check the statement and invoice.
Expand **Your follow-up** in claim details to add notes, a last-chased date and a
next follow-up date, then choose
**Save follow-up**. Scheduled follow-ups appear immediately and show whether due.
The collapsed section shows a brief summary of your saved follow-up.
No notification is sent; open the queue to check them.

**Reviewed — no further action on this assessment** clears its automatic attention
reason. Pins and scheduled follow-ups still keep it in the queue; clear those fields
when finished. Changed assessment values or audit notes invalidate the review, so
the updated assessment can return to the queue. Reopen claim details before reviewing
an assessment that changed while its drawer was open. Personal notes never change Bupa's
status, payment amounts, archive audit notes or exported assessment CSV.

Search, member and status are always visible. Open **More filters** for provider
and a date range. Choose which date the range uses; records without that date are
excluded when a range is set. Sort
with the column headings or the sort controls. Amounts sort within each currency.
**Export shown claims** uses exactly the current filters and sort order, including
filters hidden when More filters is collapsed. Their summary remains visible above
the results. In **Views**, **Save current view** stores the current view, filters,
dates and sorting in this archive. Select it from Saved views to reuse it, or choose
**Remove selected view** to delete that saved filter.
Filters for a provider or member no longer present remain selected and return no
matches, rather than silently broadening the results. Clear them to show all claims.
Follow-up records and views persist across app restarts and are included when you
back up the entire archive.

## Household names

Use **Archive options → Edit household names** to correct spelling while keeping
the same people and claim ownership. Corrections require confirmation at the
next sync. Use a separate archive for a different household; do not rename one
person as another.

## Parsing errors

Open **Archive help** to see affected files. Keep these diagnostics private.
Parsing errors block the merge, leaving the master unchanged. If Bupa changes
its statement format, retain the PDFs and try a newer SCUPA release.

Before a new assessment can supply payment amounts, open **Archive help → View
PDF**, read every page, and choose **Confirm Bupa assessment** only if Bupa issued
it and the claims and totals are correct. Portal labels and statement-shaped text
do not prove who issued a document. Then **Recheck saved PDFs**. Confirmed,
unchanged PDFs are reused automatically; a new filename or changed contents needs
a new confirmation. Previously saved PDFs need this confirmation once too. Pending
reviews leave existing master records unchanged.

Some provider receipts arrive with Bupa's statement tag but contain only images.
For these, **Archive help → View PDF** opens the original in your PDF viewer.
Read every page. If it is an invoice or receipt, choose **Mark as supporting
document** and confirm, then close Archive help and **Recheck saved PDFs**.
Do not use this for Bupa statements; image-only assessments still require review
outside SCUPA and cannot supply payment amounts to the parser.

Both assessment confirmations and supporting decisions are saved beside the PDF
in `document-reviews.json`, tied to that
claim, filename and SHA-256 content hash. The PDF is never renamed or changed.
A different revision requires a fresh review. **Undo supporting classification**
removes the decision; the next parse will stop on the unreadable PDF again.
**Undo assessment confirmation** similarly blocks further imports from that PDF,
without removing historical master records. Agents cannot confirm assessments.
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
