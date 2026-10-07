# Contributing

Use Node.js 22.13+ and npm on Windows x64. Set up a checkout with `npm ci` and
`npm run vendor`, then launch it with `npm start`. For core tests only,
`npm run vendor -- --pdf-only` provisions the pinned PDF reader without Electron.
CI requires the PDF extraction and cancellation tests to run.

## Checks

```powershell
npm test
npm run check
npm run test:desktop
npm run test:portal
```

Run the first three before submitting changes, and the synthetic portal tests
when changing navigation or discovery. `npm run check` enforces formatting, lint,
JavaScript types and source privacy. It inspects tracked paths and staged blobs
as well as the working copy. Use `npm run format` before submitting changes.

Use exact dependency versions and include `package-lock.json` updates. Read
[the architecture guide](docs/ARCHITECTURE.md) before changing an operation.
Use shared model, status and version definitions.

## Private data

Never attach real health records, screenshots of names or bank details, cookies,
portal HTML, credentials, logs or household.json. Reproduce bugs with synthetic
fixtures. For portal changes describe navigation in general terms without
account identifiers. Contributions are licensed GPL-3.0-or-later.

Changes affecting member identity, reassessments, parsing totals, exports or
archive writes need a meaningful regression test. Keep login manual and the
browser headed. Avoid changes that depend on your machine's paths or accounts.

Follow CODE_OF_CONDUCT.md and the release checks in docs/RELEASE.md. The project
is independent of Bupa; avoid using its logos or suggesting endorsement.

## Build

`npm run build` checks the project and creates portable EXE and ZIP distributions.
`npm run release:source` creates the reviewed source archive. See
[the release checklist](docs/RELEASE.md) before distributing either.

Release builds also require PowerShell 7 and Visual Studio 2022 C++ Build Tools
with CMake and Ninja. `npm run build:pdf` compiles the pinned Xpdf source after
vendoring; the full build runs it automatically. The Windows SDK is hash-checked
and unpacked into `.cache/`, without installing system components. The build
records the source hash, compiler version and PDF-reader hash in `BUILD.json`.

`npm run vendor` prepares Electron, its matching FFmpeg source package and Xpdf 4.06.
Downloads are verified against `vendor-lock.json`. The FFmpeg DLL hash is checked
against the pinned runtime; an Electron upgrade requires reviewing and updating
its source pins. See [the source guide](docs/FFMPEG.md). Release CI requires this
coverage with `SCUPA_REQUIRE_FFMPEG_SOURCE=1`.
Sync, portal tests and icon rendering require an
installed current Edge or Chrome; Playwright tries Edge first, then Chrome.
No browser is downloaded or included in the release. Review
[bundled components](docs/THIRD_PARTY.md) and retain their notices.

The Clean Sweep icon is shared by the app header and Windows executable. Edit
`src/ui/clean-sweep.svg`, then run `npm run icon` after `npm run vendor` to rebuild
the Windows icon at 16–256px. The build regenerates it automatically.
