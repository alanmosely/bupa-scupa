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

After a failed or cancelled sync, click **Sync with Bupa** again to resume.
Sign in and confirm members as usual. SCUPA rechecks the portal's attachment lists
and reuses validated PDFs saved during the interrupted sync, including documents
completed before another PDF in the same claim failed. Each claim's private
`download-progress.json` stores attachment identifiers as hashes, PDF hashes,
sizes and completion times; no authenticated URLs or login data are saved.
The progress message says when a saved PDF is reused.

Resume is limited to 24 hours and downloads saved after the last successful sync.
Matching files must still pass PDF, size and SHA-256 checks. New or changed
attachment identifiers, missing files and damaged files download again. Recent
completed claims from older versions can also resume when their entire
`current.json` filename set matches the fresh attachment list. Loose PDFs from an
incomplete older download are downloaded again. **Refresh all claims** always
downloads every selected PDF. A download checkpoint never approves an assessment;
the usual document reviews and parsing checks still apply.

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

Changes to Bupa's assessment reasons count as updates even when the payment and
status stay the same. Dated assessment-note entries retain the new reason and the
previous audit history. Rechecking unchanged PDFs does not add repeat entries.

A statement can assess several claims. Claim details includes related statements
saved under another claim for the same member. Links must still match the current
PDF selection, SHA-256 and claim references extracted from the PDF. Recheck saved
PDFs once to build these links for an archive parsed by an older version.

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

## Download errors

If a document response fails PDF validation, SCUPA retries it through the logged-in
Bupa browser. Both methods must return a complete PDF before it can enter the
archive. If neither succeeds, the existing PDFs and current-file selections stay
intact and the merge stops.

`reports/download-errors.jsonl` records rejected response metadata: HTTP status,
content type, byte count, detected format, PDF markers and private claim context.
It does not contain downloaded bodies, authentication data or request URLs. Keep
this report private with the rest of the archive.

## Parsing errors

Open **Archive help** to see affected files. Keep these diagnostics private.
Recognised Bupa statements import automatically, including reassessments. SCUPA
checks the Bupa layout and issuer details, benefit rows, payment totals and
currencies. Routine statements do not need a confirmation click.

Where Bupa labels an amount as before tax/discount, the claim amount uses the
final invoice column. The original figure is retained in the assessment notes.
A provider discount is not an unpaid balance. Unlabelled columns and actual
benefit reductions still require the usual checks; payment totals remain authoritative.
Statements with several distinct invoice blocks retain every invoice number and
combine their validated payments only when their currencies and recipients agree.
Already-assessed duplicate invoices stay in the notes rather than creating a new
shortfall alongside a separately paid invoice. Conflicting identities or repeated
totals within one invoice still require review.

Readable booking confirmations, order confirmations and itemised till receipts
are recognised as supporting evidence when they contain no assessment markers.
They cannot establish a Bupa payment. Image-only receipts still need the
content-specific supporting review described below, even beside a readable assessment.

Only affected claims are held back when a document is unfamiliar, unreadable or
has ambiguous amounts. Other claims appear normally. New affected claims appear
with blank amounts and **Statement needs attention**; previous payment values stay
intact for existing claims. Both appear in **Needs attention**, and Archive help
lists the affected documents. Never interpret a blank amount as zero. Corrupt
archive metadata and conflicting claim ownership still block the entire merge.

For an unfamiliar but readable assessment, **Archive help → View PDF** lets you
check every page and **Confirm Bupa assessment** if Bupa issued it and the claims
and totals are correct. Then **Recheck saved PDFs**. This exceptional confirmation
is tied to the exact PDF bytes and filename. A provider invoice or receipt cannot
establish Bupa's payment, and manual confirmation cannot override malformed totals.

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
removes the decision; the next parse will flag the affected claim again.
**Undo assessment confirmation** similarly defers an unfamiliar assessment,
without removing historical master records. Recognised Bupa statements continue
to import automatically. Agents cannot make manual document-review decisions.
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
