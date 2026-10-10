# Privacy

SCUPA has no accounts, analytics, telemetry, advertising, AI service or hosted
database. The UI makes no network requests. The sync browser connects to Bupa
and services needed by its login flow. Bupa controls those services and its own
portal privacy policy applies to that session.

You type credentials and MFA into the Bupa browser, never into SCUPA. SCUPA uses
a fresh browser context per run and closes it afterward. It does not persist a
login profile in the archive. Temporary browser files and OS caches may exist
during a run; this is not a guarantee of forensic erasure after a crash.

The selected archive contains household names, medical providers, treatment
dates, statement PDFs, amounts, payment details and claim notes. It is readable
by the operating system account and anyone else with access to that folder.
Personal follow-up notes, dates, review markers, pins and saved filters are stored
separately in `workspace.json` within the same private archive.
SCUPA does not encrypt it. A folder in OneDrive or another sync service may be
uploaded by that service; choose a local folder if you do not want that.

CSV exports and agent JSON responses can contain sensitive data. Keep them
private. A user-authorised external agent may transmit records under its own
settings. Running SCUPA alone does not require or contact an AI provider.

Removing the portable EXE does not remove your archive. To erase your records,
close the app and manage the archive and exports yourself using your operating
system. SCUPA never automatically deletes downloaded PDFs.

Correcting household names preserves the previous names in private
`household-backups/` files so settings can be recovered. First-run setup shows
the archive location and storage notice before names are saved. The Privacy and
storage button remains available after setup.
